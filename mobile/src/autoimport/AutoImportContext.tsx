import * as FileSystem from "expo-file-system/legacy";
import * as Linking from "expo-linking";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AppState, Platform } from "react-native";
import { useRefresh } from "../context/RefreshContext";
import { useInterval } from "../hooks/useInterval";
import { digitsOf, folderLabelFromTreeUri } from "./naming";
import { listAudioFiles, runScan, SETTLE_MS } from "./scanner";
import {
  AutoImportState,
  DEFAULT_STATE,
  PendingCall,
  dayKey,
  isSweepDue,
  loadState,
  prunePendingCalls,
  saveState,
} from "./store";

/**
 * App-wide auto-import engine ("cron" for the watched recordings folder).
 *
 * Scans run: on app launch, whenever the app returns to the foreground (i.e.
 * right after a call ends), on a timer while the app is open, on demand via
 * scanNow(), and as a once-a-day sweep at the configured time (default 5 PM)
 * that also retries files previously rejected by the server.
 *
 * NOTE: all of this runs in-process, so it needs the app to be open. A phone
 * sitting with the app closed at 5 PM sweeps as soon as the app is next
 * opened (catch-up). True app-closed scheduling would need
 * expo-background-task (WorkManager) and a native rebuild — the seam is the
 * maybeSweep() call below.
 */

/** Idle cadence while nothing is mid-write. */
const SCAN_INTERVAL_MS = 60_000;
/** Faster cadence while a call recording is still growing, so it lands sooner. */
const SETTLING_INTERVAL_MS = Math.max(5_000, Math.round(SETTLE_MS / 2));

interface AutoImportContextValue {
  ready: boolean;
  folderUri: string | null;
  folderLabel: string | null;
  enabled: boolean;
  renameOnDisk: boolean;
  scanning: boolean;
  pendingCalls: PendingCall[];
  lastScanAt: string | null;
  lastScanSummary: string | null;
  totalImported: number;
  /** Files seen mid-write during the last scan (a call still in progress). */
  settlingCount: number;
  dailySweepHour: number;
  dailySweepMinute: number;
  lastSweepDay: string | null;
  pickFolder: () => Promise<void>;
  setEnabled: (value: boolean) => void;
  setRenameOnDisk: (value: boolean) => void;
  setDailySweepTime: (hour: number, minute: number) => void;
  scanNow: () => Promise<void>;
  /** Register a pending call and open the phone's native dialer. */
  startCall: (candidateName: string, phoneNumber: string) => Promise<boolean>;
  removePendingCall: (id: string) => void;
}

const AutoImportContext = createContext<AutoImportContextValue | null>(null);

export function AutoImportProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { bump } = useRefresh();
  const [state, setState] = useState<AutoImportState>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [settlingCount, setSettlingCount] = useState(0);
  const stateRef = useRef<AutoImportState>(DEFAULT_STATE);
  const busyRef = useRef(false);

  const commit = useCallback((next: AutoImportState): void => {
    stateRef.current = next;
    setState(next);
    void saveState(next);
  }, []);

  const scan = useCallback(
    async (interactive = false): Promise<void> => {
      const s = stateRef.current;
      if (!s.enabled || !s.folderUri || busyRef.current) return;
      busyRef.current = true;
      setScanning(true);
      try {
        const { state: next, outcome } = await runScan(s);
        commit(next);
        setSettlingCount(outcome.settling);
        if (outcome.imported > 0) bump(); // recordings list refetches on next focus
        if (interactive && outcome.error) Alert.alert("Auto-import", outcome.error);
      } finally {
        busyRef.current = false;
        setScanning(false);
      }
    },
    [commit, bump]
  );

  /**
   * Daily sweep: one full pass per day from the configured time onwards.
   * Clears the "permanently rejected" list first so every file gets a fresh
   * attempt each day, then marks the day done regardless of the result (the
   * regular scans keep retrying transient failures anyway).
   */
  const maybeSweep = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    if (!isSweepDue(s, new Date())) return;
    commit({ ...s, rejected: {}, lastSweepDay: dayKey(new Date()) });
    await scan();
  }, [commit, scan]);

  // Load persisted state once, then do a launch scan (+ catch-up sweep).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadState();
      if (cancelled) return;
      stateRef.current = loaded;
      setState(loaded);
      setReady(true);
      await scan();
      await maybeSweep();
    })();
    return () => {
      cancelled = true;
    };
  }, [scan, maybeSweep]);

  // Scan when the app returns to the foreground (typically right after a call).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      void (async () => {
        await scan();
        await maybeSweep();
      })();
    });
    return () => sub.remove();
  }, [scan, maybeSweep]);

  // The "cron": periodic scan while the app is open. Speeds up while a
  // recording is still being written so it uploads promptly once the call ends.
  const active = ready && state.enabled && state.folderUri !== null;
  useInterval(
    () => {
      void (async () => {
        await scan();
        await maybeSweep();
      })();
    },
    active ? (settlingCount > 0 ? SETTLING_INTERVAL_MS : SCAN_INTERVAL_MS) : null
  );

  const pickFolder = useCallback(async (): Promise<void> => {
    if (Platform.OS !== "android") {
      Alert.alert("Android only", "Folder watching uses Android's Storage Access Framework.");
      return;
    }
    try {
      // Open the system picker at Cube ACR's default folder when it exists.
      const initial =
        FileSystem.StorageAccessFramework.getUriForDirectoryInRoot("CubeCallRecorder");
      const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initial);
      if (!res.granted) return;
      const folderUri = res.directoryUri;
      const existing = await listAudioFiles(folderUri).catch(() => [] as string[]);

      const apply = (baselineExisting: boolean): void => {
        const importedUris: Record<string, true> = {};
        if (baselineExisting) for (const uri of existing) importedUris[uri] = true;
        commit({
          ...stateRef.current,
          folderUri,
          folderLabel: folderLabelFromTreeUri(folderUri),
          enabled: true,
          importedUris,
          probes: {},
          rejected: {},
          lastScanAt: null,
          lastScanSummary: null,
        });
        setTimeout(() => void scan(true), 0);
      };

      if (existing.length === 0) {
        apply(true);
        return;
      }
      Alert.alert(
        "Folder connected",
        `This folder already contains ${existing.length} audio file${existing.length === 1 ? "" : "s"}. Import them now, or only watch for new files?`,
        [
          { text: "Only new files", onPress: () => apply(true) },
          { text: `Import all ${existing.length}`, onPress: () => apply(false) },
        ]
      );
    } catch (err) {
      Alert.alert("Could not open folder picker", err instanceof Error ? err.message : String(err));
    }
  }, [commit, scan]);

  const setEnabled = useCallback(
    (value: boolean): void => {
      commit({ ...stateRef.current, enabled: value });
      if (value) setTimeout(() => void scan(), 0);
    },
    [commit, scan]
  );

  const setRenameOnDisk = useCallback(
    (value: boolean): void => {
      commit({ ...stateRef.current, renameOnDisk: value });
    },
    [commit]
  );

  const setDailySweepTime = useCallback(
    (hour: number, minute: number): void => {
      commit({ ...stateRef.current, dailySweepHour: hour, dailySweepMinute: minute });
    },
    [commit]
  );

  const scanNow = useCallback(async (): Promise<void> => {
    await scan(true);
  }, [scan]);

  const startCall = useCallback(
    async (candidateName: string, phoneNumber: string): Promise<boolean> => {
      const name = candidateName.trim();
      const number = phoneNumber.trim();
      const digits = digitsOf(number);
      if (!name) {
        Alert.alert("Missing name", "Enter the candidate name so the recording can be labelled.");
        return false;
      }
      if (digits.length < 5) {
        Alert.alert("Invalid number", "Enter a valid phone number to call.");
        return false;
      }
      const call: PendingCall = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        candidateName: name,
        phoneNumber: number,
        digits,
        startedAt: new Date().toISOString(),
      };
      commit({
        ...stateRef.current,
        pendingCalls: [call, ...prunePendingCalls(stateRef.current.pendingCalls)],
      });
      try {
        // tel: opens the native dialer with the number pre-filled; the user
        // presses the call button themselves (no CALL_PHONE permission needed).
        await Linking.openURL(`tel:${number.replace(/[^\d+*#]/g, "")}`);
        return true;
      } catch (err) {
        commit({
          ...stateRef.current,
          pendingCalls: stateRef.current.pendingCalls.filter((c) => c.id !== call.id),
        });
        Alert.alert("Could not open the dialer", err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [commit]
  );

  const removePendingCall = useCallback(
    (id: string): void => {
      commit({
        ...stateRef.current,
        pendingCalls: stateRef.current.pendingCalls.filter((c) => c.id !== id),
      });
    },
    [commit]
  );

  const value = useMemo<AutoImportContextValue>(
    () => ({
      ready,
      folderUri: state.folderUri,
      folderLabel: state.folderLabel,
      enabled: state.enabled,
      renameOnDisk: state.renameOnDisk,
      scanning,
      pendingCalls: state.pendingCalls,
      lastScanAt: state.lastScanAt,
      lastScanSummary: state.lastScanSummary,
      totalImported: state.totalImported,
      settlingCount,
      dailySweepHour: state.dailySweepHour,
      dailySweepMinute: state.dailySweepMinute,
      lastSweepDay: state.lastSweepDay,
      pickFolder,
      setEnabled,
      setRenameOnDisk,
      setDailySweepTime,
      scanNow,
      startCall,
      removePendingCall,
    }),
    [
      ready,
      state,
      scanning,
      settlingCount,
      pickFolder,
      setEnabled,
      setRenameOnDisk,
      setDailySweepTime,
      scanNow,
      startCall,
      removePendingCall,
    ]
  );

  return <AutoImportContext.Provider value={value}>{children}</AutoImportContext.Provider>;
}

export function useAutoImport(): AutoImportContextValue {
  const ctx = useContext(AutoImportContext);
  if (!ctx) throw new Error("useAutoImport must be used inside <AutoImportProvider>");
  return ctx;
}

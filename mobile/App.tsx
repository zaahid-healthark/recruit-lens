import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import React, { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { UploadFileInput } from "./src/api/client";
import { AutoImportProvider } from "./src/autoimport/AutoImportContext";
import { ImportModal } from "./src/components/ImportModal";
import { RefreshProvider, useRefresh } from "./src/context/RefreshContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { extensionFromMime } from "./src/utils/format";

/**
 * Listens for audio shared into the app via the Android share sheet
 * (expo-share-intent) and shows the import confirmation sheet.
 * NOTE: receiving shared files requires a development build — see README.
 */
function ShareIntentGate(): React.JSX.Element {
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();
  const { bump } = useRefresh();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (error) Alert.alert("Share failed", String(error));
  }, [error]);

  // A new share intent re-opens the sheet even if a previous one was dismissed.
  useEffect(() => {
    setDismissed(false);
  }, [shareIntent]);

  const files: UploadFileInput[] = useMemo(
    () =>
      (shareIntent?.files ?? []).map((f, i) => {
        const path = f.path ?? "";
        return {
          uri:
            path.startsWith("file://") || path.startsWith("content://") ? path : `file://${path}`,
          name: f.fileName || `recording-${i + 1}${extensionFromMime(f.mimeType)}`,
          mimeType: f.mimeType || "audio/mpeg",
        };
      }),
    [shareIntent]
  );

  const visible = hasShareIntent && files.length > 0 && !dismissed;

  return (
    <ImportModal
      visible={visible}
      files={files}
      onClose={() => {
        setDismissed(true);
        resetShareIntent();
      }}
      onImported={() => {
        setDismissed(true);
        resetShareIntent();
        bump(); // recordings list refetches on next focus
      }}
    />
  );
}

export default function App(): React.JSX.Element {
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <RefreshProvider>
          <AutoImportProvider>
            <NavigationContainer>
              <StatusBar style="dark" />
              <RootNavigator />
              <ShareIntentGate />
            </NavigationContainer>
          </AutoImportProvider>
        </RefreshProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}

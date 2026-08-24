import { Ionicons } from "@expo/vector-icons";
import type { AudioSource } from "expo-audio";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { formatDuration } from "../utils/format";

/**
 * Play/pause bar with a scrub-free progress line.
 *
 * Works for both a remote recording (server URL + auth header) and a local
 * file still sitting in the recorder's folder (SAF content:// URI), since
 * expo-audio takes either as an AudioSource.
 */
/** How long to wait for the source to load before calling it unavailable. */
const LOAD_TIMEOUT_MS = 12000;

export function AudioPlayerBar({
  source,
  /** Shown before the player has loaded metadata, e.g. a probed local duration. */
  fallbackDurationSeconds = null,
  compact = false,
}: {
  source: AudioSource;
  fallbackDurationSeconds?: number | null;
  compact?: boolean;
}): React.JSX.Element {
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  const duration = status.duration > 0 ? status.duration : (fallbackDurationSeconds ?? 0);
  const position = Math.min(status.currentTime, duration || status.currentTime);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  // A remote clip can legitimately 404 — free hosting has no persistent disk,
  // so the row survives while the audio does not. The player surfaces no error
  // for that, it simply never loads, so treat "still not loaded" as failure.
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    if (status.isLoaded) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [status.isLoaded]);
  const unavailable = timedOut && !status.isLoaded;

  const toggle = (): void => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Restarting from the end instead of no-oping is what a user expects when
    // they hit play on a finished clip.
    if (duration > 0 && status.currentTime >= duration - 0.25) void player.seekTo(0);
    player.play();
  };

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        disabled={unavailable}
        style={[
          styles.button,
          compact && styles.buttonCompact,
          unavailable && styles.buttonDisabled,
        ]}
        accessibilityLabel={status.playing ? "Pause" : "Play"}
      >
        <Ionicons
          name={status.playing ? "pause" : "play"}
          size={compact ? 14 : 17}
          color="#FFFFFF"
          // The play glyph is visually left-heavy; nudge it into the circle.
          style={status.playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
      <View style={styles.trackWrap}>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <Text style={styles.time}>
        {unavailable
          ? "unavailable"
          : !status.isLoaded
            ? "loading…"
            : `${formatDuration(Math.round(position))}${
                duration > 0 ? ` / ${formatDuration(Math.round(duration))}` : ""
              }`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  rowCompact: {
    gap: 8,
  },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCompact: {
    width: 27,
    height: 27,
    borderRadius: 14,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  trackWrap: {
    flex: 1,
    justifyContent: "center",
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  time: {
    fontSize: 11.5,
    color: colors.subtext,
    fontVariant: ["tabular-nums"],
    minWidth: 74,
    textAlign: "right",
  },
});

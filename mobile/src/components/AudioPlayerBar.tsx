import { Ionicons } from "@expo/vector-icons";
import type { AudioSource } from "expo-audio";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import React from "react";
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { formatDuration } from "../utils/format";

/**
 * Playback controls for one recording: play/pause, skip, and a draggable
 * position bar.
 *
 * Seeking matters here more than in a typical player — interview recordings
 * open with dead air and small talk, so getting to the substance means
 * skipping ahead rather than listening through. The bar is scrubbable by drag
 * and by tap, and the skip buttons jump in fixed steps.
 *
 * Takes either a remote recording (server URL plus auth header) or a local
 * file still in the recorder's folder (SAF content:// URI) — expo-audio
 * accepts both as an AudioSource.
 */

/** How far the skip buttons jump. */
const SKIP_SECONDS = 15;
/** How long to wait for the source to load before calling it unavailable. */
const LOAD_TIMEOUT_MS = 12000;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

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

  const [trackWidth, setTrackWidth] = React.useState(0);
  /** Non-null only while a drag is in progress; overrides the live position. */
  const [scrubFraction, setScrubFraction] = React.useState<number | null>(null);

  const duration = status.duration > 0 ? status.duration : (fallbackDurationSeconds ?? 0);

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
  const seekable = status.isLoaded && duration > 0;

  // Refs, because the PanResponder is created once and would otherwise close
  // over the first render's values forever.
  const trackWidthRef = React.useRef(0);
  const durationRef = React.useRef(0);
  const seekableRef = React.useRef(false);
  trackWidthRef.current = trackWidth;
  durationRef.current = duration;
  seekableRef.current = seekable;

  const seekToFraction = React.useCallback(
    (fraction: number): void => {
      if (!seekableRef.current) return;
      void player.seekTo(clamp01(fraction) * durationRef.current);
    },
    [player]
  );

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => seekableRef.current,
        onMoveShouldSetPanResponder: () => seekableRef.current,
        onPanResponderGrant: (e) => {
          if (trackWidthRef.current <= 0) return;
          setScrubFraction(clamp01(e.nativeEvent.locationX / trackWidthRef.current));
        },
        onPanResponderMove: (e) => {
          if (trackWidthRef.current <= 0) return;
          setScrubFraction(clamp01(e.nativeEvent.locationX / trackWidthRef.current));
        },
        onPanResponderRelease: (e) => {
          const width = trackWidthRef.current;
          if (width > 0) seekToFraction(e.nativeEvent.locationX / width);
          setScrubFraction(null);
        },
        onPanResponderTerminate: () => setScrubFraction(null),
      }),
    [seekToFraction]
  );

  const livePosition = Math.min(status.currentTime, duration || status.currentTime);
  const position = scrubFraction !== null ? scrubFraction * duration : livePosition;
  const progress = duration > 0 ? clamp01(position / duration) : 0;

  const togglePlay = (): void => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Restarting from the end instead of no-oping is what a user expects when
    // they hit play on a finished clip.
    if (duration > 0 && status.currentTime >= duration - 0.25) void player.seekTo(0);
    player.play();
  };

  const skip = (delta: number): void => {
    if (!seekable) return;
    const target = Math.min(Math.max(status.currentTime + delta, 0), duration);
    void player.seekTo(target);
  };

  const onTrackLayout = (e: LayoutChangeEvent): void => setTrackWidth(e.nativeEvent.layout.width);

  const iconSize = compact ? 14 : 17;

  return (
    <View style={styles.wrap}>
      <View style={styles.controls}>
        <Pressable
          onPress={() => skip(-SKIP_SECONDS)}
          hitSlop={8}
          disabled={!seekable}
          accessibilityLabel={`Back ${SKIP_SECONDS} seconds`}
          style={styles.skipButton}
        >
          <Ionicons
            name="play-back"
            size={iconSize}
            color={seekable ? colors.subtext : colors.border}
          />
        </Pressable>

        <Pressable
          onPress={togglePlay}
          hitSlop={8}
          disabled={unavailable}
          style={[styles.button, compact && styles.buttonCompact, unavailable && styles.disabled]}
          accessibilityLabel={status.playing ? "Pause" : "Play"}
        >
          <Ionicons
            name={status.playing ? "pause" : "play"}
            size={compact ? 15 : 18}
            color="#FFFFFF"
            // The play glyph is visually left-heavy; nudge it into the circle.
            style={status.playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>

        <Pressable
          onPress={() => skip(SKIP_SECONDS)}
          hitSlop={8}
          disabled={!seekable}
          accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
          style={styles.skipButton}
        >
          <Ionicons
            name="play-forward"
            size={iconSize}
            color={seekable ? colors.subtext : colors.border}
          />
        </Pressable>

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

      {/* Padded hit area — a 4px bar is far too thin to grab reliably. */}
      <View style={styles.trackHitArea} {...panResponder.panHandlers}>
        <View style={styles.track} onLayout={onTrackLayout}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </View>
        {seekable ? (
          <View
            pointerEvents="none"
            style={[
              styles.knob,
              scrubFraction !== null && styles.knobActive,
              { left: Math.max(0, progress * trackWidth - (scrubFraction !== null ? 9 : 6)) },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 2,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  skipButton: {
    paddingVertical: 4,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCompact: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  disabled: {
    backgroundColor: colors.border,
  },
  time: {
    flex: 1,
    fontSize: 11.5,
    color: colors.subtext,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  trackHitArea: {
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 2,
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
  knob: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  knobActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
});

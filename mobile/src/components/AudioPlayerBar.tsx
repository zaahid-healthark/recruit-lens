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
/**
 * Speed steps.
 *
 * This is the one way to get through a long recording faster that works on
 * EVERY format — unlike seeking, which Android cannot do on the AMR files a
 * call recorder produces. Pitch correction keeps a voice sounding like a voice
 * at 2x rather than a chipmunk.
 */
const SPEEDS = [1, 1.5, 2] as const;
/**
 * How long to wait before declaring a source unavailable.
 *
 * Generous because the server transcodes long recordings into a seekable
 * format on first play, and a 25-minute call takes real time to convert. The
 * old 12s budget expired mid-conversion and reported a perfectly good
 * recording as broken — which is exactly what "calls over 5 minutes show
 * unavailable" was.
 */
const LOAD_TIMEOUT_MS = 90_000;
/** After this long, say something more useful than "loading". */
const PREPARING_AFTER_MS = 6_000;

/**
 * Formats Android's player cannot seek within — a seek snaps back to zero.
 * ExoPlayer builds no seek table for these and its constant-bitrate fallback
 * is off by default. Server-hosted audio is transcoded before it is served, so
 * this only catches local files still in the recorder's own folder.
 */
const UNSEEKABLE_EXT = /\.(amr|awb|3gp|3gpp|wma)$/i;

function isUnseekableSource(source: AudioSource): boolean {
  const raw =
    typeof source === "string"
      ? source
      : source && typeof source === "object" && "uri" in source
        ? String(source.uri ?? "")
        : "";
  if (!raw) return false;
  let decoded = raw;
  try {
    // SAF URIs percent-encode the path, so the extension is hidden until decoded.
    decoded = decodeURIComponent(raw);
  } catch {
    /* malformed escape — test the raw string instead */
  }
  return UNSEEKABLE_EXT.test(decoded.split("?")[0]);
}

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
  const [preparing, setPreparing] = React.useState(false);
  React.useEffect(() => {
    if (status.isLoaded) {
      setTimedOut(false);
      setPreparing(false);
      return;
    }
    const slow = setTimeout(() => setPreparing(true), PREPARING_AFTER_MS);
    const dead = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => {
      clearTimeout(slow);
      clearTimeout(dead);
    };
  }, [status.isLoaded]);
  const unavailable = timedOut && !status.isLoaded;
  const formatBlocksSeek = React.useMemo(() => isUnseekableSource(source), [source]);
  const seekable = status.isLoaded && duration > 0 && !formatBlocksSeek;

  // Refs, because the PanResponder is created once and would otherwise close
  // over the first render's values forever.
  const trackWidthRef = React.useRef(0);
  const durationRef = React.useRef(0);
  const seekableRef = React.useRef(false);
  /** Latest dragged position, so release seeks to what the finger last showed. */
  const scrubRef = React.useRef<number | null>(null);
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
          const f = clamp01(e.nativeEvent.locationX / trackWidthRef.current);
          scrubRef.current = f;
          setScrubFraction(f);
        },
        onPanResponderMove: (e) => {
          if (trackWidthRef.current <= 0) return;
          const f = clamp01(e.nativeEvent.locationX / trackWidthRef.current);
          scrubRef.current = f;
          setScrubFraction(f);
        },
        onPanResponderRelease: () => {
          // Seek to the last position tracked during the drag, NOT to
          // locationX on the release event — that is measured against
          // whatever view handled the touch-end and can read as 0, which
          // silently sent every scrub back to the start of the recording.
          const f = scrubRef.current;
          if (f !== null) seekToFraction(f);
          scrubRef.current = null;
          setScrubFraction(null);
        },
        onPanResponderTerminate: () => {
          scrubRef.current = null;
          setScrubFraction(null);
        },
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

  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1);
  const cycleSpeed = (): void => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    player.setPlaybackRate(next, "high");
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
        {/* Rendered only when seeking works. A permanently disabled control
            reads as "this is broken"; absence reads as "this format cannot do
            that", which is what is actually true. */}
        {seekable ? (
          <Pressable
            onPress={() => skip(-SKIP_SECONDS)}
            hitSlop={8}
            accessibilityLabel={`Back ${SKIP_SECONDS} seconds`}
            style={styles.skipButton}
          >
            <Ionicons name="play-back" size={iconSize} color={colors.subtext} />
          </Pressable>
        ) : null}

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

        {seekable ? (
          <Pressable
            onPress={() => skip(SKIP_SECONDS)}
            hitSlop={8}
            accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
            style={styles.skipButton}
          >
            <Ionicons name="play-forward" size={iconSize} color={colors.subtext} />
          </Pressable>
        ) : null}

        {/* Speed is the one way to get through a long recording faster that
            works on every format, including the ones Android cannot seek. */}
        {status.isLoaded && !unavailable ? (
          <Pressable
            onPress={cycleSpeed}
            hitSlop={8}
            style={styles.speedPill}
            accessibilityLabel={`Playback speed ${speed}x, tap to change`}
          >
            <Text style={styles.speedLabel}>{speed}×</Text>
          </Pressable>
        ) : null}

        <Text style={styles.time}>
          {unavailable
            ? "unavailable"
            : !status.isLoaded
              ? preparing
                ? "preparing…"
                : "loading…"
              : `${formatDuration(Math.round(position))}${
                  duration > 0 ? ` / ${formatDuration(Math.round(duration))}` : ""
                }`}
        </Text>
      </View>

      {formatBlocksSeek && status.isLoaded ? (
        <Text style={styles.note}>
          This file&apos;s format can&apos;t be skipped through on Android. Send it to the server
          to scrub it there.
        </Text>
      ) : null}

      {/* The timeline is a seek control, so it goes too when seeking cannot
          work — a bar that ignores every drag is worse than none.
          Padded hit area: a 4px bar is far too thin to grab reliably. */}
      {seekable ? (
        <View style={styles.trackHitArea} {...panResponder.panHandlers}>
          <View style={styles.track} onLayout={onTrackLayout}>
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.knob,
              scrubFraction !== null && styles.knobActive,
              { left: Math.max(0, progress * trackWidth - (scrubFraction !== null ? 9 : 6)) },
            ]}
          />
        </View>
      ) : null}
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
  speedPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.text,
    fontVariant: ["tabular-nums"],
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
  note: {
    fontSize: 11,
    color: colors.subtext,
    lineHeight: 15,
    marginTop: -6,
  },
  knobActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
});

import { createAudioPlayer } from "expo-audio";

/**
 * Read an audio file's duration without playing it.
 *
 * Used by the scanner to drop hang-ups (a 9-second "call" is not an interview)
 * BEFORE anything is uploaded, so the server never sees them. Loading is async
 * and the native player reports duration only once the media is prepared, so
 * this polls briefly rather than reading the property straight away.
 *
 * Returns null when the duration cannot be determined — callers must treat that
 * as "unknown", never as "zero", or an unreadable file would be silently
 * discarded as too short.
 */

/** Give the native player this long to prepare before giving up. */
const LOAD_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function probeDurationSeconds(uri: string): Promise<number | null> {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  try {
    player = createAudioPlayer(uri);
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // `duration` is 0 until the media is prepared; isLoaded alone can flip
      // true a tick before duration is populated, so require both.
      if (player.isLoaded && player.duration > 0) {
        return Math.round(player.duration);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return null;
  } catch {
    // Unsupported codec, unreadable URI, revoked SAF grant — all "unknown".
    return null;
  } finally {
    try {
      player?.remove();
    } catch {
      /* already released */
    }
  }
}

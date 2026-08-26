import { spawn } from "child_process";
import { randomUUID } from "crypto";
import ffmpegPath from "ffmpeg-static";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { log } from "../lib/logger";

/** Formats OpenAI's transcription endpoint doesn't accept — always transcoded. */
const TRANSCODE_EXTS = new Set([".amr", ".3gp", ".3gpp", ".awb", ".ogg", ".oga", ".opus", ".wma"]);
/** OpenAI caps audio uploads at 25 MB — keep headroom. */
const MAX_BYTES_FOR_OPENAI = 24 * 1024 * 1024;

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary not found (ffmpeg-static did not resolve for this platform)"));
      return;
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/**
 * Best-effort duration probe. `ffmpeg -i` prints "Duration: HH:MM:SS.cc" on
 * stderr even though it exits non-zero without an output file — that's fine.
 */
export async function getDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const { stderr } = await runFfmpeg(["-hide_banner", "-i", filePath]);
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  } catch (err) {
    log.warn("Could not read audio duration:", err);
    return null;
  }
}

export interface AudioAnalysis {
  durationSeconds: number | null;
  /** Peak volume in dBFS. 0 is full scale; digital silence reports -91. */
  maxVolumeDb: number | null;
  meanVolumeDb: number | null;
  /**
   * True only when the file was measured AND found to have no audible content.
   * An unreadable or unmeasurable file is false, never true — "unknown" must
   * never be treated as "silent", or a real interview could be rejected.
   */
  isSilent: boolean;
}

/**
 * Decode a file once and report both its duration and its volume levels.
 *
 * Exists because a call recorder can produce a file of the right size and
 * duration that contains no audio at all — when the recorder loses the
 * permission it needs mid-session, it still writes the file. Nothing about
 * the file's metadata distinguishes that from a real interview; only decoding
 * it does. `volumedetect` reports peak/mean level, and ffmpeg prints the
 * Duration line in the same pass, so one invocation answers both questions.
 */
export async function analyzeAudio(
  filePath: string,
  silenceThresholdDb: number
): Promise<AudioAnalysis> {
  const empty: AudioAnalysis = {
    durationSeconds: null,
    maxVolumeDb: null,
    meanVolumeDb: null,
    isSilent: false,
  };
  try {
    // -f null discards the output; we only want what volumedetect logs.
    const { stderr } = await runFfmpeg([
      "-hide_banner",
      "-i",
      filePath,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]);

    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const durationSeconds = durationMatch
      ? Math.round(
          Number(durationMatch[1]) * 3600 +
            Number(durationMatch[2]) * 60 +
            Number(durationMatch[3])
        )
      : null;

    const maxMatch = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);
    const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
    const maxVolumeDb = maxMatch ? Number(maxMatch[1]) : null;
    const meanVolumeDb = meanMatch ? Number(meanMatch[1]) : null;

    return {
      durationSeconds,
      maxVolumeDb,
      meanVolumeDb,
      // Speech peaks far above this even on a quiet line; a recorder that
      // captured nothing reports the 16-bit floor (-91 dB).
      isSilent: maxVolumeDb !== null && maxVolumeDb < silenceThresholdDb,
    };
  } catch (err) {
    log.warn("Could not analyze audio levels:", err);
    return empty;
  }
}

/**
 * Formats Android's player cannot seek within.
 *
 * ExoPlayer builds no seek table for these: AMR and friends carry no index,
 * and its constant-bitrate fallback is off by default and not exposed through
 * expo-audio. A seek in one of these snaps the position back to zero, so the
 * scrub bar and skip buttons appear broken. Call recorders write AMR by
 * default, which is exactly what this app receives.
 */
const UNSEEKABLE_EXTS = new Set([".amr", ".awb", ".3gp", ".3gpp", ".wma"]);

export interface PlayableAudio {
  path: string;
  /** Set when the file was transcoded, so the response advertises the new type. */
  contentType: string | null;
}

/**
 * Return a version of this recording the phone can actually scrub through,
 * transcoding to MP3 only for the formats that need it.
 *
 * The result is cached next to the original, so the cost lands once on the
 * first play rather than on every seek. A failed transcode falls back to the
 * original: unseekable playback is worse than seekable, but far better than
 * no playback at all.
 */
export async function ensureSeekableAudio(filePath: string): Promise<PlayableAudio> {
  const ext = path.extname(filePath).toLowerCase();
  if (!UNSEEKABLE_EXTS.has(ext)) return { path: filePath, contentType: null };

  const cached = `${filePath}.playable.mp3`;
  try {
    const stat = await fs.stat(cached);
    if (stat.size > 0) return { path: cached, contentType: "audio/mpeg" };
  } catch {
    /* not cached yet */
  }

  // Mono 32 kbps is plenty for speech and keeps a long interview small.
  const { code, stderr } = await runFfmpeg([
    "-y",
    "-i",
    filePath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "32k",
    cached,
  ]);
  if (code !== 0) {
    log.warn(`Playback transcode failed (code ${code}) — serving the original.`, stderr.slice(-300));
    await fs.unlink(cached).catch(() => undefined);
    return { path: filePath, contentType: null };
  }
  return { path: cached, contentType: "audio/mpeg" };
}

/**
 * Copy the first `seconds` of a recording to a temp mp3.
 *
 * The screening gate only needs enough audio to tell a job interview from a
 * personal call, and that is established in the opening exchange — who is
 * calling, about what role. Transcribing 25 minutes to answer a yes/no
 * question would cost ~10x more and tell us nothing extra. mono 16 kHz keeps
 * the upload to OpenAI small.
 *
 * Returns null on failure; the caller treats that as "cannot screen" and lets
 * the recording through rather than rejecting on a technicality.
 */
export async function clipHead(filePath: string, seconds: number): Promise<string | null> {
  const outDir = path.join(os.tmpdir(), "interview-evaluator");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${randomUUID()}.mp3`);
  const { code, stderr } = await runFfmpeg([
    "-y",
    "-i",
    filePath,
    "-t",
    String(seconds),
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "32k",
    outPath,
  ]);
  if (code !== 0) {
    log.warn(`Could not clip audio for screening (code ${code}).`, stderr.slice(-300));
    await fs.unlink(outPath).catch(() => undefined);
    return null;
  }
  return outPath;
}

export interface NormalizedAudio {
  path: string;
  /** true when `path` is a transcoded temp file that must be cleaned up afterwards. */
  isTemp: boolean;
}

/**
 * Normalize audio before transcription: call recorders produce formats OpenAI
 * rejects (amr/3gp/ogg…), and long calls can exceed the 25 MB upload cap.
 * When needed, transcode to mono 16 kHz 32 kbps mp3 (plenty for speech —
 * keeps ~90 minutes under the cap). Otherwise the original file passes through.
 */
export async function normalizeForTranscription(filePath: string): Promise<NormalizedAudio> {
  const ext = path.extname(filePath).toLowerCase();
  let size = 0;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    /* stat is best-effort; transcode decision falls back to extension only */
  }
  if (!TRANSCODE_EXTS.has(ext) && size <= MAX_BYTES_FOR_OPENAI) {
    return { path: filePath, isTemp: false };
  }

  const outDir = path.join(os.tmpdir(), "interview-evaluator");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${randomUUID()}.mp3`);
  const { code, stderr } = await runFfmpeg([
    "-y",
    "-i",
    filePath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "32k",
    outPath,
  ]);
  if (code !== 0) {
    log.warn(`ffmpeg transcode failed (code ${code}) — sending the original file instead.`, stderr.slice(-400));
    return { path: filePath, isTemp: false };
  }
  return { path: outPath, isTemp: true };
}

export async function cleanupNormalized(audio: NormalizedAudio): Promise<void> {
  if (audio.isTemp) await fs.unlink(audio.path).catch(() => undefined);
}

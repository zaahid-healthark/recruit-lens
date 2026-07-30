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

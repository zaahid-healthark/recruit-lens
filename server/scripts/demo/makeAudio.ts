/**
 * Voices the demo calls with Windows text-to-speech and writes, per call:
 *
 *   audio/<key>.mp3   the call, at phone quality
 *   audio/<key>.json  its length and every line's real start and end
 *
 * so a demo report's player works and clicking a transcript line plays that
 * line. Windows only (it drives the built-in speech voices); the outputs are
 * committed, so the seed itself runs anywhere. Re-run after editing calls.ts:
 *
 *   npm run demo:audio -w server
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import { DEMO_CALLS, DemoCall } from "./calls";

const OUT_DIR = path.join(__dirname, "audio");
const RATE = 16_000;
const BYTES_PER_SAMPLE = 2;

/** Synthesise every line of a call to its own WAV, one SAPI voice per speaker. */
function synthesise(call: DemoCall, dir: string): string[] {
  const items = call.turns.map((t, i) => {
    const speaker = t.who === "recruiter" ? call.recruiter : call.candidate;
    return { out: path.join(dir, `${String(i).padStart(3, "0")}.wav`), voice: speaker.voice, rate: speaker.rate, text: t.text };
  });
  const jobFile = path.join(dir, "lines.json");
  fs.writeFileSync(jobFile, JSON.stringify(items), "utf8");

  // Passed as an encoded command: no script file, so no execution-policy
  // change, and unlike stdin it runs multi-line blocks as one script.
  const script = `
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 '${jobFile.replace(/'/g, "''")}' | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($item in $items) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($item.voice)
  $synth.Rate = [int]$item.rate
  $synth.SetOutputToWaveFile($item.out, $format)
  $synth.Speak($item.text)
  $synth.Dispose()
}
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8" });
  const missing = items.filter((it) => !fs.existsSync(it.out));
  if (run.status !== 0 || missing.length) {
    throw new Error(`Speech synthesis failed for ${call.key} (${missing.length} of ${items.length} lines missing):\n${run.stderr || run.stdout}`);
  }
  return items.map((it) => it.out);
}

/** The PCM samples of a 16 kHz, 16-bit mono WAV. */
function pcmOf(file: string): Buffer {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file} is not a WAV file`);
  let offset = 12;
  let formatChecked = false;
  while (offset + 8 <= buf.length) {
    const chunk = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunk === "fmt ") {
      const format = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const rate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (format !== 1 || channels !== 1 || rate !== RATE || bits !== 16) {
        throw new Error(`${file}: expected 16 kHz 16-bit mono PCM, got format ${format}, ${channels} ch, ${rate} Hz, ${bits}-bit`);
      }
      formatChecked = true;
    } else if (chunk === "data") {
      if (!formatChecked) throw new Error(`${file}: data before fmt`);
      return buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

/** Drop the voice engine's own lead-in and tail silence, keeping a short margin. */
function trim(pcm: Buffer): Buffer {
  const samples = pcm.length / BYTES_PER_SAMPLE;
  const loud = (i: number) => Math.abs(pcm.readInt16LE(i * BYTES_PER_SAMPLE)) > 250;
  let first = 0;
  while (first < samples && !loud(first)) first++;
  let last = samples - 1;
  while (last > first && !loud(last)) last--;
  const margin = Math.round(RATE * 0.06);
  const from = Math.max(0, first - margin);
  const to = Math.min(samples, last + margin);
  return pcm.subarray(from * BYTES_PER_SAMPLE, to * BYTES_PER_SAMPLE);
}

const silence = (seconds: number): Buffer => Buffer.alloc(Math.round(seconds * RATE) * BYTES_PER_SAMPLE);

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * The pause before a line: short for a quick reply, longer before a real
 * answer, so the call breathes like a conversation rather than a list.
 * Deterministic, so regenerating gives the same timings.
 */
function pauseBefore(index: number, text: string): number {
  if (index === 0) return 0.5;
  const jitter = ((index * 37) % 23) / 100;
  return (text.length > 160 ? 0.75 : 0.42) + jitter;
}

function build(call: DemoCall): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `recruitlens-demo-${call.key}-`));
  try {
    const files = synthesise(call, dir);
    const parts: Buffer[] = [];
    const segments: { speaker: string; start: number; end: number; text: string }[] = [];
    let cursor = 0;
    files.forEach((file, i) => {
      const turn = call.turns[i];
      const gap = silence(pauseBefore(i, turn.text));
      parts.push(gap);
      cursor += gap.length;
      const voice = trim(pcmOf(file));
      segments.push({
        speaker: turn.who === "recruiter" ? "A" : "B",
        start: Math.round((cursor / BYTES_PER_SAMPLE / RATE) * 100) / 100,
        end: Math.round(((cursor + voice.length) / BYTES_PER_SAMPLE / RATE) * 100) / 100,
        text: turn.text,
      });
      parts.push(voice);
      cursor += voice.length;
    });
    parts.push(silence(0.8));
    const pcm = Buffer.concat(parts);
    const combined = path.join(dir, "call.wav");
    fs.writeFileSync(combined, wav(pcm));

    if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve a binary for this platform");
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const mp3 = path.join(OUT_DIR, `${call.key}.mp3`);
    // A phone line's band, mono, 32 kbps: sounds like a recorded call and
    // keeps each file around a megabyte.
    const enc = spawnSync(
      ffmpegPath,
      ["-y", "-hide_banner", "-loglevel", "error", "-i", combined, "-af", "highpass=f=200,lowpass=f=3800", "-ac", "1", "-ar", String(RATE), "-b:a", "32k", mp3],
      { encoding: "utf8" }
    );
    if (enc.status !== 0) throw new Error(`ffmpeg failed for ${call.key}: ${enc.stderr}`);

    const durationSeconds = Math.round((pcm.length / BYTES_PER_SAMPLE / RATE) * 100) / 100;
    fs.writeFileSync(path.join(OUT_DIR, `${call.key}.json`), JSON.stringify({ durationSeconds, segments }, null, 2) + "\n", "utf8");
    const kb = Math.round(fs.statSync(mp3).size / 1024);
    console.log(`${call.key}: ${Math.floor(durationSeconds / 60)}m ${Math.round(durationSeconds % 60)}s, ${segments.length} lines, ${kb} KB`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.platform !== "win32") {
  console.error("demo:audio drives the Windows speech voices, so it only runs on Windows. The generated files are committed; seeding does not need this.");
  process.exit(1);
}
for (const call of DEMO_CALLS) build(call);

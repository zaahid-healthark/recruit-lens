/**
 * Filename / phone-number helpers for the auto-import watcher.
 *
 * Cube ACR (and most Android call recorders) name files like
 *   "Sai_98682_24211_20260820_125753.amr"
 *   <contact>_<number parts>_<YYYYMMDD>_<HHMMSS>.<ext>
 * so both the dialed number and the call time can usually be recovered
 * straight from the filename.
 */

/** Audio extensions accepted by the server (mirror of server/src/routes/recordings.ts). */
export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".amr",
  ".awb",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".3gp",
  ".3gpp",
  ".flac",
  ".wma",
  ".mp4",
  ".caf",
  ".aiff",
]);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function isAudioFilename(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(filename));
}

/**
 * Display name of a SAF document URI. SAF encodes the full path into the last
 * URI segment, e.g. ".../document/primary%3ACubeCallRecorder%2FAll%2Ffile.amr"
 * → "file.amr".
 */
export function fileNameFromSafUri(uri: string): string {
  const last = uri.split("/").pop() ?? uri;
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    /* malformed escape — keep the raw segment */
  }
  const segment = decoded.split("/").pop() ?? decoded;
  const colon = segment.lastIndexOf(":");
  return colon >= 0 ? segment.slice(colon + 1) || segment : segment;
}

/** Human-readable label for a granted SAF tree URI ("CubeCallRecorder/All"). */
export function folderLabelFromTreeUri(uri: string): string {
  const m = uri.match(/\/tree\/([^/]+)/);
  if (!m) return uri;
  try {
    const decoded = decodeURIComponent(m[1]);
    const colon = decoded.indexOf(":");
    const label = colon >= 0 ? decoded.slice(colon + 1) : decoded;
    return label || "Device storage";
  } catch {
    return m[1];
  }
}

export function digitsOf(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Does a recording filename plausibly belong to a call to this number?
 *
 * The trailing "YYYYMMDD_HHMMSS" stamp is stripped first — otherwise its
 * digits could accidentally satisfy the short (7-digit) comparison and match
 * the wrong call. What remains is compared against the dialed number, whose
 * country code is dropped by taking the last 10 digits.
 */
export function filenameMatchesNumber(filename: string, dialedDigits: string): boolean {
  if (!dialedDigits) return false;
  const withoutStamp = filename.replace(/20\d{6}_\d{6}/g, "");
  const nameDigits = digitsOf(withoutStamp);
  if (!nameDigits) return false;
  const long = dialedDigits.slice(-10);
  if (long.length >= 7 && nameDigits.includes(long)) return true;
  const short = dialedDigits.slice(-7);
  return short.length === 7 && nameDigits.includes(short);
}

/**
 * Does this filename still look like untouched call-recorder output?
 *
 * Cube ACR writes `phone_<number>_<YYYYMMDD>_<HHMMSS>.<ext>`, so a file that
 * no longer looks like that has been renamed by a person — and renaming is
 * how the user approves a recording for upload.
 *
 * Both halves are checked, not just the `phone_` prefix, because some
 * recorders substitute a saved contact's name for `phone`. Treating
 * `Wife_9876543210_20260820_125753.amr` as "renamed, therefore approved"
 * would auto-upload a personal call. Keeping the machine-written timestamp
 * as part of the test means only a genuine rename counts.
 */
export function looksLikeRawRecorderFile(filename: string): boolean {
  return /^phone[_-]/i.test(filename) || /_20\d{6}_\d{6}/.test(filename);
}

/**
 * Recover the candidate name a user typed when renaming a file, by stripping
 * the extension and any trailing date stamp this app itself appends.
 * Returns null when nothing meaningful is left.
 */
export function candidateNameFromFilename(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const withoutStamp = stem
    // "Sai Kumar 2026-08-20 12-57" — the shape buildCandidateFilename writes.
    .replace(/\s+20\d{2}-\d{2}-\d{2}([\s_-]+\d{2}-\d{2})?$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutStamp.length > 0 ? withoutStamp.slice(0, 200) : null;
}

/** Parse the "YYYYMMDD_HHMMSS" stamp most call recorders put in filenames. */
export function timestampFromFilename(filename: string): Date | null {
  const m = filename.match(/(20\d{6})_(\d{6})/);
  if (!m) return null;
  const d = m[1];
  const t = m[2];
  const date = new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6))
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "<Candidate> 2026-08-20 12-57.amr" — upload name for a matched call recording. */
export function buildCandidateFilename(candidateName: string, when: Date, ext: string): string {
  const safe =
    candidateName
      .replace(/[\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Candidate";
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}-${p(when.getMinutes())}`;
  return `${safe} ${stamp}${ext || ".m4a"}`;
}

/** Best-effort MIME type for an audio extension (server also accepts octet-stream). */
export function mimeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".amr": "audio/amr",
    ".awb": "audio/amr-wb",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".3gp": "video/3gpp",
    ".3gpp": "video/3gpp",
    ".flac": "audio/flac",
    ".wma": "audio/x-ms-wma",
    ".mp4": "video/mp4",
    ".caf": "audio/x-caf",
    ".aiff": "audio/aiff",
  };
  return map[ext] ?? "application/octet-stream";
}

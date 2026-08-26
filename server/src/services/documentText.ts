import mammoth from "mammoth";
import path from "path";
import { PDFParse } from "pdf-parse";
import { log } from "../lib/logger";

/**
 * Plain text out of an uploaded job description.
 *
 * Exists because typing a JD on a phone keyboard is miserable, and a recruiter
 * already has the document. Extraction runs here rather than on the device:
 * there is no dependable PDF text extractor for React Native, and the parsing
 * libraries that do exist are Node-only.
 */

export const SUPPORTED_DOC_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);

export interface ExtractedDocument {
  text: string;
  /** Pages for a PDF, null for formats with no page concept. */
  pages: number | null;
}

/**
 * Length above which a line is assumed to have been wrapped by page layout
 * rather than broken on purpose. Bullets in a job description are short, so
 * this is what keeps two requirements from being merged into one.
 */
const WRAPPED_LINE_CHARS = 60;

/** Page separators the PDF extractor injects, e.g. "-- 1 of 3 --". */
const PAGE_MARKER = /^\s*-{2,}\s*\d+\s+of\s+\d+\s*-{2,}\s*$/i;

/** Collapse the whitespace extraction leaves behind, without losing structure. */
function tidy(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => !PAGE_MARKER.test(line));

  // Rejoin only lines the layout broke mid-sentence. Joining on "previous line
  // ended lowercase" alone would glue adjacent bullets together — a JD is
  // mostly short lines, and each one is a separate requirement.
  const merged: string[] = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    const continuesSentence =
      prev !== undefined &&
      prev.length >= WRAPPED_LINE_CHARS &&
      /[a-z,;]$/.test(prev) &&
      /^[a-z]/.test(line);
    if (continuesSentence) merged[merged.length - 1] = `${prev} ${line}`;
    else merged.push(line);
  }

  return merged.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Throws on an unreadable or unsupported file — the caller turns that into a
 * message the recruiter can act on, since a silent empty box would look like
 * the feature simply did not work.
 */
export async function extractDocumentText(
  buffer: Buffer,
  filename: string
): Promise<ExtractedDocument> {
  const ext = path.extname(filename).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    return { text: tidy(buffer.toString("utf8")), pages: null };
  }

  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: tidy(value), pages: null };
  }

  if (ext === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return {
        text: tidy(result.text ?? ""),
        pages: typeof result.total === "number" ? result.total : null,
      };
    } finally {
      // Holds native-ish resources; leaking these across many uploads would
      // grow the process for the lifetime of the server.
      await parser.destroy().catch(() => undefined);
    }
  }

  // .doc is the pre-2007 binary format — mammoth cannot read it, and saying so
  // is more useful than a generic failure.
  if (ext === ".doc") {
    throw new Error(
      "Old .doc files are not supported — open it and save as .docx or PDF, then try again."
    );
  }

  throw new Error(
    `Cannot read "${ext || "this file"}". Upload a PDF, DOCX or plain text file.`
  );
}

/**
 * A PDF of scanned pages has no text layer, so extraction succeeds and returns
 * nothing. Told apart from a genuine failure so the recruiter is advised to
 * paste the text rather than left staring at an empty box.
 */
export function looksScanned(doc: ExtractedDocument): boolean {
  const meaningful = doc.text.replace(/\s/g, "").length;
  if (meaningful === 0) return true;
  // A page with almost no characters is a picture of a page.
  return doc.pages !== null && doc.pages > 0 && meaningful / doc.pages < 40;
}

export function logExtraction(filename: string, doc: ExtractedDocument): void {
  log.info(
    `Extracted ${doc.text.length} chars from "${filename}"` +
      (doc.pages !== null ? ` (${doc.pages} pages)` : "")
  );
}

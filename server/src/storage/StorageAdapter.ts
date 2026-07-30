/**
 * Pluggable storage seam.
 *
 * LocalDiskStorage is the active implementation. GoogleDriveStorage is a
 * documented stub for a later Google Workspace integration — implement it and
 * swap the export in ./index.ts; nothing else in the codebase needs to change.
 */
export interface StorageAdapter {
  /**
   * Persist a temp-uploaded file. Returns an opaque `storagePath` key that is
   * stored on the Recording row and passed back to the other methods.
   */
  saveFromFile(tempPath: string, originalFilename: string): Promise<string>;

  /**
   * Absolute local filesystem path for processing (ffmpeg/OpenAI upload).
   * A remote adapter (Drive/S3) would download to a temp file and return that path.
   */
  getLocalPath(storagePath: string): Promise<string>;

  /** Remove the stored file. Must not throw if the file is already gone. */
  delete(storagePath: string): Promise<void>;
}

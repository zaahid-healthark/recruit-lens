import { StorageAdapter } from "./StorageAdapter";

/**
 * ── STUB — NOT IMPLEMENTED ──────────────────────────────────────────────────
 * Google Drive storage adapter for Google Workspace users.
 *
 * Implementation plan (when needed):
 *  1. `npm i googleapis` in /server.
 *  2. Create a Google Cloud service account with domain-wide delegation (or an
 *     OAuth client), enable the Drive API, share a target Drive folder with it.
 *  3. Env: GOOGLE_DRIVE_FOLDER_ID + GOOGLE_APPLICATION_CREDENTIALS (JSON path).
 *  4. saveFromFile  -> drive.files.create({ parents: [folderId], media: fs stream })
 *                      and return the Drive fileId as the storagePath key.
 *  5. getLocalPath  -> drive.files.get({ fileId, alt: "media" }) piped to a temp
 *                      file (os.tmpdir()); return the temp path for ffmpeg/OpenAI.
 *  6. delete        -> drive.files.delete({ fileId }), swallow 404s.
 *  7. Swap the export in ./index.ts to `new GoogleDriveStorage(...)`.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class GoogleDriveStorage implements StorageAdapter {
  saveFromFile(_tempPath: string, _originalFilename: string): Promise<string> {
    return Promise.reject(
      new Error("GoogleDriveStorage is not implemented yet — see the TODO plan in this file.")
    );
  }

  getLocalPath(_storagePath: string): Promise<string> {
    return Promise.reject(
      new Error("GoogleDriveStorage is not implemented yet — see the TODO plan in this file.")
    );
  }

  delete(_storagePath: string): Promise<void> {
    return Promise.reject(
      new Error("GoogleDriveStorage is not implemented yet — see the TODO plan in this file.")
    );
  }
}

import fs from "fs";
import { google } from "googleapis";
import type { drive_v3, sheets_v4 } from "googleapis";
import { env } from "../config/env";
import { log } from "../lib/logger";

/**
 * Lazy Google API clients authenticated with a service account.
 *
 * Setup (see README "Google Drive mirror"):
 *  1. Google Cloud project → enable Drive API + Sheets API.
 *  2. Create a service account, download its JSON key to
 *     server/google-credentials.json (gitignored).
 *  3. Create a Drive folder (e.g. "recruiter app") and share it with the
 *     service account's email as Editor.
 *  4. Set GOOGLE_DRIVE_FOLDER_ID in server/.env to that folder's ID.
 */

let clients: { drive: drive_v3.Drive; sheets: sheets_v4.Sheets } | null = null;
let noticeShown = false;

export function isDriveConfigured(): boolean {
  return Boolean(env.googleDriveFolderId) && fs.existsSync(env.googleCredentialsPath);
}

/** Log (once) why the Drive mirror is inactive. */
export function noteDriveDisabled(): void {
  if (noticeShown) return;
  noticeShown = true;
  log.info(
    "Google Drive mirror is disabled. Set GOOGLE_DRIVE_FOLDER_ID and place the service-account " +
      `key at ${env.googleCredentialsPath} to enable it.`
  );
}

export function getGoogleClients(): { drive: drive_v3.Drive; sheets: sheets_v4.Sheets } {
  if (!isDriveConfigured()) {
    throw new Error("Google Drive mirror is not configured");
  }
  if (!clients) {
    const auth = new google.auth.GoogleAuth({
      keyFile: env.googleCredentialsPath,
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });
    clients = {
      drive: google.drive({ version: "v3", auth }),
      sheets: google.sheets({ version: "v4", auth }),
    };
  }
  return clients;
}

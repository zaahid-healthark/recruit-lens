# RecruitLens — Interview Evaluator

Recruiters record interview calls with their phone's normal recorder, then **share the audio file into this app** via the Android share sheet (or upload it in-app). The app manages recordings in a structured library, transcribes and **evaluates them with AI** against a fixed scoring matrix, detects the **role/designation**, and classifies each interview into a **department › sub-category**. A dashboard summarizes everything. The Dialer tab starts candidate calls via the phone dialer and, together with a watched recordings folder (e.g. Cube ACR), auto-imports call recordings named after the candidate.

## Monorepo layout

```
├── mobile/    Expo (React Native) + TypeScript app — dev build (NOT Expo Go)
├── server/    Node.js + Express + TypeScript + Prisma (PostgreSQL) + OpenAI
├── shared/    Shared TypeScript types (API DTOs, scoring matrix, taxonomy types)
├── docker-compose.yml   Local PostgreSQL (host port 5433)
```

- **All OpenAI calls happen on the server.** The mobile app talks only to the backend (authenticated with a shared `x-api-key`).
- **MOCK_AI mode** (default) exercises the entire flow — import → evaluate → dashboard — with canned results and **zero OpenAI cost**.

---

# Run it from a fresh clone — every step

The steps below take a clean machine to a working app on an Android emulator. Commands are for **Windows PowerShell** (macOS/Linux equivalents noted where they differ). Steps 6–7 are one-time Android tooling setup; skip them if you already build Android apps.

## Step 0 — Prerequisites

| Tool             | Needed for                  | Check                      |
| ---------------- | --------------------------- | -------------------------- |
| Node.js ≥ 20.19  | everything                  | `node -v`                  |
| Docker Desktop   | PostgreSQL                  | `docker --version`         |
| Android Studio   | emulator + dev build        | step 6 installs it         |
| ~20 GB free disk | Android SDK/emulator/Gradle |                            |
| OpenAI API key   | real AI mode only           | **not** needed for MOCK_AI |

## Step 1 — Install dependencies

From the repo root:

```powershell
npm install
```

Installs all three workspaces and generates the Prisma client automatically.

## Step 2 — Start PostgreSQL

```powershell
npm run db:up
```

Starts a `postgres:16` container on host port **5433** (deliberately not 5432, so it never clashes with a natively installed PostgreSQL). Verify: `docker compose ps` shows `interview-evaluator-db` as healthy.

## Step 3 — Configure the server

```powershell
copy server\.env.example server\.env        # macOS/Linux: cp server/.env.example server/.env
```

The defaults work as-is: local Postgres from step 2, `MOCK_AI=true` (free), API key `dev-secret-change-me`. Nothing to edit for a first run.

## Step 4 — Create the database schema + seed data

```powershell
npm run db:migrate      # applies the Prisma migrations (accept the migration name prompt if asked)
npm run db:seed         # taxonomy + 3 sample recordings (2 already evaluated)
```

## Step 5 — Run the backend

```powershell
npm run dev:server
```

Leave this terminal open. The log must show `Interview Evaluator API listening on http://localhost:4000` and `Mode: MOCK_AI`. Sanity check in a browser or new terminal:

```powershell
curl http://localhost:4000/health     # → {"ok":true,"mockAi":true}
```

## Step 6 — Android tooling (one-time)

1. **Install Android Studio** from https://developer.android.com/studio → run the installer with defaults → on first launch pick the **Standard** setup (downloads the SDK to `%LOCALAPPDATA%\Android\Sdk`).

2. **Environment variables** — Android Studio bundles its own JDK; `JAVA_HOME` must point at it (an old system Java breaks Gradle). In a normal PowerShell:

   ```powershell
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
   [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
   $p = [Environment]::GetEnvironmentVariable("Path", "User")
   [Environment]::SetEnvironmentVariable("Path", "$p;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "User")
   ```

   **Close and reopen every terminal** (and VS Code), then verify: `adb --version` works and `java -version` reports OpenJDK 17+ (not 1.8).
   _macOS/Linux:_ export `ANDROID_HOME=$HOME/Library/Android/sdk` (or `$HOME/Android/Sdk`) and add `platform-tools`/`emulator` to `PATH` in your shell profile.

3. **Windows only, if you also run Docker Desktop / Hyper-V:** the emulator needs the Windows Hypervisor Platform to coexist with it. In an **admin** PowerShell, then reboot:

   ```powershell
   Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
   ```

4. **Create an emulator:** Android Studio → **Virtual Device Manager** → _Create Virtual Device_ → **Pixel 8** → download the recommended system image (API 35/36, x86_64) → Finish → press **▶** to boot it. Verify `adb devices` lists it.

## Step 7 — Configure the mobile app

```powershell
copy mobile\.env.example mobile\.env        # macOS/Linux: cp mobile/.env.example mobile/.env
```

- **Emulator:** the default `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000` is correct as-is (10.0.2.2 = the host machine).
- **Physical device:** change it to `http://<your PC's LAN IP>:4000` (find it with `ipconfig`), keep phone + PC on the same Wi-Fi, and allow ports 4000 + 8081 through the firewall (see Troubleshooting).

These values are inlined at bundle time — restart Metro after changing them.

## Step 8 — Build and run the app (first build: 10–20 min)

The share-sheet feature uses custom native code, so the app runs as an Expo **development build** — it cannot run in Expo Go. With the emulator booted:

```powershell
cd mobile
npx expo prebuild --platform android     # generates the android/ project
npx expo run:android                     # Gradle build → installs on the emulator → starts Metro
```

When it finishes, the **Interview Evaluator** app opens showing a _Development Build_ launcher screen — **tap the `http://10.0.2.2:8081` server row** to load the app UI. That launcher is normal; you'll see it every time you open the dev build.

No local Android setup? Build in the cloud instead: `npx eas build --profile development --platform android`, install the produced APK on a device, then `npm run start`.

## Step 9 — Day-to-day (after the first build)

The app stays installed; you don't rebuild unless native config changes (anything under `plugins` in `mobile/app.json`, or new native packages):

```powershell
npm run dev:server     # terminal 1 (repo root) — backend
npm run dev:mobile     # terminal 2 — Metro; then open the app on the emulator
```

## Step 10 — Test the whole flow

1. **Recordings → Evaluated tab** already shows the seeded samples (proves app ↔ server connectivity).
2. **Import via share sheet:** drag any audio file onto the emulator window (lands in Downloads) → open the **Files** app → Downloads → long-press the file → **Share** → **Interview Evaluator** → add a candidate name → **Import**.
3. **Or import in-app:** tap the **upload icon** (top-right) or **"Upload a recording from this device"** and pick a file.
4. On the **Unevaluated** tab tap **Evaluate** (or **Evaluate all**) — the row goes _Transcribing → Scoring → Evaluated_ (~2 s in mock mode).
5. Tap the evaluated row: score, role, department › sub-category, the 5-category matrix with evidence, strengths/improvements, collapsible transcript.
6. Check the **Dashboard** tab; long-press any row to delete it.

---

## Testing with MOCK_AI (free)

`MOCK_AI=true` (the default) short-circuits both OpenAI calls with deterministic canned results — statuses still flow `TRANSCRIBING → SCORING → EVALUATED`, so the UI behaves exactly like production while costing nothing.

## Switching to real AI

In `server/.env`:

```
MOCK_AI=false
OPENAI_API_KEY=sk-...
```

Restart the server; the log switches to `Mode: real AI`. One OpenAI key powers both steps (transcription + scoring). Model IDs are centralized in `server/src/config/env.ts` and overridable via env:

- `OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize` — speaker-labelled transcripts. If your account lacks access, the server auto-falls back to `gpt-4o-transcribe`, then `whisper-1`.
- `OPENAI_EVAL_MODEL=gpt-5.4` — any chat-completions model works; GPT-5-family parameter quirks are handled automatically.

Test with a **real speech recording** — the seeded samples are silent placeholders, and already-evaluated rows reuse their existing (mock) transcripts on retry; delete + re-import for a clean real run.

## Auto-import from a watched folder + Dialer

The **Dialer** tab (mobile) adds two connected features.

**1. Watched folder.** Pick the folder where your call recorder saves audio (for Cube ACR: `CubeCallRecorder/All`) via Android's system folder picker — the grant is scoped to that one folder and persists across restarts. New audio files are uploaded to `POST /recordings` automatically. Scans run on launch, whenever the app returns to the foreground, on a timer while the app is open, and as a **daily sweep** at a configurable time (default 5 PM). An on-device ledger prevents duplicates.

- **Settling check** — a recorder writes its file for the entire call (15-30+ min), so a file is only uploaded once its **size has stopped changing for 25 s**. This is what stops a partial recording being uploaded mid-call. While files are still growing the scan interval tightens to ~12 s so they land promptly once the call ends; the UI shows "N files still being recorded".
- **Failure handling** — a permanently rejected file (4xx, e.g. unsupported type) is recorded and skipped so it can't block the queue; network/5xx failures stop the pass and retry on the next scan. The daily sweep clears the rejected list so everything gets one fresh attempt per day.

**2. Call a candidate.** Enter name + number → the phone's native dialer opens pre-filled (no `CALL_PHONE` permission needed) and a _pending call_ is registered. When that call's recording appears in the watched folder — matched by the phone number embedded in the filename, e.g. `Sai_98682_24211_20260820_125753.amr` — it is uploaded as **`Sai Kumar 2026-08-20 12-57.amr`** with the candidate name attached. Unmatched files import under their original names. Pending calls expire after 24 h.

**Renaming the file in the recorder's folder** (toggle, on by default) — after a _successful_ upload, the local file is also renamed to match. SAF exposes no rename operation (`File.rename()` throws on `content://` URIs), so it is emulated: create a new document with the target name → copy the bytes → **verify the byte count** → only then delete the original. Consequences worth knowing:

- Upload happens **before** the local rename, so the recording is safe on the server before anything on disk is touched. A failed rename leaves the original untouched.
- The copy passes through JS as base64, so files over **16 MB** keep their original name instead of risking an out-of-memory crash. 30 min of AMR is ~2 MB; a 30-min 128 kbps M4A would exceed the cap.
- Cube ACR keeps its own database of recordings. Because the rename is really create+delete, Cube's in-app list may show the old entry as missing. Turn the toggle off if that bothers you — the server-side name is unaffected either way.

**Scope:** all of this runs in-process, so it needs the app to be open. A phone sitting with the app closed at 5 PM sweeps as soon as the app is next opened (catch-up), not at 5 PM sharp. True app-closed scheduling needs `expo-background-task` (WorkManager, 15-min minimum interval) plus a native rebuild — the seam is `maybeSweep()` in `mobile/src/autoimport/AutoImportContext.tsx`. Everything else here is pure JS on existing native modules, so no rebuild is required.

## Google Drive mirror (optional)

Postgres stays the app's engine, but the server can mirror **everything** into a shared Google Drive folder: audio files into `Recordings/`, transcripts into `Transcripts/`, and one row per recording (all matrix scores, classification, links) in an auto-created **Evaluations** Google Sheet. Rows update live as recordings are imported, evaluated, or fail; deleting a recording also removes its Drive files and sheet row.

One-time setup:

1. [console.cloud.google.com](https://console.cloud.google.com) → create/pick a project → **APIs & Services → Library** → enable **Google Drive API** and **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account** (no roles needed) → open it → **Keys → Add key → JSON**. Save the file as `server/google-credentials.json` (gitignored).
3. In Google Drive, create your folder (e.g. **recruiter app**) and **share it with the service account's email** (`...@...iam.gserviceaccount.com`) as **Editor**.
4. In `server/.env`, set `GOOGLE_DRIVE_FOLDER_ID` to the ID from the folder's URL (`drive.google.com/drive/folders/<THIS_PART>`), then restart the server.
5. Mirror existing data: `npm run drive:sync -w server` (idempotent, safe to re-run).

The mirror is strictly best-effort — if Drive is unreachable or unconfigured, the app works exactly as before.

## Editing the taxonomy

One file: **`server/src/config/taxonomy.ts`** (departments → sub-categories). It drives the AI classification prompt, validation, and the app's filters. After editing, re-run `npm run db:seed` to refresh the DB mirror. "Other" is always available as a fallback and the free-text role/designation is always captured.

## API reference (all JSON; header `x-api-key: <API_KEY>` required except `/health`)

| Method | Path                                           | Description                                                  |
| ------ | ---------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/health`                                      | liveness + mode (no auth)                                    |
| POST   | `/recordings`                                  | multipart import: `file` + optional `candidateName`, `notes` |
| GET    | `/recordings?status=&department=&subCategory=` | list, newest first                                           |
| GET    | `/recordings/:id`                              | detail incl. transcript + evaluation                         |
| POST   | `/recordings/:id/evaluate`                     | run pipeline (async, 202) — also retry/re-evaluate           |
| POST   | `/evaluate/bulk`                               | evaluate all UNEVALUATED (resumable, re-trigger safe)        |
| GET    | `/evaluate/bulk/status`                        | bulk progress for polling                                    |
| DELETE | `/recordings/:id`                              | delete recording + transcript + evaluation + file            |
| GET    | `/dashboard/stats`                             | aggregates for the dashboard                                 |
| GET    | `/taxonomy`                                    | current departments/sub-categories                           |

Pipeline statuses: `UNEVALUATED → TRANSCRIBING → SCORING → EVALUATED | FAILED` (with `errorMessage`). Recordings interrupted by a restart are auto-reset to `UNEVALUATED` on boot — nothing gets stuck.

## Scripts

| Command (repo root)                            | What it does                         |
| ---------------------------------------------- | ------------------------------------ |
| `npm run db:up` / `db:down`                    | start/stop Postgres                  |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma migrate / seed / data browser |
| `npm run dev:server`                           | backend with hot reload (tsx watch)  |
| `npm run dev:mobile`                           | Metro for the dev client             |
| `npm run android`                              | build + run the Android dev build    |
| `npm run drive:sync -w server`                 | backfill the Google Drive mirror     |
| `npm run typecheck`                            | strict TS across all packages        |
| `npm run lint` / `format`                      | ESLint (server+shared) / Prettier    |

## Troubleshooting

- **Gradle fails mentioning Java/JVM/toolchains:** `JAVA_HOME` isn't set to Android Studio's bundled JDK (step 6.2), or the terminal wasn't reopened after setting it.
- **Emulator won't boot or crawls (with Docker installed):** enable Windows Hypervisor Platform (step 6.3) and reboot.
- **App can't reach the server (physical device):** use your PC's LAN IP in `mobile/.env`, same Wi-Fi, and allow the ports in an admin PowerShell:
  `New-NetFirewallRule -DisplayName "RecruitLens API" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow`
  `New-NetFirewallRule -DisplayName "Expo Metro" -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow`
  The dev build already allows plain `http://` via `expo-build-properties`.
- **Emulator:** `http://10.0.2.2:4000` is the host machine — don't use `localhost`.
- **Changed `mobile/.env` but nothing happened:** `EXPO_PUBLIC_*` vars are inlined at bundle time — restart Metro.
- **QR code does nothing in Expo Go:** this app can't run in Expo Go (custom native modules). Use the dev build from step 8; scan the QR with the phone's _camera_ app instead once the dev build is installed.
- **App missing from the share sheet:** old build — re-run `npx expo prebuild --platform android && npx expo run:android` after any `app.json` plugin change.
- **Dependency version drift** (Expo warnings on start): `cd mobile && npx expo install --fix`. Note: `expo-font` is deliberately pinned via an npm `override` in the root `package.json` — keep it matching the Expo SDK.
- **Build fails with "Error while dexing" / unreadable jar in `.gradle\caches`:** a corrupted Gradle cache (often after an interrupted build). Fix: `cd mobile\android; .\gradlew --stop` then delete `%USERPROFILE%\.gradle\caches\<gradle-version>\transforms` and rebuild.
- **Evaluation FAILED:** the row shows the error + Retry. Retry reuses the existing transcript (re-scores only); delete + re-import for a full redo. Common real-mode causes: missing `OPENAI_API_KEY`, no billing/quota, model access.
- **`prisma migrate` can't connect:** Docker running? `docker compose ps` should show the DB healthy. Note the DB is on port **5433**.

## Stubbed for later (seams are built)

- **In-app calling (CPaaS)** — the Dialer tab currently opens the phone's native dialer and relies on the watched-folder auto-import; true click-to-call (Exotel/Plivo → webhook import) is documented as the next step in `mobile/src/screens/DialerScreen.tsx`.
- **GoogleDriveStorage** — `server/src/storage/GoogleDriveStorage.ts` implements the `StorageAdapter` interface as a documented stub (the Drive _mirror_ above is separate and already live); swap it in via `server/src/storage/index.ts`.
- **Real auth** — replace the API-key middleware (`server/src/middleware/apiKey.ts`) with recruiter accounts; the TODO marks the seam.

# Deploy RecruitLens for testing — free backend on Render + APK from EAS

Two halves, in this order:

1. **[Backend → Render](#part-1--backend-on-render)** (free web service; database on Neon). Gives you an `https://….onrender.com` URL.
2. **[APK → EAS Build](#part-2--apk-via-eas-build)** (free Expo cloud build). Produces a standalone APK you install on any Android phone — no Metro, no USB cable, no Android Studio.

Everything the repo needs is already committed: [`render.yaml`](render.yaml) (the Render blueprint) and the `preview` profile in [`mobile/eas.json`](mobile/eas.json).

**Why the database isn't on Render:** Render's free plan allows exactly **one** free Postgres per account, and this account's free slot is already used by a separate, live project. `render.yaml` deliberately has no `databases:` block — the database lives on [Neon](https://neon.tech) instead (also free, and unlike Render's it doesn't expire after 30 days), fully isolated from that other project.

---

## Part 1 — Backend on Render

### 1.1 Create the free database on Neon

1. Sign up at [neon.tech](https://neon.tech) (GitHub login works) → **Create a project**. Pick a region close to Render's — **Singapore / ap-southeast-1** if offered, otherwise the nearest one.
2. Neon shows a connection string immediately, something like:
   ```
   postgresql://neondb_owner:AbC123@ep-cool-name-12345.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   Copy it — this is the whole `DATABASE_URL`, `?sslmode=require` and all. Nothing else to configure; the default `neondb` database it creates is fine to use as-is.

### 1.2 Push the branch to GitHub

This deploys from **`chore/deploy-render-eas`**, not `main` — main is left untouched on purpose (this is the test/staging setup):

```bash
git push origin chore/deploy-render-eas
```

### 1.3 Create the service from the blueprint

1. Sign in at [dashboard.render.com](https://dashboard.render.com) (GitHub login is easiest — it also grants repo access).
2. **New ▾ → Generate Blueprint** (Render's current name for what creates resources from a `render.yaml`).
3. Pick the `recruit-lens` repository. Render shows a **branch selector** — set it to **`chore/deploy-render-eas`** (not the default `main`), since that's the branch that actually contains `render.yaml`.
4. Render finds `render.yaml` and previews one resource: `recruitlens-api` — Node web service, free plan, Singapore. (No database in the preview — that's expected, see above.)
5. It prompts for the three secrets marked `sync: false` in the blueprint:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the full connection string you copied from Neon in step 1.1. |
   | `API_KEY` | the shared secret the app sends as `x-api-key`. Must match `EXPO_PUBLIC_API_KEY` in `mobile/eas.json`. |
   | `OPENAI_API_KEY` | your `sk-…` key. Never goes into the repo or the APK — server-side only. |

6. **Apply**. First deploy takes ~4–6 min (npm install + `prisma migrate deploy` against Neon).

### 1.4 Verify

Copy the service URL from the top of the service page, then:

```bash
curl https://YOUR-SERVICE.onrender.com/health
```

Expected: `{"ok":true,"mockAi":false}`. The `mockAi:false` confirms the real OpenAI pipeline is active.

Auth check — this should return the taxonomy JSON, not a 401:

```bash
curl -H "x-api-key: YOUR_API_KEY" https://YOUR-SERVICE.onrender.com/taxonomy
```

### 1.5 What the free tier means in practice

- **Render's instance sleeps after ~15 min idle.** The next request pays a ~50 s cold start. The app's request timeout was raised to 60 s so this shows up as "slow" rather than as an error. Pull-to-refresh once to wake it, then use it normally.
- **Neon's compute scales to zero after ~5 min idle too** — a separate, much shorter cold start (typically well under a second) on the database side. Usually invisible underneath Render's own wake-up; not something to worry about separately.
- **No persistent disk on Render.** Uploaded audio lives in `/tmp` and is lost on redeploy or after a sleep cycle. Transcripts, scores and dashboard data live in Postgres (on Neon) and persist normally. Practical rule: **evaluate a recording in the same session you import it.** If the audio is gone, re-evaluating a `FAILED` row still works (it reuses the stored transcript), but a fresh transcription does not — delete and re-import.
- **Neon's free plan does not expire** (unlike Render's own free Postgres, which is deleted after 30 days) — one less thing to redo later. It does cap storage at 0.5 GB and 100 compute-hours/month, both far beyond what testing needs.
- **512 MB RAM on Render.** Fine for this workload. The build deliberately installs only the `shared` + `server` workspaces so the React Native dependency tree never enters the build.

### 1.6 Optional — keep it awake

A free cron pinger (e.g. [cron-job.org](https://cron-job.org)) hitting `/health` every 10 minutes keeps the instance warm through a testing day. Render's own cron jobs are a paid feature.

---

## Part 2 — APK via EAS Build

This machine has no Android SDK and only Java 8, so the APK is built in Expo's cloud. Free-tier builds queue behind paid ones — expect **10–30 min** for the first one.

### 2.1 Point the app at the deployed backend

Edit [`mobile/eas.json`](mobile/eas.json) → `build.preview.env`:

```json
"env": {
  "EXPO_PUBLIC_API_BASE_URL": "https://YOUR-SERVICE.onrender.com",
  "EXPO_PUBLIC_API_KEY": "the same API_KEY you set on Render"
}
```

No trailing slash on the URL. Both values are **baked into the APK at build time** — changing either one later means rebuilding.

> `mobile/.env` is *not* used by cloud builds: it is gitignored, so EAS never uploads it. `eas.json` is the source of truth for build-time config. Both values are inevitably readable inside any installed APK, so treat `API_KEY` as a soft gate, not a real secret — the OpenAI key stays on the server, which is what actually matters. To rotate without committing values, use `eas env:create --scope project` instead.

### 2.2 Log in to Expo

Create a free account at [expo.dev](https://expo.dev) if you do not have one, then:

```bash
npx eas-cli login
```

This one is yours to run — it asks for your password. Everything after it can be driven for you.

### 2.3 Link the project

From the `mobile/` directory:

```bash
npx eas-cli init
```

Creates the project on your Expo account and writes `extra.eas.projectId` into `mobile/app.json`. Commit that change.

### 2.4 Build

```bash
npx eas-cli build --platform android --profile preview
```

On the first Android build it asks **"Generate a new Android Keystore?"** → **Yes**. EAS stores the keystore for you; reuse it for every later build so updates install over the old app instead of conflicting with it.

When the build finishes, the CLI prints a download URL. It is also listed under **Builds** on expo.dev.

### 2.5 Install on the phone

Open the build URL on the Android device (or scan the QR the CLI prints) → download the `.apk` → tap it → allow "install from unknown sources" for your browser when prompted.

`expo-share-intent` is compiled into this build, so **RecruitLens appears in the Android share sheet** for audio files. No dev client needed.

### 2.6 Smoke test the whole loop

1. Open the app → **Recordings**. An empty list that loads without an error banner means app ↔ Render auth is working. The first open may take ~50 s while the instance wakes.
2. **Dashboard** tab → loads zeroed stats.
3. Record something on the phone's voice recorder, or open any audio file → **Share → Interview Evaluator** → add a candidate name → **Import**. Or use the in-app upload icon.
4. **Unevaluated** tab → **Evaluate**. Watch `Transcribing → Scoring → Evaluated`. Real transcription of a few minutes of audio takes roughly 20–60 s.
5. Tap the row: overall score, detected role, department › sub-category, the 5-category matrix with evidence, strengths/improvements, and the transcript.
6. **Dashboard** now aggregates it.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| App shows "Cannot reach the server at …" | URL typo in `eas.json` (needs `https://`, no trailing slash), or the Render service is failing — check **Logs** in the Render dashboard. |
| Every request 401s | `EXPO_PUBLIC_API_KEY` in `eas.json` does not match `API_KEY` on Render. Fix and rebuild the APK. |
| First request times out, later ones work | Normal cold start. Retry. |
| Render build fails at `prisma migrate deploy` | `DATABASE_URL` is wrong, missing `?sslmode=require`, or was mistyped when pasted into Render. Open the Neon project → copy the connection string again → update the env var on Render → **Manual Deploy → Deploy latest commit**. |
| Evaluation lands in `FAILED` with an OpenAI error | Bad or absent `OPENAI_API_KEY`, no billing/quota, or no access to the configured model. Override `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_EVAL_MODEL` on Render to models your account can use. Transcription fallbacks (`gpt-4o-transcribe`, then `whisper-1`) are automatic. |
| Evaluation lands in `FAILED` with a missing-file error | The audio was lost to the ephemeral disk (see 1.4). Delete the row and re-import. |
| App missing from the share sheet | An APK built before `expo-share-intent` was configured, or a dev-client build. Rebuild with `--profile preview`. |
| EAS build fails resolving `@interview-evaluator/shared` | Run the build from `mobile/`, not the repo root, so EAS detects the workspace. `metro.config.js` already maps the monorepo. |
| Want to switch back to free mock AI | Set `MOCK_AI=true` on Render and redeploy. **No APK rebuild needed** — it is a server-side flag. |

## Switching the deployed server later

All server-side, all via Render **Environment** → edit → auto-redeploy, with no APK rebuild:

- `MOCK_AI` — `true` for free canned results, `false` for real OpenAI.
- `OPENAI_EVAL_MODEL` / `OPENAI_TRANSCRIBE_MODEL` — swap models.
- `BULK_CONCURRENCY` — raise for faster "Evaluate all" (watch the 512 MB RAM ceiling).
- `GOOGLE_DRIVE_FOLDER_ID` plus credentials — enable the Drive/Sheets mirror (see the README).

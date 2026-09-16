# Deploy the backend to an Azure VM

Replaces the Render free tier. The database stays on Neon — the VM points at the same connection string, so there is no data migration and nothing is lost.

Two ways to expose it. **Option A is much less work** and is the recommended one if you already run a TLS site on the machine.

| | Option A — behind an existing site | Option B — standalone |
|---|---|---|
| URL | `https://yourdomain.com/interview/api` | `https://api.yourdomain.com:8100` |
| Certificate | reuses yours | new Let's Encrypt cert |
| DNS record | none | new A record |
| Extra port open | none | 80 + 8100 |
| Touches a live config | yes — one additive block | no |

## Why move off Render at all

- **Audio stops disappearing.** The free tier had no persistent disk, so every redeploy wiped uploaded audio while the database row survived — that is the "audio unavailable" state in the player. On a VM the files stay.
- **No cold starts.** No ~50 s wait on the first request after idle.
- **Real CPU** for ffmpeg, which matters as transcoding and screening move into the upload path.

In exchange you take on OS patching, certificate renewal (automated), and backups.

---

# Option A — mount it under your existing site

Your site already terminates TLS. The API becomes another path on it, so there is no certificate, no DNS change, and no new port. The backend listens only on `127.0.0.1` and is never directly reachable.

### A1 — Check which port is free

The backend defaults to **4100** (not 4000 — that is too often already taken on a shared machine):

```bash
sudo ss -ltnp | grep -E '4[0-9]{3}'
```

If 4100 is in use, pick another and set `PORT` in the env file in the next step, keeping it matched to the `proxy_pass` port in the nginx block.

### A2 — Let the VM read the private repo

```bash
sudo useradd --system --home /opt/recruitlens --shell /usr/sbin/nologin recruitlens
sudo -u recruitlens install -d -m 0700 /opt/recruitlens/.ssh
sudo -u recruitlens ssh-keygen -t ed25519 -C "azure-vm" -f /opt/recruitlens/.ssh/id_ed25519 -N ""
sudo cat /opt/recruitlens/.ssh/id_ed25519.pub
```

Add that public key on GitHub under **Settings → Deploy keys → Add deploy key** (read-only) on `zaahid-healthark/recruit-lens`.

### A3 — Run the setup script

```bash
git clone --depth 1 --branch chore/deploy-render-eas \
  https://github.com/zaahid-healthark/recruit-lens.git /tmp/rl
sudo /tmp/rl/deploy/azure/setup.sh behind-proxy
```

The **first run** installs Node 22, creates directories, writes a config template and stops. Fill it in:

```bash
sudo nano /etc/recruitlens/api.env
```

| Key | Value |
|---|---|
| `PORT` | `4100`, or whatever you confirmed is free |
| `DATABASE_URL` | your existing Neon string, unchanged (keep `?sslmode=require`) |
| `API_KEY` | `WHAqFj_8MqlqhlKANlvCx7tLFZ_5lqlU` — must match `EXPO_PUBLIC_API_KEY` in `mobile/eas.json` |
| `OPENAI_API_KEY` | your `sk-…` key |

`STORAGE_DIR` is already set to the persistent path. Run the same command again:

```bash
sudo /tmp/rl/deploy/azure/setup.sh behind-proxy
```

It clones the code, installs the `shared` + `server` workspaces, applies migrations to Neon, and starts the service under systemd. Confirm it is up locally before touching nginx:

```bash
curl http://127.0.0.1:4100/health
```

### A4 — Add the route to your existing nginx site

Open the `server { listen 443 ssl; … }` block for your domain and paste in the two blocks from [`deploy/azure/nginx-path-prefix.conf`](deploy/azure/nginx-path-prefix.conf). Leave the certificate lines and your existing `/` and `/api` locations exactly as they are — nginx matches the **longest** prefix, so `/interview/api/` wins over `/` without any reordering.

**Always test before reloading** — this is a live site:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` validates the whole config; if it fails, nothing is reloaded and your site keeps running on the old config.

### A5 — Verify

```bash
curl https://yourdomain.com/interview/api/health
curl -H "x-api-key: WHAqFj_8MqlqhlKANlvCx7tLFZ_5lqlU" https://yourdomain.com/interview/api/recordings
```

The second should list your existing recordings — same Neon database.

### A6 — Point the app at it

Set both profiles in [`mobile/eas.json`](mobile/eas.json):

```json
"EXPO_PUBLIC_API_BASE_URL": "https://yourdomain.com/interview/api"
```

No trailing slash (the app strips one defensively, but keep it clean). Rebuild — the URL is inlined at bundle time:

```bash
cd mobile && npx eas-cli build --platform android --profile preview
```

Keep Render alive until the new APK is confirmed working, then delete that service so it stops redeploying on every push.

---

# Option B — standalone on its own port

Only if the API should own its own hostname rather than share your existing one.

### B1 — Create the VM

- **Image:** Ubuntu Server 24.04 LTS
- **Size:** `Standard_B2s` (2 vCPU / 4 GiB) — ffmpeg on 25-minute recordings is painful on 1 vCPU
- **Networking → Public IP → Allocation: `Static`.** The default is Dynamic, which changes the address whenever the VM deallocates and would silently break every installed APK, since the URL is baked in at build time.

Inbound rules in the Network Security Group:

| Port | Source | Why |
|---|---|---|
| 22 | your IP only | SSH |
| 80 | any | Let's Encrypt validation only |
| 8100 | any | the API |

Do **not** open 4100 — node listens there but only nginx talks to it.

> **Port 80 cannot be skipped.** Let's Encrypt's HTTP-01 challenge is hard-wired to port 80 and cannot be pointed at 8100. It is needed for the initial certificate *and* every automatic 60-day renewal. nginx serves nothing there but the challenge path.

### B2 — DNS

```
api.yourdomain.com.   A   <VM static IP>
```

Confirm before continuing, or issuance fails:

```bash
dig +short api.yourdomain.com
```

### B3 — Run setup (deploy key first, as in A2)

```bash
sudo /tmp/rl/deploy/azure/setup.sh standalone api.yourdomain.com you@yourdomain.com
```

Same two-run pattern: fill in `/etc/recruitlens/api.env`, then run it again. The second run also installs nginx, obtains the certificate, configures the firewall, and starts serving TLS on 8100.

### B4 — Verify and point the app

```bash
curl https://api.yourdomain.com:8100/health
```

Then set `EXPO_PUBLIC_API_BASE_URL` to `https://api.yourdomain.com:8100` and rebuild.

---

## Operations

The setup script is idempotent, so it doubles as the deploy command:

```bash
sudo /opt/recruitlens/deploy/azure/setup.sh behind-proxy          # Option A
sudo /opt/recruitlens/deploy/azure/setup.sh standalone api.yourdomain.com you@you.com
```

```bash
sudo journalctl -u recruitlens -f      # logs
sudo systemctl restart recruitlens     # restart
sudo certbot renew --dry-run           # Option B only: prove renewal works
```

### Updating an existing deployment

```bash
cd <the cloned repo>
git checkout -- package-lock.json   # npm install rewrites it; discard before pulling
git pull
npm install
npm run migrate:deploy -w server    # only when the pull added a migration
sudo systemctl restart recruitlens
```

## The browser app

The backend serves a browser client itself, from `server/web/`, so there is no
second thing to deploy and no static host to pay for. Behind the Option A proxy
it lands at:

```
https://curie.healthark.ai/interview/api/app/
```

Upload a recording, optionally attach a job description, and the scored report
appears on the page. It asks once for the `API_KEY` and keeps it in that browser
only — the same shared secret the mobile app sends.

Two things make it survive the path prefix, both deliberate:

- **It derives the API root from its own URL**, so the prefix never has to be
  configured anywhere and the same file also works at a bare
  `http://<host>:<port>/app/` with no proxy at all.
- **It is a single self-contained HTML file**, and every redirect to it is
  relative. A separate `styles.css`, or an absolute `Location: /app/`, would
  resolve against the domain root, land outside the proxied location block, and
  404 — the same trailing-slash trap as `proxy_pass`.

## Checking the scoring itself

The rubric decides who gets advanced, so it is testable like anything else:

```bash
npm run score:check -w server
```

This scores fixture transcripts written to provoke the two ways interview
scoring goes wrong — a fluent candidate who says nothing concrete, and a terse
one whose every answer is correct — and checks the verdict against what a
recruiter would conclude. It needs `MOCK_AI=false` and a real `OPENAI_API_KEY`;
it transcribes nothing, so a run costs a few cents. Add a fixture in
`server/scripts/fixtures/scoringScenarios.ts` whenever a real call is scored
wrongly, then fix the rubric in `server/src/ai/prompts.ts` until it passes.

Ranking is separate and deterministic: `GET /jobs/:id/ranking` compares a job's
candidates from stored evaluations only, so it costs nothing, returns the same
answer every time, and can be re-read months later to explain a decision.

## Measuring what an evaluation costs

Set these in `server/.env` and restart:

```
LANGFUSE_PUBLIC_KEY="pk-lf-…"
LANGFUSE_SECRET_KEY="sk-lf-…"
LANGFUSE_BASE_URL="https://cloud.langfuse.com"
```

Every evaluation then appears as one trace with its transcription and scoring
calls beneath it, priced from the token counts each returns. That turns the
per-call figure from an estimate into a measurement, and makes the split
visible — transcription against scoring, and what a repair retry costs when
the model's first JSON fails validation.

Two things worth knowing before you turn it on:

- **Interview content is NOT sent by default.** Only model names, token counts
  and timings leave the VM. `LANGFUSE_CAPTURE_CONTENT=true` adds the prompts
  and completions, which means transcripts of real candidates reach a
  third-party service — worth a deliberate decision rather than a default.
- **Tracing can never fail an evaluation.** Every call is wrapped and
  fire-and-forget, so an unreachable Langfuse, a wrong key or a network stall
  costs a candidate nothing. Leaving the keys unset disables it completely.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every API route 404s through the proxy | The trailing slash on `proxy_pass http://127.0.0.1:4100/` is missing. Without it nginx forwards `/interview/api/recordings` instead of `/recordings`. |
| Upload fails with **413** | `client_max_body_size` below multer's 500 MB limit. nginx defaults to 1 MB; the supplied blocks set 512 MB. |
| Upload times out on long recordings | `proxy_read_timeout` too low. Import runs a synchronous ffmpeg decode before responding; the supplied blocks allow 600 s. |
| Requests reach the frontend instead of the API | Base URL has a trailing slash, producing `//recordings`. The app strips it, but an older APK may not. |
| Everything 401s | `API_KEY` on the VM does not match `EXPO_PUBLIC_API_KEY` baked into the APK. |
| Service will not start | `sudo journalctl -u recruitlens -n 50` — usually a bad `DATABASE_URL`. |
| Browser app 404s | Visit the URL **with** its trailing slash (`/interview/api/app/`). Without one the server issues a relative redirect to add it; an old build that redirected absolutely would land on `https://<host>/app/`, outside the proxied block. |
| Browser app says the key was rejected | `API_KEY` on the VM changed. Click **Key** in the header and re-enter it. |
| Report shows "Not assessed" everywhere | Working as intended: the call never covered those areas. A score there would be invented. |
| Port already in use | Something else holds the port. `sudo ss -ltnp \| grep 4100`, then change `PORT` and the `proxy_pass` port together. |
| Certificate issuance fails (Option B) | Port 80 closed, or DNS not yet pointing at the VM. |

## Backups

Neon handles the database. The VM holds uploaded audio — transcripts and scores live in Neon, the audio does not, so copy it periodically if the recordings matter beyond evaluation:

```bash
sudo tar czf /tmp/recruitlens-audio-$(date +%F).tgz -C /var/lib/recruitlens uploads
```

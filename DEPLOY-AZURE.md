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

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every API route 404s through the proxy | The trailing slash on `proxy_pass http://127.0.0.1:4100/` is missing. Without it nginx forwards `/interview/api/recordings` instead of `/recordings`. |
| Upload fails with **413** | `client_max_body_size` below multer's 500 MB limit. nginx defaults to 1 MB; the supplied blocks set 512 MB. |
| Upload times out on long recordings | `proxy_read_timeout` too low. Import runs a synchronous ffmpeg decode before responding; the supplied blocks allow 600 s. |
| Requests reach the frontend instead of the API | Base URL has a trailing slash, producing `//recordings`. The app strips it, but an older APK may not. |
| Everything 401s | `API_KEY` on the VM does not match `EXPO_PUBLIC_API_KEY` baked into the APK. |
| Service will not start | `sudo journalctl -u recruitlens -n 50` — usually a bad `DATABASE_URL`. |
| Port already in use | Something else holds the port. `sudo ss -ltnp \| grep 4100`, then change `PORT` and the `proxy_pass` port together. |
| Certificate issuance fails (Option B) | Port 80 closed, or DNS not yet pointing at the VM. |

## Backups

Neon handles the database. The VM holds uploaded audio — transcripts and scores live in Neon, the audio does not, so copy it periodically if the recordings matter beyond evaluation:

```bash
sudo tar czf /tmp/recruitlens-audio-$(date +%F).tgz -C /var/lib/recruitlens uploads
```

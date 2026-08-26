# Deploy the backend to an Azure VM

Replaces the Render free tier. The database stays on Neon — nothing about it changes, the VM just points at the same connection string.

**End state:** `https://api.yourdomain.com:8100`, TLS from Let's Encrypt, audio on a persistent disk, node running under systemd and restarting on boot.

## Why this is worth doing

- **Audio stops disappearing.** Render's free tier had no persistent disk, so every redeploy wiped uploaded audio while the database row survived — the "audio unavailable" state in the player. A VM disk just keeps the files.
- **No cold starts.** No more ~50 s wait on the first request after idle.
- **Real CPU** for ffmpeg, which matters as transcoding and screening move into the upload path.

What you take on in exchange: OS patching, certificate renewal (automated below), and backups.

---

## Part 1 — Create the VM

1. Azure Portal → **Create a virtual machine**
   - **Image:** Ubuntu Server 24.04 LTS
   - **Size:** `Standard_B2s` (2 vCPU / 4 GiB). ffmpeg transcoding is the bottleneck; 1 vCPU is painful on 25-minute recordings.
   - **Authentication:** SSH public key
   - **Region:** closest to your recruiters
2. **Networking → Public IP → set Allocation to `Static`.** The default is Dynamic, which changes the address whenever the VM is deallocated — and would silently break every installed APK, since the URL is baked in at build time.
3. **Network Security Group** — inbound rules:

   | Port | Source | Why |
   |---|---|---|
   | 22 | **Your IP only** | SSH. Do not leave open to the internet. |
   | 80 | Any | Let's Encrypt validation *only* — see the note below. |
   | 8100 | Any | The API itself. |

   Do **not** open 4000. Node listens there but only nginx talks to it.

> **Why port 80 must be open even though the API is on 8100:** Let's Encrypt's HTTP-01 challenge is hard-wired to port 80 and cannot be pointed at another port. It is needed for the initial certificate *and* for every automatic 60-day renewal. nginx serves nothing on 80 except the challenge path; everything else redirects to `:8100`.

## Part 2 — DNS

Add an **A record** pointing at the VM's static IP:

```
api.yourdomain.com.   A   <VM static IP>
```

Confirm it resolves before continuing — certificate issuance fails otherwise:

```bash
dig +short api.yourdomain.com
```

## Part 3 — Let the VM read the repo

The repo is private, so the VM needs its own read-only key. On the VM:

```bash
sudo -u recruitlens ssh-keygen -t ed25519 -C "azure-vm" -f /opt/recruitlens/.ssh/id_ed25519 -N ""
```

(If the user does not exist yet, run `sudo ./setup.sh` once first — it creates the user, writes an env template, and exits.)

Copy the public key and add it in GitHub under **Settings → Deploy keys → Add deploy key** (read-only) on `zaahid-healthark/recruit-lens`.

## Part 4 — Run the setup script

```bash
ssh azureuser@api.yourdomain.com
git clone --depth 1 --branch chore/deploy-render-eas https://github.com/zaahid-healthark/recruit-lens.git /tmp/rl
sudo /tmp/rl/deploy/azure/setup.sh api.yourdomain.com you@yourdomain.com
```

The **first run** installs Node 22, nginx, certbot and ufw, creates the service user and data directories, writes a config template, then stops. Fill it in:

```bash
sudo nano /etc/recruitlens/api.env
```

| Key | Value |
|---|---|
| `DATABASE_URL` | your existing Neon string, unchanged (keep `?sslmode=require`) |
| `API_KEY` | `WHAqFj_8MqlqhlKANlvCx7tLFZ_5lqlU` — must match `EXPO_PUBLIC_API_KEY` in `mobile/eas.json` |
| `OPENAI_API_KEY` | your `sk-…` key |

`STORAGE_DIR` is already set to `/var/lib/recruitlens/uploads` — the persistent path. Then run the same command again:

```bash
sudo /tmp/rl/deploy/azure/setup.sh api.yourdomain.com you@yourdomain.com
```

The second run clones the code, installs the `shared` + `server` workspaces, applies migrations to Neon, installs the systemd unit, configures the firewall, obtains the certificate, and starts everything.

## Part 5 — Verify

```bash
curl https://api.yourdomain.com:8100/health
```

Expect `{"ok":true,"mockAi":false}`. Then check auth:

```bash
curl -H "x-api-key: WHAqFj_8MqlqhlKANlvCx7tLFZ_5lqlU" https://api.yourdomain.com:8100/taxonomy
```

Your existing recordings should be listed — same Neon database, so nothing was migrated or lost:

```bash
curl -H "x-api-key: WHAqFj_8MqlqhlKANlvCx7tLFZ_5lqlU" https://api.yourdomain.com:8100/recordings
```

## Part 6 — Point the app at it

Edit both profiles in [`mobile/eas.json`](mobile/eas.json):

```json
"EXPO_PUBLIC_API_BASE_URL": "https://api.yourdomain.com:8100"
```

Then rebuild — the URL is inlined at bundle time, so a rebuild is unavoidable:

```bash
cd mobile && npx eas-cli build --platform android --profile preview
```

Keep Render running until the new APK is installed and confirmed working. Once it is, delete the Render service so it stops redeploying on every push.

---

## Operations

**Deploy a new version** — the setup script is idempotent, so it doubles as the deploy command:

```bash
sudo /opt/recruitlens/deploy/azure/setup.sh api.yourdomain.com you@yourdomain.com
```

**Logs:**

```bash
sudo journalctl -u recruitlens -f
```

**Restart / status:**

```bash
sudo systemctl restart recruitlens
sudo systemctl status recruitlens
```

**Certificate renewal** is automatic via certbot's timer, with a deploy hook that reloads nginx. Verify it works without waiting 60 days:

```bash
sudo certbot renew --dry-run
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Upload fails with **413** | `client_max_body_size` below multer's 500 MB limit. nginx defaults to 1 MB; the shipped config sets 512 MB. |
| Upload times out on long recordings | `proxy_read_timeout` too low. Import runs a synchronous ffmpeg decode before responding; the shipped config allows 600 s. |
| Certificate issuance fails | Port 80 closed in the NSG, or DNS not yet pointing at the VM. Both are required — HTTP-01 cannot use 8100. |
| App reaches the server but every call 401s | `API_KEY` on the VM does not match `EXPO_PUBLIC_API_KEY` baked into the APK. |
| App cannot reach the server at all | Port 8100 missing from the NSG *or* from ufw. Check both: `sudo ufw status`. |
| Service will not start | `sudo journalctl -u recruitlens -n 50`. Usually a bad `DATABASE_URL` in `/etc/recruitlens/api.env`. |

## Backups

Neon handles database backups. The VM holds uploaded audio — worth a periodic copy if those recordings matter beyond evaluation, since transcripts and scores live in Neon but the audio does not:

```bash
sudo tar czf /tmp/recruitlens-audio-$(date +%F).tgz -C /var/lib/recruitlens uploads
```

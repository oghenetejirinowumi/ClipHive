# How ClipHive is deployed

**Owner:** TJ. Please don't change this setup (or `deploy/`) without checking with TJ first.

## What runs where

| Part | Where | Address |
|---|---|---|
| Website (Next.js, `frontend/`) | **Vercel** (Hobby, free) | https://clip-hive-beige.vercel.app |
| API (FastAPI, `backend/`) | **AWS EC2** `cliphive-api`, t3.small, Ubuntu 24.04, Stockholm (eu-north-1), on AWS Free plan credits | https://cliphive-api.duckdns.org |
| API web address | **DuckDNS** (free) → Elastic IP `16.171.88.136` | |
| HTTPS certificate | **Caddy** on the server (Let's Encrypt, renews itself) | |
| Database, videos, uploads | The server's own 30 GB disk (`/var/lib/cliphive`) | |
| Code | **GitHub** `main` | |

**Render is not used.** `render.yaml` is an unused alternative; nothing reads it. S3 storage is supported by the code but switched off (no `S3_BUCKET` set), so media stays on the server's disk.

## How a change goes live

Push to `main`, and both halves update by themselves:

- **Website:** Vercel builds `main` within ~2 minutes. If the build fails, the previous version stays live.
- **API:** the server checks GitHub every 3 minutes (`cliphive-update.timer`) and deploys new commits through `deploy/oracle/update.sh`, which:
  1. backs up the database (last 10 deploys + one daily copy in `/var/lib/cliphive/backups`),
  2. installs packages and **runs all backend tests in a sandbox**. If anything fails, the deploy is **blocked** and the current version keeps running,
  3. restarts and waits for `/health` to report the new version. If it doesn't come up, it **rolls back** to the previous version by itself.

**Keep `main` working:** run `npm run lint`, `npx tsc --noEmit`, `node scripts/check-design.mjs` (frontend) and `pytest` (backend) before pushing. A push that fails the server tests won't go live on the API, but Vercel will still publish its website half.

## Is it working? (no login needed)

- https://cliphive-api.duckdns.org/health shows `"version"`, the commit that's live. It should match the latest commit on `main` a few minutes after a push.
- If it also shows `"blocked"`, a push didn't go live (and why). The fix is a new push that passes the tests.

## On the server

Connect: AWS console → EC2 → Instances → `cliphive-api` → Connect → EC2 Instance Connect.

| What | Command |
|---|---|
| Deploy now (same checks as the timer) | `sudo bash /opt/cliphive/deploy/oracle/update.sh` |
| API logs | `sudo journalctl -u cliphive -f` |
| Auto-deploy logs | `sudo journalctl -u cliphive-update -n 100` |
| Why the last deploy was blocked | `cat /var/lib/cliphive/last-failed-tests.log` |
| Settings (keys, allowed websites) | `sudo nano /etc/cliphive/cliphive.env`, then `sudo systemctl restart cliphive` |
| Restore a database backup | `sudo systemctl stop cliphive && sudo cp /var/lib/cliphive/backups/<file>.db /var/lib/cliphive/cliphive.db && sudo chown cliphive:cliphive /var/lib/cliphive/cliphive.db && sudo systemctl start cliphive` |
| Deploy a branch other than `main` | `echo production \| sudo tee /etc/cliphive/deploy-branch` (and set the same Production Branch in Vercel) |

Settings and secrets live only in `/etc/cliphive/cliphive.env` on the server. They are never in git, so a pull can't change them.

**Adding a website address** (e.g. a new Vercel domain): add it to `CORS_ORIGINS` in the settings file (comma-separated), restart, and add it to the Google OAuth client's *Authorized JavaScript origins*.

## Things to know

- **AWS Free plan:** the server runs on credits (about $15/month). At the end of the 6 months (around April 2027) or when credits run out, AWS stops the account unless it's upgraded. Move or upgrade before then.
- **YouTube** often blocks downloads from cloud servers. Twitch, Kick and uploads work. A cookies file (`YTDLP_COOKIES_FILE`) helps.
- **One server:** everything (database included) is on one machine. Daily backups protect against bad deploys; an EBS snapshot policy (AWS → EC2 → Lifecycle Manager) protects against losing the machine.

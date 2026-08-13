# Deploying Polycule to EC2

Polycule is a **single Node process**. The Express server in `server/index.js`
serves the API under `/api` *and* the built client from `client/dist`, and the
client fetches `/api` relatively — so there is no separate static host, no CORS
setup, and no code changes needed for a root-domain deploy.

```
browser ──▶ nginx :443 (TLS, gzip) ──▶ node :8787 ──▶ server/data/polycule.db
                                        ├─ /api/…        Express routes
                                        └─ /*            client/dist/index.html
```

Everything below assumes Ubuntu on EC2 and the `ubuntu` user. Substitute your
real hostname for `polycule.example.com` throughout.

---

## Quick start

On a fresh Ubuntu instance, after [step 1](#1-dns-and-the-security-group) (DNS
and the security group) is done:

```bash
curl -fsSL https://raw.githubusercontent.com/thermdev/polycule/main/deploy/bootstrap.sh \
    | bash -s -- polycule.example.com you@example.com
```

That is steps 2–6 in one shot: packages, Node, clone, build, systemd, nginx,
and a certificate. Run it as `ubuntu` (not root, not `sudo` — it calls `sudo`
itself where needed), and re-run it freely; every step converges.

Omit the email to skip TLS. Override defaults with environment variables:

```bash
REPO_URL=... APP_DIR=/opt/polycule NODE_MAJOR=24 PORT=9000 \
    ./deploy/bootstrap.sh polycule.example.com
```

The script clones over HTTPS, which needs no key on the box. If the repo is
private, either make the clone yourself first (the script will use an existing
checkout at `APP_DIR` rather than cloning) or pass an SSH URL after adding a
deploy key:

```bash
REPO_URL=git@github.com:thermdev/polycule.git ./deploy/bootstrap.sh polycule.example.com
```

The rest of this document is the same work done by hand, and is worth reading
if the script fails partway.

---

## 1. DNS and the security group

Do this first — certbot cannot issue a certificate until the name resolves to
the box.

1. Allocate an **Elastic IP** and associate it with the instance, so the
   address survives a stop/start.
2. Add an **A record** for `polycule.example.com` pointing at that IP.
3. In the instance's **security group**, allow inbound `80` and `443` from
   `0.0.0.0/0`. Leave `8787` closed — nginx reaches Node over loopback.

Confirm before continuing:

```bash
dig +short polycule.example.com     # should print your Elastic IP
```

## 2. Install Node and build tools

```bash
sudo apt update
sudo apt install -y curl git build-essential python3

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v && which node    # note the path; the systemd unit expects /usr/bin/node
```

`better-sqlite3` is a native addon. It normally installs a prebuilt binary, but
if none matches your Node version it compiles from source — that is why
`build-essential` and `python3` are installed. If `which node` prints something
other than `/usr/bin/node`, update `ExecStart=` in `polycule.service` to match.

## 3. Put the code in /srv/polycule

If your clone is currently in the home directory, move it:

```bash
sudo mkdir -p /srv
sudo mv ~/polycule /srv/polycule
sudo chown -R ubuntu:ubuntu /srv/polycule
```

Then install and build:

```bash
cd /srv/polycule
npm ci
npm run build          # writes client/dist
```

`npm run build` is deliberately separate from starting the server. Do **not**
use the root `npm start` under systemd — it rebuilds the client on every
restart, which makes crash-restarts slow.

The SQLite file lives at `server/data/polycule.db` and is created on first
start. That directory is gitignored, so it is never touched by a redeploy.

## 4. Run it as a service

```bash
sudo cp /srv/polycule/deploy/polycule.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now polycule

systemctl status polycule
curl -s localhost:8787/api/polycules      # expect [] on a fresh database
```

`enable` is what makes it come back after a reboot. Logs:

```bash
journalctl -u polycule -f
```

## 5. nginx in front

```bash
sudo apt install -y nginx
sudo cp /srv/polycule/deploy/nginx-polycule.conf /etc/nginx/sites-available/polycule
sudo sed -i 's/polycule.example.com/YOUR.REAL.HOSTNAME/' \
    /etc/nginx/sites-available/polycule
sudo ln -s /etc/nginx/sites-available/polycule /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default    # drops the "Welcome to nginx" page

sudo nginx -t && sudo systemctl reload nginx
```

`http://polycule.example.com` should now load the app.

Two settings in that config are load-bearing:

- **`client_max_body_size 32m`** — vertex photos and background images are
  POSTed to `/api/assets` as base64 data URLs. The default nginx limit of 1MB
  would reject them with a 413. This value matches `MAX_BODY` in
  `server/index.js`; if you change one, change both.
- **`gzip on`** — the client bundle is ~775KB uncompressed, mostly three.js.
  Compression takes it to roughly a quarter of that.

## 6. TLS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d polycule.example.com
```

Certbot rewrites the site config in place to add `listen 443 ssl`, the
certificate paths, and an HTTP→HTTPS redirect. Renewal is installed as a
systemd timer automatically; verify with:

```bash
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

## 7. Redeploying later

```bash
/srv/polycule/deploy/redeploy.sh
```

That fetches `origin/main`, hard-resets to it, reinstalls, rebuilds, restarts,
and tails the log if the service fails to come up. Note the hard reset — any
uncommitted edits made directly on the box are discarded.

---

## Before you point real people at it

**The API has no authentication.** Every route in `server/index.js` is open:
anyone who knows the URL can list, read, edit and delete every polycule, and
upload assets. Given that the data is people's names, photos and relationships,
that matters more here than it would for most apps.

The cheapest fix is HTTP basic auth at the nginx layer — uncomment the
`auth_basic` lines in the site config and create the password file:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd yourname
sudo nginx -t && sudo systemctl reload nginx
```

That gates the entire app, API included, behind one shared password. Real
per-user accounts would need application-level work.

**Back up the database.** It is a single file plus its WAL sidecar, and it is
the only copy of everything. Use SQLite's own backup command rather than `cp`,
which can capture a torn WAL:

```bash
sudo apt install -y sqlite3
sqlite3 /srv/polycule/server/data/polycule.db \
    ".backup '/home/ubuntu/polycule-$(date +%F).db'"
```

Worth putting in a cron job with an off-box copy (S3) if the data matters.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `502 Bad Gateway` | Node is down. `journalctl -u polycule -n 50`. |
| `413 Request Entity Too Large` on image upload | `client_max_body_size` missing or too small. |
| Blank page, 404s on `/assets/*.js` | `client/dist` missing — run `npm run build`. |
| `SQLITE_READONLY` / `unable to open database` | The data dir is not in `ReadWritePaths`, or is owned by root. `sudo chown -R ubuntu:ubuntu /srv/polycule/server/data`. |
| `Error: Could not locate the bindings file` | `better-sqlite3` did not compile. Install `build-essential python3`, then `npm rebuild better-sqlite3`. |
| `status=203/EXEC` in the journal | `ExecStart` path is wrong. Compare `which node` against the unit file. |
| Worked before a Node upgrade, now won't load | `node_modules` was built against the old Node. `rm -rf node_modules && npm ci`. |
| `curl -s` prints nothing at all | Not an empty response — nothing is listening. Use `curl -sS -i`; exit 7 is connection refused. |
| Certbot: "DNS problem" / "Invalid response" | A record not propagated, or port 80 blocked in the security group. |

#!/usr/bin/env bash
#
# One-shot setup for Polycule on a fresh Ubuntu EC2 instance.
#
#   curl -fsSL https://raw.githubusercontent.com/thermdev/polycule/main/deploy/bootstrap.sh \
#       | bash -s -- polycule.example.com you@example.com
#
# or, if the repo is already cloned:
#
#   /srv/polycule/deploy/bootstrap.sh polycule.example.com you@example.com
#
# Arguments:
#   $1  hostname for the site (required)
#   $2  email for Let's Encrypt (optional; TLS is skipped without it)
#
# Environment overrides:
#   REPO_URL    default https://github.com/thermdev/polycule.git
#   APP_DIR     default /srv/polycule
#   NODE_MAJOR  default 22
#   PORT        default 8787
#
# Safe to re-run: every step either skips or converges.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/thermdev/polycule.git}"
APP_DIR="${APP_DIR:-/srv/polycule}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PORT="${PORT:-8787}"

SITE_HOST="${1:-}"
LE_EMAIL="${2:-}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ #
# Preflight
# ------------------------------------------------------------------ #

[ -n "$SITE_HOST" ] || die "usage: $0 <hostname> [letsencrypt-email]"

# Run as the unprivileged login user, not root: everything under $APP_DIR
# must end up owned by the service account, and npm running as root creates
# root-owned node_modules that later break redeploys.
[ "$(id -u)" -ne 0 ] || die "run this as your normal user (e.g. ubuntu), not root or sudo"
sudo -n true 2>/dev/null || sudo true || die "this user needs sudo"

RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"

say "Installing Polycule"
echo "    host    $SITE_HOST"
echo "    dir     $APP_DIR"
echo "    user    $RUN_USER:$RUN_GROUP"
echo "    node    ${NODE_MAJOR}.x"
echo "    tls     $([ -n "$LE_EMAIL" ] && echo "certbot ($LE_EMAIL)" || echo "skipped")"

# ------------------------------------------------------------------ #
# 1. System packages
# ------------------------------------------------------------------ #

say "Installing system packages"
sudo apt-get update -qq
# build-essential and python3 let better-sqlite3 compile from source if no
# prebuilt binary matches this Node version.
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl git build-essential python3 nginx sqlite3

# ------------------------------------------------------------------ #
# 2. Node
# ------------------------------------------------------------------ #

if command -v node >/dev/null 2>&1 && \
   [ "$(node -p 'process.versions.node.split(".")[0]')" = "$NODE_MAJOR" ]; then
    say "Node $(node -v) already installed"
else
    say "Installing Node ${NODE_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi

NODE_BIN="$(command -v node)"
[ -x "$NODE_BIN" ] || die "node not found after install"
echo "    node    $NODE_BIN ($(node -v))"

# ------------------------------------------------------------------ #
# 3. Code
# ------------------------------------------------------------------ #

if [ -d "$APP_DIR/.git" ]; then
    say "Updating existing checkout at $APP_DIR"
    sudo chown -R "$RUN_USER:$RUN_GROUP" "$APP_DIR"
    git -C "$APP_DIR" fetch --prune origin
    git -C "$APP_DIR" reset --hard origin/main
else
    say "Cloning $REPO_URL into $APP_DIR"
    sudo mkdir -p "$(dirname "$APP_DIR")"
    sudo git clone "$REPO_URL" "$APP_DIR"
    sudo chown -R "$RUN_USER:$RUN_GROUP" "$APP_DIR"
fi

# ------------------------------------------------------------------ #
# 4. Dependencies and client build
# ------------------------------------------------------------------ #

say "Installing dependencies"
cd "$APP_DIR"
npm ci

# Prove the native addon actually loads before systemd depends on it. This is
# the failure that produces a confusing 502 later.
say "Verifying better-sqlite3 loads"
node -e 'import("better-sqlite3").then(()=>console.log("    ok"))' || {
    say "Rebuilding better-sqlite3 from source"
    npm rebuild better-sqlite3
    node -e 'import("better-sqlite3").then(()=>console.log("    ok"))' \
        || die "better-sqlite3 will not load; see the error above"
}

# The server only mounts its static handler if client/dist exists, so this
# must happen before the service starts or every non-API route 404s.
say "Building client"
npm run build
[ -f "$APP_DIR/client/dist/index.html" ] || die "build produced no client/dist/index.html"

# db.js creates server/data on first start, so server/ itself must be writable.
mkdir -p "$APP_DIR/server/data"

# ------------------------------------------------------------------ #
# 5. systemd service
# ------------------------------------------------------------------ #

say "Installing systemd service"

# Generate the unit from the repo template, substituting the paths and user
# actually in play on this box rather than trusting the defaults.
UNIT_TMP="$(mktemp)"
sed -e "s|^User=.*|User=${RUN_USER}|" \
    -e "s|^Group=.*|Group=${RUN_GROUP}|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}/server|" \
    -e "s|^ExecStart=.*|ExecStart=${NODE_BIN} index.js|" \
    -e "s|^Environment=PORT=.*|Environment=PORT=${PORT}|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=${APP_DIR}/server/data|" \
    "$APP_DIR/deploy/polycule.service" > "$UNIT_TMP"

# ProtectHome=read-only would block SQLite writes if the app lives under /home.
case "$APP_DIR" in
    /home/*) sed -i '/^ProtectHome=/d' "$UNIT_TMP" ;;
esac

sudo install -m 0644 "$UNIT_TMP" /etc/systemd/system/polycule.service
rm -f "$UNIT_TMP"

sudo systemctl daemon-reload
sudo systemctl enable polycule >/dev/null
sudo systemctl restart polycule

# ------------------------------------------------------------------ #
# 6. Health check
# ------------------------------------------------------------------ #

say "Waiting for the server to answer on :$PORT"
for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/polycules" >/dev/null 2>&1; then
        echo "    responding after ${i}s"
        break
    fi
    if ! systemctl is-active --quiet polycule; then
        echo
        journalctl -u polycule -n 40 --no-pager >&2
        die "the service exited; see the log above"
    fi
    sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/api/polycules" >/dev/null 2>&1 || {
    journalctl -u polycule -n 40 --no-pager >&2
    die "no response on :$PORT after 30s; see the log above"
}

# ------------------------------------------------------------------ #
# 7. nginx
# ------------------------------------------------------------------ #

say "Configuring nginx for $SITE_HOST"

NGINX_TMP="$(mktemp)"
sed -e "s|polycule\.example\.com|${SITE_HOST}|g" \
    -e "s|proxy_pass http://127\.0\.0\.1:8787;|proxy_pass http://127.0.0.1:${PORT};|" \
    "$APP_DIR/deploy/nginx-polycule.conf" > "$NGINX_TMP"

sudo install -m 0644 "$NGINX_TMP" /etc/nginx/sites-available/polycule
rm -f "$NGINX_TMP"

sudo ln -sfn /etc/nginx/sites-available/polycule /etc/nginx/sites-enabled/polycule
# Otherwise the default vhost wins on port 80 and serves "Welcome to nginx".
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl enable nginx >/dev/null
sudo systemctl reload nginx

# ------------------------------------------------------------------ #
# 8. TLS
# ------------------------------------------------------------------ #

if [ -n "$LE_EMAIL" ]; then
    say "Requesting a certificate for $SITE_HOST"
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        certbot python3-certbot-nginx

    # Needs the A record live and port 80 reachable from the internet.
    if sudo certbot --nginx -n --agree-tos --redirect \
        -m "$LE_EMAIL" -d "$SITE_HOST"; then
        echo "    certificate installed"
    else
        say "certbot failed - the app is still live over plain HTTP"
        echo "    Check that $SITE_HOST resolves to this instance and that"
        echo "    port 80 is open in the security group, then re-run:"
        echo "      sudo certbot --nginx -d $SITE_HOST"
    fi
else
    say "Skipping TLS (no email given)"
    echo "    To add HTTPS later:"
    echo "      sudo apt install -y certbot python3-certbot-nginx"
    echo "      sudo certbot --nginx -d $SITE_HOST"
fi

# ------------------------------------------------------------------ #
# Done
# ------------------------------------------------------------------ #

say "Done"
systemctl --no-pager --lines=0 status polycule || true

cat <<EOF

Polycule is live:  http$([ -n "$LE_EMAIL" ] && echo s)://${SITE_HOST}/

  logs        journalctl -u polycule -f
  restart     sudo systemctl restart polycule
  redeploy    ${APP_DIR}/deploy/redeploy.sh
  database    ${APP_DIR}/server/data/polycule.db

The API has no authentication - anyone with the URL can read, edit and
delete every polycule. To gate it behind a shared password:

  sudo apt install -y apache2-utils
  sudo htpasswd -c /etc/nginx/.htpasswd yourname
  sudo sed -i 's|# auth_basic|auth_basic|g' /etc/nginx/sites-available/polycule
  sudo nginx -t && sudo systemctl reload nginx

EOF

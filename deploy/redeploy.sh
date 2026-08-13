#!/usr/bin/env bash
#
# Pull the latest code, rebuild the client, restart the service.
# Run on the EC2 box:  sudo -u ubuntu /srv/polycule/deploy/redeploy.sh
#
set -euo pipefail

APP_DIR=/srv/polycule

cd "$APP_DIR"

echo "==> Fetching latest main"
git fetch --prune origin
git reset --hard origin/main

echo "==> Installing dependencies"
# `npm ci` respects package-lock.json exactly and rebuilds better-sqlite3
# against the installed Node if no prebuilt binary matches.
npm ci

echo "==> Building client"
npm run build

echo "==> Restarting service"
sudo systemctl restart polycule
sleep 1
systemctl is-active --quiet polycule && echo "==> polycule is running" || {
    echo "!! polycule failed to start; last 30 log lines:" >&2
    journalctl -u polycule -n 30 --no-pager >&2
    exit 1
}

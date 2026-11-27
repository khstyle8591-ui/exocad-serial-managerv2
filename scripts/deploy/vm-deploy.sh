#!/usr/bin/env bash
# Runs ON THE VM, called by .github/workflows/deploy-vm.yml after it uploads a release tarball.
# Building happens in GitHub Actions: building on the e2-micro (958MB RAM, pd-standard disk)
# pushed it into swap and stalled the server for ~10 minutes on 2026-11-26.
#
# Usage: vm-deploy.sh <commit-sha> <path-to-release.tgz>
#   - checks out <commit-sha> in the app repo (keeps package.json / ecosystem.config.js in sync)
#   - runs `npm ci` only when package-lock.json changed (native better-sqlite3 must match this VM)
#   - swaps dist/ for the prebuilt one (previous kept as dist.prev), restarts PM2
#   - rolls back to the previous dist + commit if the server does not come back healthy
set -euo pipefail

SHA="${1:?commit sha required}"
TGZ="${2:?release tarball path required}"
APP_DIR="${APP_DIR:-$HOME/exocad-serial/app}"
PM2_NAME="${PM2_NAME:-exocad-serial}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-240}"

log() { echo "[vm-deploy] $(date -u +%FT%TZ) $*"; }

exec 9>"$HOME/.vm-deploy.lock"
flock -n 9 || { log "another deploy is running — abort"; exit 1; }

cd "$APP_DIR"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "working tree has local changes — refusing to deploy:"
  git status --short --untracked-files=no
  exit 1
fi

PREV_SHA="$(git rev-parse HEAD)"
PREV_LOCK="$(git rev-parse HEAD:package-lock.json)"
log "current: $(git log -1 --format='%h %s')"

git fetch -q origin
git cat-file -e "${SHA}^{commit}" || { log "commit $SHA not found after fetch"; exit 1; }
git checkout -q -B main "$SHA"
NEW_LOCK="$(git rev-parse HEAD:package-lock.json)"
log "target:  $(git log -1 --format='%h %s')"

if [ "$PREV_LOCK" != "$NEW_LOCK" ]; then
  log "package-lock.json changed — running npm ci (this is slow on this VM)"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
fi

rm -rf dist.new
mkdir dist.new
tar -xzf "$TGZ" -C dist.new --strip-components=1
[ -f dist.new/main/main/server.js ] || { log "tarball has no dist/main/main/server.js — abort"; rm -rf dist.new; git checkout -q -B main "$PREV_SHA"; exit 1; }

rm -rf dist.prev
[ -d dist ] && mv dist dist.prev
mv dist.new dist

pm2_status() {
  pm2 jlist | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const p=JSON.parse(s).find(x=>x.name==='$PM2_NAME');console.log(p?p.pm2_env.status:'missing')})"
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
  while [ $SECONDS -lt $deadline ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)" = "200" ] \
       && [ "$(pm2_status)" = "online" ]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

log "restarting $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env >/dev/null

if wait_healthy; then
  log "healthy: $(git log -1 --format='%h %s')"
  rm -f "$TGZ"
  exit 0
fi

log "NOT healthy within ${HEALTH_TIMEOUT_SEC}s — rolling back to ${PREV_SHA:0:7}"
rm -rf dist.failed
mv dist dist.failed
[ -d dist.prev ] && mv dist.prev dist
git checkout -q -B main "$PREV_SHA"
if [ "$PREV_LOCK" != "$NEW_LOCK" ]; then
  log "package-lock.json changed in this deploy — restoring previous dependencies"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund || log "npm ci for rollback FAILED — manual check needed"
fi
pm2 restart "$PM2_NAME" --update-env >/dev/null
if wait_healthy; then
  log "rollback healthy: $(git log -1 --format='%h %s') (failed build kept in dist.failed)"
else
  log "ROLLBACK ALSO UNHEALTHY — manual intervention required"
fi
exit 1

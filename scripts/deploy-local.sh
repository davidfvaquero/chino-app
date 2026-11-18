#!/usr/bin/env bash
# Deploy chino-app to this homelab, repeatably and without stopping the service.
#
#   bash scripts/deploy-local.sh
#
# Builds into /home/homelab/chino-app-live/releases/<timestamp>, checks the
# build is complete, then atomically flips the .../current symlink (ln -sfn into
# a temp link + mv -T). The running server resolves .../current on every
# request, so a deploy never has to restart it. Keeps the 3 newest releases,
# deletes older ones, and prints the active release.
set -euo pipefail

APP_DIR=/home/homelab/chino-app
LIVE_DIR=/home/homelab/chino-app-live
RELEASES="$LIVE_DIR/releases"
KEEP=3

mkdir -p "$RELEASES"

# Timestamp release dir; add a suffix if two deploys land in the same second.
TS="$(date +%Y%m%d-%H%M%S)"
REL="$RELEASES/$TS"
n=0
while [ -e "$REL" ]; do n=$((n + 1)); REL="$RELEASES/$TS-$n"; done

echo "deploy: building -> $REL"
cd "$APP_DIR"
OUT_DIR="$REL" node scripts/build.mjs

# Build must exist and carry the shell entry points.
for f in index.html manifest.webmanifest sw.js; do
  [ -f "$REL/$f" ] || { echo "deploy: ERROR: missing $f in $REL" >&2; exit 1; }
done

# Atomic switch: create the new link beside the old one, then rename over it.
TMP="$LIVE_DIR/.current.$$"
ln -sfn "$REL" "$TMP"
mv -Tf "$TMP" "$LIVE_DIR/current"

# Prune: keep the KEEP newest releases, drop the rest.
cd "$RELEASES"
for old in $(ls -1dt -- */ 2>/dev/null | tail -n +$((KEEP + 1))); do
  rm -rf -- "$old"
done

echo "deploy: active release -> $(readlink -f "$LIVE_DIR/current")"

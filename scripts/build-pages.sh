#!/bin/sh
# Build the site for GitHub Pages into ./dist-pages.
#
# GitHub Pages serves a project site from a subdirectory
# (https://<user>.github.io/<repo>/), so the output must stay relative to
# itself. `sh scripts/build-pages.sh` + `node scripts/serve.mjs dist-pages`
# is the local check for that.
#
# Usage:  sh scripts/build-pages.sh        (the CI workflow calls exactly this)
set -eu
cd "$(dirname "$0")/.."

OUT_DIR=dist-pages node scripts/build.mjs

# Attribution: build.mjs copies index.html + src/ + public/ only, so the
# credits/licence file is added here to be reachable at <site>/CREDITS.md.
cp CREDITS.md dist-pages/CREDITS.md

echo "pages: dist-pages ready ($(find dist-pages -type f | wc -l) files)"

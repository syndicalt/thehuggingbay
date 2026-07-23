#!/bin/bash
# Rebuild both static mirrors from the live index and redeploy them.
# Runs daily from bay-mirror.timer on the fleet box.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

BAY_ORIGIN=https://thehuggingbay.io OUT_DIR=docs-root BASE_PATH= node build-static.mjs
BAY_ORIGIN=https://thehuggingbay.io node build-static.mjs

# workers.dev mirror
npx wrangler deploy --config wrangler.static.jsonc

# GitHub Pages mirror (only push when content actually changed)
if ! git diff --quiet -- docs; then
  git add docs
  git commit -m "Mirror refresh $(date -u +%F)"
  git push
  echo "pages mirror updated"
else
  echo "pages mirror unchanged"
fi

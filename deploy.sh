#!/bin/bash
set -e

# Clean up any stale git locks
rm -f .git/index.lock .git/HEAD.lock .git/MERGE_HEAD.lock .git/config.lock .git/packed-refs.lock

CURRENT=$(git branch --show-current)

echo "→ Pushing $CURRENT..."
git push

echo "→ Merging into main..."
git checkout main
git merge "$CURRENT" --no-edit
git push

echo "→ Back to $CURRENT..."
git checkout "$CURRENT"

# ── Apps Script (clasp) ───────────────────────────────────────────────────────
# Pushes apps-script/ to the bound Google Apps Script project so .gs changes go
# live alongside the Vercel deploy. One-time setup (see README "Deploying"):
#   npm i -g @google/clasp && clasp login           # token saved to ~/.clasprc.json
#   then create apps-script/.clasp.json with your scriptId.
# `clasp login` is global, so this works from ANY terminal/window on this Mac.
if command -v clasp >/dev/null 2>&1 && [ -f apps-script/.clasp.json ]; then
  echo "→ Pushing Apps Script (clasp)..."
  ( cd apps-script && clasp push -f )
  echo "✓ Apps Script pushed. Re-run any changed triggers/installers if needed."
else
  echo "⚠ clasp not configured — skipped Apps Script push (see README 'Deploying')."
fi

echo "✓ Deployed. Vercel will be live in ~30 seconds."

#!/bin/bash
set -e

# Clean up any stale git locks
rm -f .git/index.lock .git/HEAD.lock .git/MERGE_HEAD.lock

CURRENT=$(git branch --show-current)

echo "→ Pushing $CURRENT..."
git push

echo "→ Merging into main..."
git checkout main
git merge "$CURRENT" --no-edit
git push

echo "→ Back to $CURRENT..."
git checkout "$CURRENT"

echo "✓ Deployed. Vercel will be live in ~30 seconds."

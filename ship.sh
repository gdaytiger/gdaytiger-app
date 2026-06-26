#!/usr/bin/env bash
# ship.sh — deploy gdaytiger-app from the Cowork sandbox (or any machine with .env.ship).
#
# Commits ONLY the files you name, from a fresh clone of main, so it:
#   • never touches your local uncommitted work, and
#   • never hits the mounted-repo .git lock (the sandbox can't write that index).
#
# Usage:
#   ./ship.sh "message" path/to/file [more files...]         # -> PREVIEW branch (safe default)
#   ./ship.sh --live "message" path/to/file [more files...]  # -> main (goes LIVE on Vercel)
#
# Reads GH_TOKEN from .env.ship sitting next to this script.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SRC/.env.ship" ] || { echo "✗ Missing $SRC/.env.ship (needs GH_TOKEN=...)"; exit 1; }
# shellcheck disable=SC1090
source "$SRC/.env.ship"
[ -n "${GH_TOKEN:-}" ] || { echo "✗ GH_TOKEN not set in .env.ship"; exit 1; }

LIVE=0
if [ "${1:-}" = "--live" ]; then LIVE=1; shift; fi

MSG="${1:-}"; shift || true
[ -n "$MSG" ] || { echo "Usage: ./ship.sh [--live] \"message\" file [file...]"; exit 1; }
[ "$#" -ge 1 ] || { echo "✗ Name at least one file to ship."; exit 1; }

REPO="gdaytiger/gdaytiger-app"
R="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
CLONE="$(mktemp -d /tmp/gdt-ship.XXXXXX)"
trap 'rm -rf "$CLONE"' EXIT

echo "→ Cloning ${REPO} (main)…"
git clone --depth 1 -q "$R" "$CLONE"

echo "→ Staging files:"
for f in "$@"; do
  [ -f "$SRC/$f" ] || { echo "  ✗ not found in repo: $f"; exit 1; }
  mkdir -p "$CLONE/$(dirname "$f")"
  cp "$SRC/$f" "$CLONE/$f"
  echo "    $f"
done

cd "$CLONE"
git add -- "$@"
if git diff --cached --quiet; then
  echo "✗ Named files are identical to main — nothing to ship."
  exit 0
fi
git -c user.name="Claude (Cowork)" -c user.email="gday@gdaytiger.com.au" commit -q -m "$MSG"

if [ "$LIVE" = "1" ]; then
  echo "→ Pushing to main (LIVE)…"
  git push -q "$R" HEAD:main
  echo "✓ Live. Vercel builds in ~30s → https://gdaytiger-app.vercel.app"
else
  B="ship/$(date +%Y%m%d-%H%M%S)"
  echo "→ Pushing preview branch ${B}…"
  git push -q "$R" "HEAD:refs/heads/${B}"
  echo "✓ Pushed ${B} — Vercel is building a PREVIEW (not live)."
  echo "  Preview link: Vercel dashboard → gdaytiger-app → Deployments (top entry)."
  echo "  Happy with it? Promote in Vercel, or re-run with --live to push straight to main."
fi

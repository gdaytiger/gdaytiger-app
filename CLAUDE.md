@AGENTS.md

# TigerOS — working rules

Live operational dashboard for G'Day Tiger café. `main` deploys straight to production on Vercel — there is no staging. Australian English; be concise; lead with what changed.

## Before every deploy
1. `npm run check:design` — the prebuild guardrail. Raw brand hex (e.g. `#6b7280`) or inline glass shadows fail the Vercel build. Use `var(--color-*)` tokens and `glassTileStyle` from `app/lib/theme.ts`.
2. `npx tsc --noEmit` — must pass.
3. `git status --porcelain` — if a changed file imports a NEW untracked (`??`) file, commit that file too. Missing it breaks the Vercel build with "Module not found".

## Deploying
- Commit only the files you changed: `git add <files>` — never `git add .` or `-A`.
- Never commit `.env*` (`.env.ship` holds a GitHub token).
- **UI / visual changes:** commit on `main`, then `./deploy.sh` (pushes main, then `clasp push` for `apps-script/` and for `apps-script-gbp/`, which also republishes the GBP web app). Live in ~30s.
- **Costing, margin, pricing, data-sync or `apps-script/` logic changes:** push a preview branch first and stop for Jonathan to check it — `git checkout -b preview/<name> && git push -u origin preview/<name>`. Do NOT run `./deploy.sh` from a branch (it merges into main).
- If `clasp push` fails with `invalid_grant` / `invalid_rapt`, the Google login expired — tell Jonathan to run `npx clasp login`. The Vercel deploy has already gone out; don't retry in a loop.

## Repo notes
- This folder (`~/gdaytiger-app`) is the only live repo. `~/Documents/Claude/Projects/TIGER OS/gdaytiger-app` is a stale snapshot — never copy from it.
- All dashboards and widgets live in this Next.js app (mostly `app/page.tsx`), not as separate artifacts.
- Costing widgets: product tiles, summary tile, and search/Simulate row share `COSTING_TILE_H` — keep them in sync. Use Lucide icons, not emoji.

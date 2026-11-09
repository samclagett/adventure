# Instructions for Claude

Read these before doing anything in this repo.

## What this is

A personal, phone-first adventure planner for two people (Sam in Sydney, a friend in Victoria).
**The full brief is in [docs/BRIEF.md](docs/BRIEF.md). Read it before starting any feature.**
The current stage's plan is in [docs/PLAN.md](docs/PLAN.md).

Both people build with Claude Code only and don't hand-code. Keep everything simple, conventional
and easy for a future Claude to understand. Prefer well-known libraries over clever code.

## Before you edit: check and claim a zone

1. `git pull` on `main`.
2. Open [ZONES.md](ZONES.md) and find the zone that covers the files you need.
3. If it's claimed by someone else, **stop** and tell the user. Don't edit it.
4. If it's free, claim it (name, task, date), commit with a message like `Claim zone: map`, and push to `main` before starting.
5. Do the work on a branch and open a pull request. Release the zone in ZONES.md as part of that PR.

Touching a second zone? Claim that too. Keep `shared` edits small, because they affect everyone.

## Stack

- Front end: Vite + TypeScript, no framework. Map: MapLibre GL.
- Hosting: GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to `main`.
  The site lives under `/adventure/`, so use relative paths or `import.meta.env.BASE_URL`.
- Data and login: Supabase (`src/zones/shared/supabase.ts`). Schema in `supabase/schema.sql`.
  One shared login for both users; tables are readable and writable by any signed-in user.
- Behind the scenes: Python scripts in `scripts/`, run by GitHub Actions on demand.
- Free tiers only. Don't add paid services or anything needing a credit card.

## Rules

- Phones first: test at phone width, and keep the light quality mode fast.
- Never commit secrets. The Supabase URL and anon key are public by design and come from
  repo variables at build time (see SETUP.md). Anything else secret goes in GitHub Actions secrets.
- Run `npm run build` before pushing; it type-checks too.
- If the brief changes, update docs/BRIEF.md in the same PR.

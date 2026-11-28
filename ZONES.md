# Zones: who is working where

Two people build this app, each with their own Claude Code. To avoid stepping on each other,
the code is split into zones, and you claim a zone here before editing it.

## How to claim

1. Pull the latest `main`.
2. Find the zone below. If it's free, put your name and a few words on what you're doing, plus today's date.
3. Commit and push that change to `main` on its own **before** starting work, so the other person sees it.
4. When your pull request merges, set the zone back to `free`.

If a zone is claimed by the other person, don't edit it. Ask them, or work in another zone.
A claim older than 7 days with no activity can be taken over after a message to the other person.

## Zones

| Zone | Folder(s) | Claimed by | Doing | Since |
|---|---|---|---|---|
| map | `src/zones/map/` | free | | |
| hitlist | `src/zones/hitlist/` | free | | |
| conditions | `src/zones/conditions/`, `scripts/conditions/` | Claude (Sam) x2 | AM/PM colours, chart slider, 3D half screen; also surf size estimates (new surfsize.ts, surfreport.ts, small adds to summary.ts, openmeteo.ts, card.ts, fetch.py) | 2026-11-28 |
| campsites | `src/zones/campsites/`, `scripts/campsites/` | free | | |
| spot | `src/zones/spot/` | Claude (Sam) | AM/PM colours, chart slider, 3D half screen | 2026-11-28 |
| shared | `src/zones/shared/`, `src/main.ts`, `src/style.css` | free | | |
| infra | `.github/`, `supabase/`, `package.json`, config files | Claude (Sam) | surf_reports table in schema.sql | 2026-11-28 |
| docs | `docs/`, `README.md`, `CLAUDE.md`, `SETUP.md` | free | | |

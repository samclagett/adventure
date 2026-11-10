# Adventure App – Project Brief

> This is the source of truth for what we're building. Claude: read this before starting any feature.
> The live, editable copy is Sam's Claude Doc. If the two disagree, ask, then update this file to match.

## Concept

A visually rich, slightly game-like web app that combines conditions (weather, wind, swell, tides, rivers, water quality, hazards) with a 3D map and a personal hit list of adventures. Conditions come first: the app shows where things are good, and then you pick the adventure. Its main job is to surface unexpected opportunities, for example: "You planned a hike, but the surf down south is perfect and there's a free campsite nearby."

## Users

- Sam (Sydney, NSW) and one friend (Victoria). Personal use only, not public.
- Both build with AI only (Claude Code), with no hand-coding. The stack must stay simple and well known so AI can maintain it.
- Code lives in a shared GitHub repo.

## Platform and tech

- Phone-first web app (also iPad and PC). Front end in JavaScript/TypeScript, because Python can't run the visuals in a phone browser.
- Python is used behind the scenes for scraping and data processing, run by GitHub Actions when the button is pressed.
- Hosting: GitHub Pages (free).
- Data: Supabase, with one shared login for both users (sign in once per device). Sync doesn't need to be instant.
- Budget: free tiers only, for now.
- Map: MapLibre GL or CesiumJS for 3D terrain you can spin around. Avoid relying on Google 3D tiles (limits and possible cost).
- Routing and travel time: OpenRouteService (free), calculated from set home bases (Sydney and Victoria).
- Geocoding: OpenStreetMap Nominatim for simple name guesses.

## Map and visuals

- A blend of realistic terrain and a stylised, gamey look.
- V1: Australia shown ghosted, with NSW, Victoria and Tasmania active. Pick a state and zoom in.
- World mode later: big-ticket global adventures, without detailed conditions.
- Animations react to conditions (big surf means roaring waves; strong wind is visible on the map).
- Each location gets a callout bubble showing only the conditions that matter for it (no swell data on a mountain).
- Speed on phones comes before eye candy. Add a quality toggle: light mode on phone, full effects on PC.
- Graphics are developed alongside the engine from day one.

## Activities

Hiking and camping are central. Also surfing, climbing, skiing, snorkelling and diving (one category), and kayaking/canoeing.
Beaches and mountain biking were dropped as categories for now (2026-11-11).

Look: no emoji or loud colours. Categories use our own simple hand-sketched line icons with muted accent colours.

## Conditions data

- Fetched on demand ("Get conditions" button), not continuously. A wait of 1–2 minutes is fine.
- Forecast window picker: this weekend, next 5 days, next week, next 2 weeks.
- Sources (an ever-growing list): BOM as the anchor, plus WillyWeather, Swellnet, Surfline and Open-Meteo (free weather and marine API).
- Also needed: river heights (paddling and crossings), water temperature, water quality and dive visibility.
- Hazards: fire danger, park closures, track and road closures.

## Hit list and locations

- The list is added manually: paste in a list of any messiness.
- Items the app can't place go into a "to locate" queue.
- Locations are stored as latitude/longitude. Users drop pins in the app, or paste a Google Maps share link and the app pulls out the coordinates.
- Optional links to AllTrails and park sites for inspiration.
- Future: link to Sam's notes app as a live source.

## Campsites

- Focus: national park and free bush campsites. No private or caravan parks unless added manually.
- Key feature: an "Any free campsites?" button that finds booking gaps and cancellations without checking every site by hand.
- Approach: read the booking sites' background availability feeds where possible; only check campsites near top recommendations, and only on demand.

## Recommendations and learning

- Opens on a list of upcoming recommendations.
- The users define "good conditions" per spot and activity (e.g. swell direction, period, wind). The app can improvise a little.
- Post-trip reviews log the conditions together with a rating, so patterns can be found over time (lower priority).

## Offline

- Trip card: a saveable image per chosen adventure, with a conditions summary, a small map and key info. It can be viewed in the app or saved to the phone's photos.

## Collaboration

- The code is split into zone folders (map, conditions, campsites, etc.).
- A "zones" file in the repo records who is working where. A Claude Code project instructions file tells the AI to check and claim a zone before editing.

## Build stages

1. 3D map of NSW, Victoria and Tasmania with the pinned hit list, looking good from the start.
2. Conditions: data sources, callout bubbles and reactive animations.
3. Campsite availability hunting.
4. Then: recommendations, trip cards, travel times, reviews and world mode.

## Risks and open issues

- Campsite scraping: booking sites may block it and their terms may forbid it. Check the terms and keep requests light.
- BOM has no free official API, so scraping it is fragile. Prefer Open-Meteo where possible.
- Dive visibility data barely exists.
- Animated WebGL layers are the hardest code to get right and the hardest for AI to debug.
- With only two users, "learning" means pattern-spotting, not real machine learning.
- Scope creep: keep each stage small and usable.

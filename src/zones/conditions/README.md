# Zone: conditions

The "Get conditions" button, reading conditions results, callout bubbles and condition-driven animations.
Python fetchers for this zone live in `scripts/conditions/`.

## How it works (2026-11-16)

- `openmeteo.ts` fetches forecasts from Open-Meteo straight from the browser (free, no key), many places per request.
  Surf, diving and kayaking spots also get hourly wind and the marine forecast (swell, tides, sea temperature).
- `summary.ts` turns forecasts into the bubble text and day-by-day rows for each category, and the surf verdicts.
- `data.ts` keeps forecasts by area (0.25° grid), from the browser cache, then conditions.json written every
  3 hours by `scripts/conditions/fetch.py`, then live. `home.ts` is the home base saved on each phone. `drive.ts` gets drive times from home (free OSRM router, saved on the phone; falls back to straight-line km).
- `planner.ts` is the opening Plan screen, `layer.ts` the live weather layer in Explore mode, `card.ts` the pin card section.
- `daychart.ts` draws the hour-by-hour chart for one day at the top of a place card (tap a day in the strip to change it; it opens on the day picked on the map). Surf and dive spots: swell bars, tide line, swell direction and period, wind. Everything else: weather symbols, temperature line, rain bars and chance, wind. Camping runs midday to 10am; kayaking adds the tide; skiing marks 0°.
- `weather-icons.ts` holds the weather symbols (Phosphor Icons, light weight), including mixed ones (sun and rain, night) and `periodKind`, which picks one symbol for a stretch of hours.
- Each day is split into AM (6–11am) and PM (12–8pm), plus Night (9pm–5am) for camping, from the hourly forecast (`periodsOf` in summary.ts). Pin cards show the parts; map chips show their symbols.
- Swell is model open-ocean swell in metres. Never convert it to feet: only Surfline's face height is in feet.

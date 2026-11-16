# Zone: conditions

The "Get conditions" button, reading conditions results, callout bubbles and condition-driven animations.
Python fetchers for this zone live in `scripts/conditions/`.

## How it works (2026-11-16)

- `openmeteo.ts` fetches forecasts from Open-Meteo straight from the browser (free, no key), many places per request.
  Surf, diving and kayaking spots also get hourly wind and the marine forecast (swell, tides, sea temperature).
- `summary.ts` turns forecasts into the bubble text and day-by-day rows for each category, and the surf verdicts.
- `data.ts` keeps forecasts by area (0.25° grid), from the browser cache, then conditions.json written every
  3 hours by `scripts/conditions/fetch.py`, then live. `home.ts` is the home base saved on each phone.
- `planner.ts` is the opening Plan screen, `layer.ts` the live weather layer in Explore mode, `card.ts` the pin card section.
- `weather-icons.ts` holds the weather symbols (Phosphor Icons, light weight).
- Swell is model open-ocean swell in metres. Never convert it to feet: only Surfline's face height is in feet.

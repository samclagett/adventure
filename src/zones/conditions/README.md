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
- `surfsize.ts` estimates surf size at surf spots in body terms (waist to chest, head to overhead...), hour by hour: Komar and Gaughan breaking height for each part of the sea (main swell, second swell, wind waves, Open-Meteo marine), times how directly each reaches the beach (its direction against `faces`; long period wraps more), added as energy, times 1.2 because people call the sets, times a correction learned from reports (all spots, then per spot, pulled towards 1 while reports are few; `settings.surfFactor` sets a manual one). Also clean / bumpy / choppy from wind and wind chop. Each `Day.sea[h].surf` carries the estimate; `surfAt(marine, i, place)` gives one hour. Checked against Sam's first report (Bronte 28 Nov 2026, 7am: at least head high, very choppy; estimate 1.9 m face, head to overhead, choppy).
- `surfreport.ts` shows the surf line on surf cards (AM and PM for the chosen day) and the "What did you see?" report, saved in Supabase `surf_reports` with that hour's forecast so the learning can be redone if the maths changes.
- `daychart.ts` draws the hour-by-hour chart at the top of a place card: one day per card width, scrolling on through the week (the day strip follows it; tapping a day scrolls there). Each day is headed with its total rain. Surf and dive spots: swell bars, tide line, swell height, direction and period. Everything else: yellow-sun / blue-rain symbols every 3 hours, temperature line, rain bars and chance. All: wind as average and gust curves with arrows along the average. Kayaking adds the tide; skiing marks 0°.
- `weather-icons.ts` holds the weather symbols (Phosphor Icons, light weight), including mixed ones (sun and rain, night) and `periodKind`, which picks one symbol for a stretch of hours.
- Each day is split into AM (6–11am) and PM (12–8pm), plus Night (9pm–5am) for camping, from the hourly forecast (`periodsOf` in summary.ts). Pin cards show the parts; map chips show their symbols.
- Swell is model wave height in metres (Open-Meteo `wave_height`: all swells plus wind waves; `swell_wave_height` is only the biggest single swell and read too low). Never convert it to feet: only Surfline's face height is in feet.

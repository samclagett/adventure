# Current plan: Stage 1

Agreed 2026-11-09. Tick items off here as they land.

1. ✅ **Repo and plumbing**: Vite + TypeScript app, zone folders, ZONES.md, CLAUDE.md, GitHub Pages deploy, Supabase hit list table and shared login.
2. ✅ **3D map**: MapLibre GL (chosen over Cesium: lighter on phones, simpler for AI to maintain) with free keyless terrain tiles. Australia ghosted, NSW, Victoria and Tasmania active, tap a state to zoom, light/full quality toggle, mountain-height slider, first pass at the stylised look.
3. ✅ **Hit list on the map**, built from scratch by adventure category (Sam's call, 2026-11-10: no existing list to import).
   Category filter chips (hiking, camping, surfing, climbing, skiing, snorkelling & diving, kayaking/canoeing, other),
   each with an icon from Sam's hand-drawn set (beaches and mountain biking dropped, 2026-11-11). Add an adventure by picking a category, then searching a
   place (Nominatim, limited to NSW/ACT/VIC/TAS), tapping the map, or pasting a full Google Maps link. Items with no
   location go in the "To locate" list. Tap a pin for its card (notes, link, edit, delete). Saved to Supabase `hit_list`,
   category in the existing `activity` column. **Deferred:** bulk paste of a messy list.
4. ✅ **Conditions** (2026-11-16): a "Conditions" button fetches Open-Meteo forecasts straight from the browser (Sam's call:
   faster than a GitHub Action and no token on the phone; Actions stay for scraped sources later). Window picker (this weekend,
   next 5 days, next week, next 2 weeks). Each pin gets a callout bubble with what matters for its category, and each pin card a
   day-by-day breakdown. Surf spots also get model swell (metres, never converted to feet), wind relative to which way the beach
   faces (new `faces` column), the best window of the day, tides, water temperature and a first go/marginal/skip verdict.
   Lessons came from Sam's "Daily Surf Report" scheduled task; its 16 beaches are now on the hit list.

### After Stage 1: new conditions interface (2026-11-16)

Sam found the first version slow and asked for a different approach:
- **Plan screen** on opening: pick an activity (or Anything) and when, see every matching place ranked by conditions
  with a line on how they change across the window; tap one to fly there. "Explore the map" closes it; the Plan button reopens it.
- **Explore mode** is the map as before, with a **live weather layer** (on by default while testing): weather symbol,
  temperature, wind arrow and swell arrow beside each pin, for a day picked with the day stepper.
- Every activity now gets go / marginal / skip ratings from simple rules (summary.ts, `checksFor`).
- Speed: the marine forecast only goes out 8 days (asking for 14 failed and retried place by place, which was the slowness).
  Forecasts for the whole hit list now come in 3 requests and are cached on the phone for an hour.

Round 3 (2026-11-16, Sam's answers):
- Forecasts are one per area (0.25° grid, about 25 km), not per pin; each pin still gets its own summary from its area.
- `.github/workflows/conditions.yml` refreshes every area every 3 hours into conditions.json on the `conditions-data`
  branch (Supabase function `conditions_areas`), so the app opens with conditions loaded. "Update now" fetches live.
- Home base is saved on each phone (one shared login), defaults the Plan screen's start point, and can be changed for one search.
  The list shows straight-line distance and ranks nearer places first within each rating. Travel times come later.
- Weather icon set: Sam is choosing (Material, Lucide, Phosphor light or Tabler).

### Uplift Round 2: navigation (2026-11-16)

From the professional review (Round 1, look and feel, was PRs #20 to #23).
- **Bottom tab bar** (`src/zones/shared/tabs.ts`): Plan, Map, Hit list, Camps. Replaces the floating buttons. Adding a
  place is the Add button in the Hit list tab, or press and hold on the map.
- **Draggable sheets** (`src/zones/shared/sheet.ts`): a place card opens short (name, verdict pill for the next four days,
  distance from home, Directions, Share, Edit) and drags up for the full forecast. No raw coordinates. The Hit list and
  Camps panels drag the same way.
- **Plan results lead with the best pick**: a "Best this weekend" card, then a compact list with a verdict pill and day strip.
  Detail is one tap away on the place card.
- Next (Round 3): drive times, "tell me when it's a Go" alerts, done list, fire and park alerts.

### Uplift Round 3: features (2026-11-16)

- **Drive times** (`src/zones/conditions/drive.ts`): by road from home, from the free public OSRM router (one request
  for every place, saved on the phone). Shown on the Plan list, the best pick and the place card ("1 h 40 drive from
  Sydney"); Plan ranks nearer drives first within each rating. Straight-line km shows until a drive time is in, or
  where there's no road (New Zealand).

### Fixes 17 to 27 (2026-11-17)

- **Chunk 1** (plan filters and conditions): "Next week" dropped from the window picker. Plan screen drive radius slider
  (1 to 8 h from the start point, or Australia-wide; road time when known, else an estimate). Map weather chips label
  each symbol AM / PM / Night. "AM / PM" button on a place card opens a conditions table (`conditions/matrix.ts`):
  AM and PM columns per day for weather, temperature, rain, wind, wind at the beach, swell, period and tides.
  NSW hit list places group by area from Sydney (`hitlist/areas.ts`).
- **Chunk 2** (icons and categories): icons now fit inside the circle (no clipped surfboard tip). Climbing is a simple
  carabiner; skiing and kayaking redrawn with more detail; new Canyoning (its own conditions rule: rain means flood risk).
  Main list: hiking, camping, surfing, climbing, skiing, snorkelling & diving, canyoning, other. "Other" opens a sub-list
  (`group: 'other'` in categories.ts), starting with Kayaking & canoeing (id still `kayaking`, so saved places are untouched).

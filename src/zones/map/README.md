# Zone: map

The 3D map (MapLibre GL), terrain, state selection, pins, visual style and the quality toggle.

- `index.ts`: `mountMap(container)`, the only thing other zones should import. It returns the map plus helpers;
  `setTapToZoom(false)` stops taps on a state from zooming (the hit list uses it while dropping a pin).
- `map.ts`: creates the map, camera views for Australia/NSW/VIC, tap-a-state-to-zoom.
- `style.ts`: the look. Elevation-tinted land and ocean, hillshade, ghosted states.
- `quality.ts`: light (phones: no 3D terrain, pixel ratio 1) vs full (3D terrain + sky). Remembered per device.
- `controls.ts`: region buttons, the quality toggle and the mountain-height slider.
- `data/australia-states.json`: simplified state outlines from Natural Earth (public domain).
  `active: true` marks the states the app covers (NSW incl. ACT and Jervis Bay, VIC and TAS).
- Mountain height: `setRelief(1–4)` exaggerates 3D terrain (Full mode) and hillshade strength (both modes). Default 2.5×, remembered per device.

Terrain comes from the free, keyless AWS Terrain Tiles (Terrarium encoding). No API keys anywhere.
- `data/places.json`, `data/rivers.json`, `data/lakes.json`: 93 cities and towns, major rivers and lakes in NSW/ACT/VIC/TAS,
  from Natural Earth 10m (public domain). Towns appear by size as you zoom (`rank`: lower = bigger).
- `public/fonts/`: Noto Sans glyphs (SIL Open Font Licence) for labels, self-hosted so labels need no font server.
  Only Latin ranges are included; add more `.pbf` ranges if names with other scripts are ever needed.
- `public/data/national-parks.geojson`, `public/data/beach-sand.geojson`, `public/data/beaches.geojson`: 588 national parks/reserves,
  2,576 beach/dune sand outlines, and 1,269 named
  beaches in NSW/ACT/VIC/TAS, from Overture Maps (release 2026-10-21.0; OpenStreetMap data, ODbL). Loaded on demand.
  Built by reading Overture's `base/land_use` (class `national_park`) and `base/land` (classes `beach`, `dune`) for the region,
  then simplifying with mapshaper. Overture also has `campground/camp_site` and named `physical/peak` features
  if the campsites zone or peak labels need them later.

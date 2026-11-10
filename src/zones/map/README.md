# Zone: map

The 3D map (MapLibre GL), terrain, state selection, pins, visual style and the quality toggle.

- `index.ts`: `mountMap(container)`, the only thing other zones should import.
- `map.ts`: creates the map, camera views for Australia/NSW/VIC, tap-a-state-to-zoom.
- `style.ts`: the look. Elevation-tinted land and ocean, hillshade, ghosted states.
- `quality.ts`: light (phones: no 3D terrain, pixel ratio 1) vs full (3D terrain + sky). Remembered per device.
- `controls.ts`: region buttons, the quality toggle and the mountain-height slider.
- `data/australia-states.json`: simplified state outlines from Natural Earth (public domain).
  `active: true` marks the states the app covers (NSW incl. ACT and Jervis Bay, VIC and TAS).
- Mountain height: `setRelief(1–4)` exaggerates 3D terrain (Full mode) and hillshade strength (both modes). Default 2.5×, remembered per device.

Terrain comes from the free, keyless AWS Terrain Tiles (Terrarium encoding). No API keys anywhere.

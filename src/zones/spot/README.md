# Zone: spot

The 3D spot view. Open a place card and the top half of the screen shows a detailed 3D scene of the place
(three.js), with the card and its conditions in the bottom half (Sam, 2026-11-28; was a third). Pull the card down and the scene hides;
close it and the scene is thrown away. Only one scene exists at a time, so the heavy detail never touches the main map.

- `index.ts`: `mountSpot(parent, hl, data)`, called from `conditions/index.ts` (it shares the forecasts). Uses
  `hl.setCardTop` to open cards tall and `hl.onCardChange` to follow them. Weather/wind/swell/surf chips and the ‹ › hour
  stepper (3 hours a step, a week ahead). The hour follows the slider on the card's day chart and the ‹ › steps
  move that slider (`conditions/hourbus.ts`). three.js loads only when the first spot opens (dynamic import).
  Every located place gets it (Killalea was the prototype). Ground size: 2.4 km at the coast, 4.2 km inland, 6 km for ski areas.
- `scene.ts`: the scene. Ground mesh from heights with a satellite photo, plus a sharper 700 m photo patch in the
  middle. Sea is one flat plane with its own shader: no drawn swell waves (Sam swapped them for the number, 2026-11-28),
  just wind chop that gets messier with wind (worse onshore), whitecaps, a lap at the sand and calm water in lagoons.
  Swell arrows (paper with an ink edge) ride the water with the swell height and period written on them; wind
  chevrons drift downwind. Sky colour and sun from the real sun position for the hour; cloud sprites, fog and rain
  from the weather code and rain mm.
- `tiles.ts`: heights (Mapzen/AWS terrarium, from Geoscience Australia's 5 m model along the coast) and photos (Esri
  World Imagery) stitched from map tiles. At the coast the scene centres on the water's edge nearest the pin
  (`findShore`), because pins are often a little inland. If the photo can't load, the ground is coloured by height.
- `weather.ts`: one hour of conditions from a forecast (`hourAt`), and the sun's position.

**Google 3D later.** Sam chose free imagery for now, with Google Photorealistic 3D Tiles possible later (needs a
Google Maps Platform key with billing). That would replace the ground in `scene.ts` with the `3d-tiles-renderer`
package's `TilesRenderer` and its Google plugin; the sea, arrows and sky stay as they are.

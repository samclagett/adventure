import type { GeoJSONSourceSpecification, StyleSpecification } from 'maplibre-gl';
import states from './data/australia-states.json';
import places from './data/places.json';
import rivers from './data/rivers.json';
import lakes from './data/lakes.json';

/**
 * The map's look ("hybrid", chosen Nov 2026): soft atlas colours with satellite imagery blended in.
 * - Land height is tinted in soft greens to stone, like a printed topo map, from the same free
 *   elevation tiles that give 3D terrain. Ocean depth is tinted from them too.
 * - Sentinel-2 cloudless satellite imagery (EOX, free for non-commercial use with credit) is laid over
 *   it, partly see-through and a little desaturated, so it reads as real country but stays calm behind pins.
 * - Shading is lit from the north-west, like a printed map.
 * - States outside NSW and Victoria are "ghosted" with a dark wash.
 * - Major rivers, lakes, cities and towns come from Natural Earth (public domain), bundled with the app.
 * - National parks and named beaches come from Overture Maps (OpenStreetMap data, ODbL), in public/data.
 * - Label fonts (Noto Sans, open licence, with soft see-through halos) are served from public/fonts, so nothing depends on a font server.
 * No API keys are needed for anything here.
 */

type Data = GeoJSONSourceSpecification['data'];

// Fonts live in public/fonts/<font name>/<range>.pbf. MapLibre needs an absolute URL template.
const GLYPHS = `${location.origin}${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`;
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Medium'];
const FONT_ITALIC = ['Noto Sans Italic'];

// Bigger datasets live in public/data and load on demand, so they don't slow the first paint.
const DATA = `${location.origin}${import.meta.env.BASE_URL}data`;

// Mapzen/AWS terrain tiles: free, keyless, global, includes ocean depth.
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain: Mapzen, AWS Open Data</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

// Sentinel-2 cloudless 2020 by EOX: free, keyless, CC BY-NC-SA 4.0 (fine for a personal, non-commercial app).
const SATELLITE_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const SATELLITE_ATTRIBUTION =
  '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX</a> (Contains modified Copernicus Sentinel data 2020)';

export const COLORS = {
  ocean: '#0a2a3d',
  river: '#4b93bb',
  riverLabel: '#e6f4fa',
  label: '#fffaf0',
  park: '#3f6f45',
  parkLabel: '#dcecd2',
  beach: '#eadcb4',
  /** A soft, see-through glow behind labels so they read on any terrain, without a heavy outline. */
  halo: 'rgba(11, 26, 36, 0.55)',
  ghost: '#08141c',
  outline: '#ffffff',
  activeGlow: '#6fc3b2',
  /** Crisp look: the sea and the shoreline. */
  sea: '#0b4867',
  shore: '#eef6f2',
};

/**
 * Two looks, switchable in Settings while Sam compares them (2026-11-17):
 * - classic: the Round 1 hybrid, where the coast comes from the elevation tiles (soft, a little blocky).
 * - crisp: the sea drawn from a vector coastline (ocean.geojson) with a clean edge and a fine shoreline,
 *   and richer land: stronger, more saturated satellite and deeper greens.
 * Both are in one style; applyLook (map.ts) shows and hides layers and changes paint.
 */
export type Look = 'classic' | 'crisp';

/**
 * Height tint, atlas style: soft sage on the coast, greens through the ranges, stone and pale rock up high.
 * Stops sit in 0–2200 m because Australian ranges are low.
 */
const RELIEF_CLASSIC = [
  'interpolate', ['linear'], ['elevation'],
  -4000, '#0a2433',
  -200, '#12374c',
  -20, '#2a6378',
  -1, '#4f8d99',
  // Zoomed in, the elevation data often reads the sea as exactly 0 m: keep that water-coloured.
  0, '#3f7f8f',
  1, '#d5dbbd',
  50, '#c3d0a4',
  200, '#a9be8c',
  450, '#93aa7c',
  750, '#a6a682',
  1000, '#b6ab92',
  1300, '#c4bba9',
  1700, '#d9d4cb',
  2200, '#f2f0ec',
];

/** Crisp look: richer greens, and sea level is land-coloured, because the vector sea now draws the water. */
const RELIEF_CRISP = [
  'interpolate', ['linear'], ['elevation'],
  -4000, '#0a2433',
  -1, '#0b4867',
  0, '#c9d6a2',
  50, '#b3c98a',
  200, '#97b86f',
  450, '#7fa060',
  750, '#929a62',
  1000, '#a89a78',
  1300, '#bdb19a',
  1700, '#d9d4cb',
  2200, '#f4f2ee',
];

/** Layers only the crisp look shows. */
export const CRISP_LAYERS = ['ocean-fill', 'ocean-depth', 'coastline'];
/** Layers only the classic look shows. */
export const CLASSIC_LAYERS = ['ocean-calm'];

/** Paint that differs between the looks: [layer, property, classic value, crisp value]. */
export const LOOK_PAINT: [string, string, unknown, unknown][] = [
  ['relief', 'color-relief-color', RELIEF_CLASSIC, RELIEF_CRISP],
  ['satellite', 'raster-opacity', 0.55, 0.72],
  ['satellite', 'raster-saturation', -0.3, 0.12],
  ['satellite', 'raster-contrast', 0.05, 0.14],
  ['satellite', 'raster-brightness-min', 0, 0.02],
  ['beach-sand', 'fill-opacity', 0.7, 0.85],
  ['lakes', 'fill-color', '#3f7f99', '#1f6f8f'],
];

const demSource = {
  type: 'raster-dem' as const,
  tiles: [TERRAIN_TILES],
  tileSize: 256,
  maxzoom: 15,
  encoding: 'terrarium' as const,
  attribution: TERRAIN_ATTRIBUTION,
};

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      // Two copies of the same tiles: MapLibre recommends separate sources for 3D terrain and shading.
      terrain: { ...demSource },
      shade: { ...demSource },
      states: { type: 'geojson', data: states as Data, promoteId: 'code' },
      places: { type: 'geojson', data: places as Data },
      rivers: { type: 'geojson', data: rivers as Data },
      lakes: { type: 'geojson', data: lakes as Data },
      parks: { type: 'geojson', data: `${DATA}/national-parks.geojson`, attribution: '© OpenStreetMap contributors, Overture Maps' },
      // One point per park (made by scripts/map/park_labels.py) so each name shows once, in the middle.
      parkLabels: { type: 'geojson', data: `${DATA}/park-labels.geojson` },
      beaches: { type: 'geojson', data: `${DATA}/beaches.geojson` },
      sand: { type: 'geojson', data: `${DATA}/beach-sand.geojson` },
      // The sea as one vector shape (scripts/map/ocean.py), for a crisp coastline in the "crisp" look.
      ocean: { type: 'geojson', data: `${DATA}/ocean.geojson`, attribution: '© OpenStreetMap contributors, Overture Maps', tolerance: 0.25 },
      satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 15, attribution: SATELLITE_ATTRIBUTION },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } },
      {
        // Height tint, atlas style: soft sage on the coast, greens through the ranges, stone and pale rock up high.
        // Stops sit in 0–2200 m because Australian ranges are low.
        id: 'relief',
        type: 'color-relief',
        source: 'shade',
        paint: {
          'color-relief-color': RELIEF_CLASSIC as never,
          'color-relief-opacity': 1,
        },
      },
      {
        // Real colour from satellite, blended over the atlas tint.
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        paint: {
          'raster-opacity': 0.55,
          'raster-saturation': -0.3,
          'raster-contrast': 0.05,
          'raster-fade-duration': 200,
        },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'shade',
        paint: {
          'hillshade-exaggeration': 0.4,
          // Lit from the north-west like a printed topo map; this method keeps flat ground untouched.
          'hillshade-method': 'igor',
          'hillshade-illumination-direction': 315,
          'hillshade-highlight-color': '#fffbea',
          'hillshade-shadow-color': '#1d2a26',
          'hillshade-accent-color': '#2c3e2f',
        },
      },
      {
        // Calm the sea floor: a flat depth tint over the shading, so the ocean doesn't look noisy.
        id: 'ocean-calm',
        type: 'color-relief',
        source: 'shade',
        paint: {
          'color-relief-color': [
            'interpolate', ['linear'], ['elevation'],
            -4000, 'rgba(10, 36, 51, 0.85)',
            -200, 'rgba(18, 55, 76, 0.75)',
            -20, 'rgba(42, 99, 120, 0.4)',
            -0.5, 'rgba(79, 141, 153, 0.15)',
            0, 'rgba(63, 127, 143, 0.3)',
            1, 'rgba(0, 0, 0, 0)',
          ],
        },
      },
      // ---- The "crisp" look (2026-11-17, see LOOKS): hidden in the classic look. ----
      {
        // The sea itself: a clean edge where land meets water, and a deep, saturated blue.
        id: 'ocean-fill',
        type: 'fill',
        source: 'ocean',
        layout: { visibility: 'none' },
        paint: { 'fill-color': COLORS.sea, 'fill-opacity': 0.9, 'fill-antialias': true },
      },
      {
        // Deeper water a touch darker, from the same elevation tiles (only past 60 m deep, away from the shore,
        // where the tiles are too coarse and noisy to use).
        id: 'ocean-depth',
        type: 'color-relief',
        source: 'shade',
        layout: { visibility: 'none' },
        paint: {
          'color-relief-color': [
            'interpolate', ['linear'], ['elevation'],
            -4000, 'rgba(3, 22, 38, 0.65)',
            -1000, 'rgba(5, 30, 50, 0.5)',
            -200, 'rgba(8, 44, 70, 0.25)',
            -60, 'rgba(0, 0, 0, 0)',
          ],
        },
      },
      {
        // A fine, pale shoreline.
        id: 'coastline',
        type: 'line',
        source: 'ocean',
        layout: { visibility: 'none', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.shore,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.9, 14, 1.4],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 10, 0.6],
        },
      },
      {
        id: 'parks-fill',
        type: 'fill',
        source: 'parks',
        paint: { 'fill-color': COLORS.park, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.28, 10, 0.12] },
      },
      {
        id: 'parks-outline',
        type: 'line',
        source: 'parks',
        minzoom: 9, // dashed park edges only once zoomed in; at state level they read as noise
        paint: { 'line-color': '#cfe6c4', 'line-width': 1, 'line-opacity': 0.35, 'line-dasharray': [3, 2] },
      },
      {
        // Beach sand, outlined like on a satellite map.
        id: 'beach-sand',
        type: 'fill',
        source: 'sand',
        paint: { 'fill-color': COLORS.beach, 'fill-opacity': 0.7, 'fill-antialias': true },
      },
      {
        id: 'lakes',
        type: 'fill',
        source: 'lakes',
        paint: { 'fill-color': '#3f7f99', 'fill-opacity': 0.8, 'fill-outline-color': COLORS.river },
      },
      {
        // Rivers get wider as you zoom in; the biggest (lowest rank) are widest.
        id: 'rivers',
        type: 'line',
        source: 'rivers',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.river,
          'line-opacity': 1,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            4, ['interpolate', ['linear'], ['get', 'rank'], 1, 2.2, 10, 0.9],
            9, ['interpolate', ['linear'], ['get', 'rank'], 1, 5, 10, 2.2],
          ],
        },
      },
      {
        // Ghost every state that isn't active yet, and the active states you haven't picked (feature-state `dim`, map.ts).
        id: 'states-ghost',
        type: 'fill',
        source: 'states',
        paint: {
          'fill-color': COLORS.ghost,
          'fill-opacity': ['case', ['!', ['get', 'active']], 0.72, ['boolean', ['feature-state', 'dim'], false], 0.72, 0],
          'fill-opacity-transition': { duration: 600 },
        },
      },
      {
        // Invisible fill on active states so they can be tapped.
        id: 'states-active-hit',
        type: 'fill',
        source: 'states',
        filter: ['get', 'active'],
        paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
      },
      {
        id: 'states-active-glow',
        type: 'line',
        source: 'states',
        filter: ['get', 'active'],
        paint: {
          'line-color': COLORS.activeGlow,
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 6],
          'line-blur': 6,
          // State outlines are simplified, so fade them out once you're zoomed in close.
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            7, ['case', ['boolean', ['feature-state', 'dim'], false], 0, 0.7],
            9, 0,
          ],
        },
      },
      {
        id: 'states-outline',
        type: 'line',
        source: 'states',
        paint: {
          'line-color': COLORS.outline,
          'line-width': ['case', ['get', 'active'], 1.5, 0.6],
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            7, ['case', ['get', 'active'], 0.9, 0.25],
            9, 0,
          ],
        },
      },
      {
        id: 'river-labels',
        type: 'symbol',
        source: 'rivers',
        minzoom: 5,
        filter: ['!=', ['get', 'name'], ''],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 250,
          'text-field': ['get', 'name'],
          'text-font': FONT_ITALIC,
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 13, 10, 16],
          'text-letter-spacing': 0.04,
          'text-max-angle': 70,
        },
        paint: { 'text-color': COLORS.riverLabel, 'text-halo-color': 'rgba(8, 40, 60, 0.6)', 'text-halo-width': 1.1, 'text-halo-blur': 1 },
      },
      {
        id: 'park-labels',
        type: 'symbol',
        source: 'parkLabels',
        minzoom: 7,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 11, 14],
          'text-max-width': 8,
          // Bigger parks win when names would collide.
          'symbol-sort-key': ['-', 10, ['get', 'area']],
        },
        paint: { 'text-color': COLORS.parkLabel, 'text-halo-color': 'rgba(10, 40, 24, 0.6)', 'text-halo-width': 1.1, 'text-halo-blur': 1 },
      },
      {
        id: 'beach-labels',
        type: 'symbol',
        source: 'beaches',
        // Names only once you're zoomed right in on the coast.
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11.5,
          'text-variable-anchor': ['left', 'right'],
          'text-radial-offset': 0.7,
          // Bigger beaches win when labels would overlap.
          'symbol-sort-key': ['-', 0, ['get', 'area']],
        },
        paint: { 'text-color': COLORS.beach, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.1, 'text-halo-blur': 1 },
      },
      {
        id: 'place-dots',
        type: 'circle',
        source: 'places',
        // Bigger places (lower rank) appear first as you zoom in.
        filter: ['<=', ['get', 'rank'], ['step', ['zoom'], 4, 4.5, 6, 5.5, 7, 6.5, 10]],
        paint: {
          'circle-radius': ['case', ['get', 'capital'], 4.5, 3],
          'circle-color': COLORS.label,
          'circle-stroke-color': '#0b1a24',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'place-labels',
        type: 'symbol',
        source: 'places',
        filter: ['<=', ['get', 'rank'], ['step', ['zoom'], 4, 4.5, 6, 5.5, 7, 6.5, 10]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['case', ['get', 'capital'], ['literal', FONT_BOLD], ['literal', FONT]],
          'text-size': ['case', ['get', 'capital'], 15, ['<=', ['get', 'rank'], 6], 13, 11.5],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 0.6,
          'text-justify': 'auto',
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': COLORS.label, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.1, 'text-halo-blur': 1 },
      },
    ],
  };
}

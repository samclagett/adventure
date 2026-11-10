import type { GeoJSONSourceSpecification, StyleSpecification } from 'maplibre-gl';
import states from './data/australia-states.json';
import places from './data/places.json';
import rivers from './data/rivers.json';
import lakes from './data/lakes.json';

/**
 * The map's look: a stylised, slightly game-like blend of real terrain and flat colour.
 * - Ocean depth and land height are tinted from the same free elevation tiles that give 3D terrain.
 * - States outside NSW and Victoria are "ghosted" with a dark wash.
 * - Major rivers, lakes, cities and towns come from Natural Earth (public domain), bundled with the app.
 * - National parks and named beaches come from Overture Maps (OpenStreetMap data, ODbL), in public/data.
 * - Label fonts (Noto Sans, open licence) are served from public/fonts, so nothing depends on a font server.
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

export const COLORS = {
  ocean: '#0a2a3d',
  river: '#2b9be0',
  riverLabel: '#e6f8ff',
  label: '#fffaf0',
  park: '#2f8f4e',
  parkLabel: '#c9f7c9',
  beach: '#ffe08a',
  halo: '#0b1a24',
  ghost: '#08141c',
  outline: '#ffffff',
  activeGlow: '#4fd1c5',
};

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
      beaches: { type: 'geojson', data: `${DATA}/beaches.geojson` },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } },
      {
        // Height tint: deep ocean → shallows → beach → greens → ochre → dark rock → snow.
        // Stops are packed into 0–2000 m because Australian ranges are low; each band reads distinctly.
        id: 'relief',
        type: 'color-relief',
        source: 'shade',
        paint: {
          'color-relief-color': [
            'interpolate',
            ['linear'],
            ['elevation'],
            -4000, '#06202f',
            -200, '#0c3b55',
            -20, '#1a6f86',
            -1, '#3fb3b8',
            // Zoomed in, the elevation data often reads the sea as exactly 0 m: keep that water-coloured.
            0, '#2a96ad',
            1, '#e9d8a6',
            30, '#a8cf7e',
            150, '#6fb25e',
            350, '#4f9447',
            550, '#7f9a4c',
            750, '#a08a55',
            950, '#9b6d45',
            1200, '#7d5a45',
            1500, '#9c948c',
            1800, '#d9d6d2',
            2000, '#ffffff',
          ],
          'color-relief-opacity': 1,
        },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'shade',
        paint: {
          'hillshade-exaggeration': 0.45,
          // Light from several directions makes ridges and gullies pop more than a single sun.
          'hillshade-method': 'multidirectional',
          'hillshade-illumination-direction': [270, 315, 0, 45],
          'hillshade-illumination-altitude': [30, 30, 30, 30],
          'hillshade-highlight-color': ['#fff7e0', '#fff7e0', '#fff7e0', '#fff7e0'],
          'hillshade-shadow-color': ['#0b1a24', '#0b1a24', '#0b1a24', '#0b1a24'],
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
            -4000, 'rgba(6, 32, 47, 0.8)',
            -200, 'rgba(12, 59, 85, 0.7)',
            -20, 'rgba(26, 111, 134, 0.45)',
            -0.5, 'rgba(63, 179, 184, 0.2)',
            0, 'rgba(42, 150, 173, 0.35)',
            1, 'rgba(0, 0, 0, 0)',
          ],
        },
      },
      {
        id: 'parks-fill',
        type: 'fill',
        source: 'parks',
        paint: { 'fill-color': COLORS.park, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 10, 0.22] },
      },
      {
        id: 'parks-outline',
        type: 'line',
        source: 'parks',
        minzoom: 6,
        paint: { 'line-color': '#7fe0a0', 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [3, 2] },
      },
      {
        id: 'lakes',
        type: 'fill',
        source: 'lakes',
        paint: { 'fill-color': '#1f86a8', 'fill-opacity': 0.85, 'fill-outline-color': COLORS.river },
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
        // Ghost every state that isn't active yet.
        id: 'states-ghost',
        type: 'fill',
        source: 'states',
        filter: ['!', ['get', 'active']],
        paint: { 'fill-color': COLORS.ghost, 'fill-opacity': 0.72 },
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
          'line-opacity': 0.7,
        },
      },
      {
        id: 'states-outline',
        type: 'line',
        source: 'states',
        paint: {
          'line-color': COLORS.outline,
          'line-width': ['case', ['get', 'active'], 1.5, 0.6],
          'line-opacity': ['case', ['get', 'active'], 0.9, 0.25],
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
          'text-letter-spacing': 0.08,
          'text-max-angle': 70,
        },
        paint: { 'text-color': COLORS.riverLabel, 'text-halo-color': '#0b3550', 'text-halo-width': 1.6 },
      },
      {
        id: 'park-labels',
        type: 'symbol',
        source: 'parks',
        minzoom: 7,
        filter: ['has', 'name'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_ITALIC,
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 11, 14],
          'text-max-width': 8,
          'symbol-sort-key': 10,
        },
        paint: { 'text-color': COLORS.parkLabel, 'text-halo-color': '#0f3a22', 'text-halo-width': 1.4 },
      },
      {
        id: 'beach-dots',
        type: 'circle',
        source: 'beaches',
        minzoom: 8,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 5],
          'circle-color': COLORS.beach,
          'circle-stroke-color': '#7a5a12',
          'circle-stroke-width': 1,
        },
      },
      {
        id: 'beach-labels',
        type: 'symbol',
        source: 'beaches',
        minzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11.5,
          'text-variable-anchor': ['left', 'right'],
          'text-radial-offset': 0.7,
          // Bigger beaches win when labels would overlap.
          'symbol-sort-key': ['-', 0, ['get', 'area']],
        },
        paint: { 'text-color': COLORS.beach, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.4 },
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
          'circle-stroke-color': COLORS.halo,
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
        paint: { 'text-color': COLORS.label, 'text-halo-color': COLORS.halo, 'text-halo-width': 1.6 },
      },
    ],
  };
}

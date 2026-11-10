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
 * - Label fonts (Noto Sans, open licence) are served from public/fonts, so nothing depends on a font server.
 * No API keys are needed for anything here.
 */

type Data = GeoJSONSourceSpecification['data'];

// Fonts live in public/fonts/<font name>/<range>.pbf. MapLibre needs an absolute URL template.
const GLYPHS = `${location.origin}${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`;
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Medium'];
const FONT_ITALIC = ['Noto Sans Italic'];

// Mapzen/AWS terrain tiles: free, keyless, global, includes ocean depth.
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain: Mapzen, AWS Open Data</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

export const COLORS = {
  ocean: '#0a2a3d',
  river: '#2b9be0',
  riverLabel: '#e6f8ff',
  label: '#fffaf0',
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
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } },
      {
        // Height tint: deep ocean → shallows → beach → green → dry → rock → snow.
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
            0, '#e9d8a6',
            40, '#9cc47a',
            300, '#5f9e58',
            700, '#8a9a5b',
            1200, '#a88b62',
            1700, '#c9c3b8',
            2100, '#ffffff',
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
          'hillshade-shadow-color': '#0b1a24',
          'hillshade-highlight-color': '#fff7e0',
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
            0, 'rgba(0, 0, 0, 0)',
          ],
        },
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

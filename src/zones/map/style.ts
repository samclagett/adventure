import type { GeoJSONSourceSpecification, StyleSpecification } from 'maplibre-gl';
import states from './data/australia-states.json';

/**
 * The map's look: a stylised, slightly game-like blend of real terrain and flat colour.
 * - Ocean depth and land height are tinted from the same free elevation tiles that give 3D terrain.
 * - States outside NSW and Victoria are "ghosted" with a dark wash.
 * No API keys are needed for anything here.
 */

// Mapzen/AWS terrain tiles: free, keyless, global, includes ocean depth.
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain: Mapzen, AWS Open Data</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

export const COLORS = {
  ocean: '#0a2a3d',
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
    sources: {
      // Two copies of the same tiles: MapLibre recommends separate sources for 3D terrain and shading.
      terrain: { ...demSource },
      shade: { ...demSource },
      states: { type: 'geojson', data: states as GeoJSONSourceSpecification['data'], promoteId: 'code' },
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
    ],
  };
}

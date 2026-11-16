import * as maplibregl from 'maplibre-gl';
import type { LngLatBoundsLike, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre runs its tile work in a Web Worker; tell it where Vite put the worker file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { buildStyle } from './style';
import type { Quality } from './quality';
import { getRelief } from './quality';

maplibregl.setWorkerUrl(workerUrl);

export type Region = 'NSW' | 'VIC' | 'TAS';

/**
 * Camera framing for each region button, plus the whole-country overview.
 * Matched to Sam's reference screenshots (Nov 2026): NSW frames the east coast (Goondiwindi to
 * Merimbula, Dubbo to the sea) rather than the whole state, which is mostly empty inland.
 */
const VIEWS: Record<Region | 'AUS', { bounds: LngLatBoundsLike; pitch: number; bearing: number }> = {
  AUS: { bounds: [[112, -44], [154, -10]], pitch: 0, bearing: 0 },
  NSW: { bounds: [[148.4, -37.2], [153.7, -28.5]], pitch: 25, bearing: 0 },
  VIC: { bounds: [[140.9, -39.3], [150.2, -34]], pitch: 25, bearing: 0 },
  TAS: { bounds: [[143.6, -43.7], [148.6, -39.6]], pitch: 25, bearing: 0 },
};

/** Room for the buttons at the top and bottom of the screen, so the region isn't hidden behind them. */
const UI_PADDING = { top: 70, bottom: 140, left: 16, right: 16 };

const STATE_CODES: Record<Region, string[]> = {
  NSW: ['NS', 'CT', 'JB'],
  VIC: ['VI'],
  TAS: ['TS'],
};

export interface AdventureMap {
  map: maplibregl.Map;
  flyToRegion(region: Region | 'AUS'): void;
  setQuality(q: Quality): void;
  /** How much to exaggerate height: 1 = real, 10 = extreme. */
  setRelief(r: number): void;
  onRegionChange(cb: (region: Region | 'AUS') => void): void;
  /** The region picked with the region buttons (or by tapping a state). */
  getRegion(): Region | 'AUS';
  /** Turn tap-a-state-to-zoom off while another zone wants map taps (e.g. dropping a pin). */
  setTapToZoom(on: boolean): void;
}

export function createMap(container: HTMLElement, quality: Quality): AdventureMap {
  const map = new maplibregl.Map({
    container,
    style: buildStyle(),
    bounds: VIEWS.AUS.bounds,
    fitBoundsOptions: { padding: 24 },
    minZoom: 2,
    maxPitch: 75,
    pixelRatio: quality === 'light' ? 1 : window.devicePixelRatio,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  let current: Region | 'AUS' = 'AUS';
  let currentQuality = quality;
  let relief = getRelief();
  let tapToZoom = true;
  const listeners: ((r: Region | 'AUS') => void)[] = [];

  function applyQuality(q: Quality) {
    currentQuality = q;
    if (q === 'full') {
      map.setTerrain({ source: 'terrain', exaggeration: relief });
      map.setSky({
        'sky-color': '#5fa8d3',
        'horizon-color': '#cfe8f0',
        'fog-color': '#0b1a24',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.4,
        'fog-ground-blend': 0.3,
        'atmosphere-blend': 0.8,
      });
    } else {
      map.setTerrain(null);
      map.setSky({ 'sky-color': '#0b1a24', 'horizon-color': '#0b1a24', 'fog-color': '#0b1a24' });
    }
    map.setPixelRatio(q === 'light' ? 1 : window.devicePixelRatio);
    applyShading();
  }

  /**
   * Shading strength follows the relief setting, so mountains stand out even in flat light mode.
   * Light mode shades a bit harder to make up for the missing 3D.
   */
  function applyShading() {
    const base = currentQuality === 'light' ? 0.5 : 0.35;
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', Math.min(1, base + 0.07 * relief));
  }

  /** Highlight the picked state; darken the other active states like the rest of Australia. */
  function setSelected(region: Region | 'AUS') {
    for (const [r, codes] of Object.entries(STATE_CODES)) {
      for (const code of codes) {
        map.setFeatureState({ source: 'states', id: code }, { selected: r === region, dim: region !== 'AUS' && r !== region });
      }
    }
  }

  function flyToRegion(region: Region | 'AUS') {
    current = region;
    const view = VIEWS[region];
    // Light mode uses a gentler tilt, since there is no 3D terrain to show off.
    const pitch = currentQuality === 'light' ? Math.min(view.pitch, 35) : view.pitch;
    const camera = map.cameraForBounds(view.bounds, { padding: region === 'AUS' ? 24 : UI_PADDING, bearing: view.bearing });
    if (camera) map.flyTo({ ...camera, pitch, bearing: view.bearing, duration: 2200, essential: true });
    if (map.isStyleLoaded()) setSelected(region);
    listeners.forEach((cb) => cb(region));
  }

  map.on('load', () => {
    // Keep the credits folded into the small (i) button so they don't sit under the bottom bar.
    container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    applyQuality(currentQuality);
    setSelected(current);
  });

  // Tap an active state to fly into it.
  map.on('click', 'states-active-hit', (e: MapLayerMouseEvent) => {
    const region = e.features?.[0]?.properties?.region as Region | undefined;
    if (tapToZoom && region && region !== current) flyToRegion(region);
  });
  map.on('mouseenter', 'states-active-hit', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'states-active-hit', () => (map.getCanvas().style.cursor = ''));

  return {
    map,
    flyToRegion,
    setRelief(r) {
      relief = r;
      if (!map.isStyleLoaded()) return;
      if (currentQuality === 'full') map.setTerrain({ source: 'terrain', exaggeration: relief });
      applyShading();
    },
    setQuality(q) {
      if (map.isStyleLoaded()) applyQuality(q);
      else currentQuality = q;
    },
    getRegion: () => current,
    onRegionChange(cb) {
      listeners.push(cb);
    },
    setTapToZoom(on) {
      tapToZoom = on;
    },
  };
}

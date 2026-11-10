import * as maplibregl from 'maplibre-gl';
import type { LngLatBoundsLike, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre runs its tile work in a Web Worker; tell it where Vite put the worker file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { buildStyle } from './style';
import type { Quality } from './quality';

maplibregl.setWorkerUrl(workerUrl);

export type Region = 'NSW' | 'VIC';

/** Camera framing for each active region, plus the whole-country overview. */
const VIEWS: Record<Region | 'AUS', { bounds: LngLatBoundsLike; pitch: number; bearing: number }> = {
  AUS: { bounds: [[112, -44], [154, -10]], pitch: 0, bearing: 0 },
  NSW: { bounds: [[141, -37.6], [153.7, -28.1]], pitch: 55, bearing: -12 },
  VIC: { bounds: [[140.9, -39.2], [150, -34]], pitch: 55, bearing: 10 },
};

const STATE_CODES: Record<Region, string[]> = {
  NSW: ['NS', 'CT', 'JB'],
  VIC: ['VI'],
};

export interface AdventureMap {
  map: maplibregl.Map;
  flyToRegion(region: Region | 'AUS'): void;
  setQuality(q: Quality): void;
  onRegionChange(cb: (region: Region | 'AUS') => void): void;
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
  const listeners: ((r: Region | 'AUS') => void)[] = [];

  function applyQuality(q: Quality) {
    currentQuality = q;
    if (q === 'full') {
      map.setTerrain({ source: 'terrain', exaggeration: 1.6 });
      map.setSky({
        'sky-color': '#5fa8d3',
        'horizon-color': '#cfe8f0',
        'fog-color': '#0b1a24',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.4,
        'fog-ground-blend': 0.3,
        'atmosphere-blend': 0.8,
      });
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.45);
    } else {
      map.setTerrain(null);
      map.setSky({ 'sky-color': '#0b1a24', 'horizon-color': '#0b1a24', 'fog-color': '#0b1a24' });
      // A little stronger shading makes up for the missing 3D.
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.75);
    }
    map.setPixelRatio(q === 'light' ? 1 : window.devicePixelRatio);
  }

  function setSelected(region: Region | 'AUS') {
    for (const [r, codes] of Object.entries(STATE_CODES)) {
      for (const code of codes) {
        map.setFeatureState({ source: 'states', id: code }, { selected: r === region });
      }
    }
  }

  function flyToRegion(region: Region | 'AUS') {
    current = region;
    const view = VIEWS[region];
    // Light mode uses a gentler tilt, since there is no 3D terrain to show off.
    const pitch = currentQuality === 'light' ? Math.min(view.pitch, 35) : view.pitch;
    const camera = map.cameraForBounds(view.bounds, { padding: 32, bearing: view.bearing });
    if (camera) map.flyTo({ ...camera, pitch, bearing: view.bearing, duration: 2200, essential: true });
    if (map.isStyleLoaded()) setSelected(region);
    listeners.forEach((cb) => cb(region));
  }

  map.on('load', () => {
    applyQuality(currentQuality);
    setSelected(current);
  });

  // Tap an active state to fly into it.
  map.on('click', 'states-active-hit', (e: MapLayerMouseEvent) => {
    const region = e.features?.[0]?.properties?.region as Region | undefined;
    if (region && region !== current) flyToRegion(region);
  });
  map.on('mouseenter', 'states-active-hit', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'states-active-hit', () => (map.getCanvas().style.cursor = ''));

  return {
    map,
    flyToRegion,
    setQuality(q) {
      if (map.isStyleLoaded()) applyQuality(q);
      else currentQuality = q;
    },
    onRegionChange(cb) {
      listeners.push(cb);
    },
  };
}

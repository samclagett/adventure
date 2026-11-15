import type * as maplibregl from 'maplibre-gl';
import './flythrough.css';

/** The place to fly around. `color` is the category's muted accent; `label` is the category name. */
export interface FlyPlace {
  lat: number;
  lng: number;
  name: string;
  label: string;
  color: string;
}

/** Hooks so map.ts can switch 3D terrain on for the flight (even in light mode) and restore it after. */
export interface FlyHooks {
  begin(): void;
  end(): void;
}

const LAYER_ID = 'flythrough-marker';
/** Seconds for one full circle around the place. */
const ORBIT_SECONDS = 28;
const ORBIT_ZOOM = 13;
const ORBIT_PITCH = 64;

let stopCurrent: (() => void) | null = null;

/**
 * A short 3D flythrough: the camera flies in to the place, then circles it once over the terrain,
 * with a three.js marker (a light beam and a slowly turning gem) standing on the ground.
 * three.js is only downloaded the first time a flythrough starts, so the app's first load stays light.
 * Any touch on the map, or the Stop button, ends it. Resolves when it ends.
 */
export async function flyAround(map: maplibregl.Map, place: FlyPlace, hooks: FlyHooks): Promise<void> {
  stopCurrent?.();
  // three.js and the marker are only downloaded the first time.
  const { markerLayer } = await import('./marker3d');

  return new Promise((resolve) => {
    const container = map.getContainer();
    const overlay = buildOverlay(place);
    container.appendChild(overlay);
    document.body.classList.add('adv-flying');
    hooks.begin();

    const layer = markerLayer(map, place, LAYER_ID);
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    map.addLayer(layer);

    const canvas = map.getCanvasContainer();
    let raf = 0;
    let ended = false;
    const progress = overlay.querySelector<HTMLElement>('.fly-progress span')!;

    function stop() {
      if (ended) return;
      ended = true;
      stopCurrent = null;
      cancelAnimationFrame(raf);
      map.stop();
      map.off('moveend', startOrbit);
      canvas.removeEventListener('pointerdown', stop);
      canvas.removeEventListener('wheel', stop);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      overlay.classList.add('leaving');
      setTimeout(() => overlay.remove(), 300);
      document.body.classList.remove('adv-flying');
      hooks.end();
      // Settle back to a calmer tilt so the normal map controls feel right again.
      map.easeTo({ pitch: Math.min(map.getPitch(), 50), duration: 900 });
      resolve();
    }
    stopCurrent = stop;

    // A touch or scroll on the map hands control back straight away.
    canvas.addEventListener('pointerdown', stop);
    canvas.addEventListener('wheel', stop, { passive: true });
    overlay.querySelector('button')!.addEventListener('click', stop);

    // 1. Fly in, looking at the place from the north-west (the sun side in the southern sky).
    const startBearing = map.getBearing();
    map.flyTo({
      center: [place.lng, place.lat],
      zoom: ORBIT_ZOOM,
      pitch: ORBIT_PITCH,
      bearing: startBearing - 30,
      duration: 4000,
      curve: 1.6,
      essential: true,
    });

    // 2. Then circle once, drifting gently in and out.
    function startOrbit() {
      map.off('moveend', startOrbit);
      if (ended) return;
      const b0 = map.getBearing();
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = (now - t0) / 1000 / ORBIT_SECONDS;
        if (t >= 1) return stop();
        const turn = 0.5 - 0.5 * Math.cos(Math.PI * t); // eases in and out of the circle
        map.jumpTo({
          bearing: b0 + 360 * turn,
          zoom: ORBIT_ZOOM + 0.35 * Math.sin(t * Math.PI),
          pitch: ORBIT_PITCH - 6 * Math.sin(t * Math.PI),
        });
        progress.style.transform = `scaleX(${t.toFixed(3)})`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    map.once('moveend', startOrbit);
  });
}

/** The name card shown at the bottom during the flight, with a Stop button and a thin progress line. */
function buildOverlay(place: FlyPlace): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fly-overlay';
  el.style.setProperty('--pin', place.color);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  el.innerHTML = `
    <div class="fly-card">
      <div class="fly-text"><small>${esc(place.label)}</small><strong>${esc(place.name)}</strong></div>
      <button type="button">Stop</button>
      <div class="fly-progress"><span></span></div>
    </div>`;
  return el;
}

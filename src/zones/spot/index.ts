import './spot.css';
import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import type { ConditionsData } from '../conditions/data';
import { COASTAL } from '../conditions/data';
import { categoryOf } from '../hitlist/categories';
import { compass, dayShort, clock, todayIso, weatherWord } from '../conditions/summary';
import { windArrow } from '../conditions/weather-icons';
import { getQuality } from '../map/quality';
import type { SpotScene } from './scene';
import { hourAt, hoursOf, nowKey, type SpotHour } from './weather';

/** Shown on the scene: where the ground comes from. Kept here so the scene's code (three.js) can load later. */
const GROUND_CREDIT = 'Imagery Esri, Maxar, Earthstar Geographics · Terrain Mapzen, Geoscience Australia';

/**
 * The 3D spot view: open a place and the top third of the screen becomes a detailed 3D scene of it
 * (scene.ts), with the place card and its conditions in the bottom two thirds.
 * The scene shows the chosen hour's swell, wind, sun, cloud and rain; step through the hours with ‹ ›.
 * Pull the card down and the scene hides (the map shows again); close the card and the scene is thrown away.
 */

/** Ground shown (metres a side): tighter at the coast for a sharp beach, wider inland for the hills around. */
const SIZE_COAST = 2400;
const SIZE_INLAND = 4200;
const STEP_HOURS = 3;
/** Prototype (2026-11-25): only Killalea gets the 3D view until Sam has tried it. Remove this to roll out to every place. */
const PROTOTYPE = /killalea/i;
const wants3d = (i: HitListItem) => i.lat != null && PROTOTYPE.test(i.name);

export function mountSpot(parent: HTMLElement, hl: HitListApi, data: ConditionsData) {
  const panel = document.createElement('section');
  panel.className = 'spot';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="spot-canvas"></div>
    <div class="spot-loading">Building the 3D view…</div>
    <div class="spot-hud"></div>
    <div class="spot-time">
      <button type="button" data-step="-1" aria-label="Earlier">‹</button>
      <span class="spot-when"></span>
      <button type="button" data-step="1" aria-label="Later">›</button>
    </div>
    <small class="spot-credit">${GROUND_CREDIT}</small>
  `;
  parent.append(panel);
  const canvasHost = panel.querySelector<HTMLElement>('.spot-canvas')!;
  const hud = panel.querySelector<HTMLElement>('.spot-hud')!;
  const when = panel.querySelector<HTMLElement>('.spot-when')!;
  const loading = panel.querySelector<HTMLElement>('.spot-loading')!;

  let scene: SpotScene | null = null;
  let item: HitListItem | null = null;
  let hours: string[] = [];
  let at = 0;

  /** The scene's height: a third of the app. Place cards leave this much room above them. */
  const topPx = () => Math.round(parent.clientHeight / 3);
  hl.setCardTop((i) => (wants3d(i) ? topPx() : null));

  function hourLabel(t: string): string {
    if (t === nowKey()) return 'Now';
    const d = t.slice(0, 10);
    const day = d === todayIso() ? 'Today' : dayShort(d);
    return `${day} ${clock(Number(t.slice(11, 13)))}`;
  }

  function hudHtml(h: SpotHour): string {
    const chips: string[] = [];
    const wx = [h.temp != null ? `${Math.round(h.temp)}°` : '', weatherWord(h.code)].filter(Boolean).join(' · ');
    if (wx) chips.push(`<span class="spot-chip">${wx}${h.rain >= 0.1 ? ` · ${h.rain.toFixed(1)} mm` : ''}</span>`);
    const rel = h.relation ? ` · ${h.relation}` : '';
    chips.push(
      `<span class="spot-chip">${windArrow(h.windFrom, 'spot-arrow')} Wind ${compass(h.windFrom)} ${Math.round(h.wind)}${h.gust != null ? `–${Math.round(h.gust)}` : ''} km/h${rel}</span>`,
    );
    if (h.swell != null && h.swellFrom != null) {
      chips.push(
        `<span class="spot-chip">${windArrow(h.swellFrom, 'spot-arrow')} Swell ${h.swell.toFixed(1)} m${h.period != null ? ` · ${Math.round(h.period)} s` : ''} ${compass(h.swellFrom)}</span>`,
      );
    }
    return chips.join('');
  }

  function showHour() {
    if (!item || !scene) return;
    const f = data.get(item);
    if (!f) {
      hud.innerHTML = `<span class="spot-chip">${data.loading ? 'Getting the forecast…' : 'No forecast yet'}</span>`;
      when.textContent = '';
      return;
    }
    if (!hours.length) {
      hours = hoursOf(f);
      at = 0;
    }
    const t = hours[at];
    const h = t ? hourAt(f, t, item.faces) : null;
    if (!h) return;
    scene.setHour(h);
    hud.innerHTML = hudHtml(h);
    when.textContent = hourLabel(t);
    panel.querySelector<HTMLButtonElement>('[data-step="-1"]')!.disabled = at <= 0;
    panel.querySelector<HTMLButtonElement>('[data-step="1"]')!.disabled = at + STEP_HOURS >= hours.length;
  }

  panel.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      at = Math.max(0, Math.min(hours.length - 1, at + Number(b.dataset.step) * STEP_HOURS));
      showHour();
    }),
  );

  /** three.js is big, so the scene's code only loads the first time a spot opens. */
  let loader: Promise<typeof import('./scene')> | null = null;
  /** Bumped on every open and close, so a slow load for a place you've left is dropped. */
  let ticket = 0;

  async function open(next: HitListItem) {
    panel.style.height = `${topPx()}px`;
    panel.hidden = false;
    parent.classList.add('spot-open');
    if (scene && item?.id === next.id) {
      scene.start();
      return;
    }
    close();
    const mine = ++ticket;
    panel.hidden = false;
    parent.classList.add('spot-open');
    item = next;
    hours = [];
    loading.hidden = false;
    const coastal = COASTAL.has(categoryOf(next.activity).id);
    loader ??= import('./scene');
    let mod: typeof import('./scene');
    try {
      mod = await loader;
    } catch {
      loader = null;
      loading.textContent = 'Couldn’t load the 3D view. Check your connection.';
      return;
    }
    if (mine !== ticket) return;
    scene = new mod.SpotScene(canvasHost, {
      lat: next.lat!,
      lng: next.lng!,
      faces: next.faces,
      size: coastal ? SIZE_COAST : SIZE_INLAND,
      coastal,
      pixelRatio: getQuality() === 'light' ? 1 : Math.min(window.devicePixelRatio, 2),
    });
    const s = scene;
    if (import.meta.env.DEV) (window as unknown as { __spot: SpotScene }).__spot = s;
    showHour();
    if (!panel.hidden) s.start();
    s.load().then(
      () => {
        if (scene !== s) return;
        loading.hidden = true;
        showHour();
      },
      () => {
        if (scene === s) loading.textContent = 'Couldn’t load the 3D view. Check your connection.';
      },
    );
  }

  /** Hide the scene but keep it, so pulling the card back up is instant. */
  function pause() {
    scene?.stop();
    panel.hidden = true;
    parent.classList.remove('spot-open');
  }

  function close() {
    ticket++;
    scene?.dispose();
    scene = null;
    item = null;
    panel.hidden = true;
    loading.hidden = true;
    loading.textContent = 'Building the 3D view…';
    parent.classList.remove('spot-open');
  }

  hl.onCardChange((next, snap) => {
    if (!next || !wants3d(next)) close();
    else if (snap === 'full') void open(next);
    else if (next.id === item?.id) pause();
    else close();
  });

  data.onChange(() => {
    if (item && scene && !panel.hidden) showHour();
  });

  // Save the battery while the app is in the background.
  document.addEventListener('visibilitychange', () => {
    if (!scene || panel.hidden) return;
    if (document.hidden) scene.stop();
    else scene.start();
  });
}

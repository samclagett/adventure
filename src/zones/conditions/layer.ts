import * as maplibregl from 'maplibre-gl';
import type { AdventureMap } from '../map';
import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import { COASTAL, type ConditionsData } from './data';
import type { Forecast } from './openmeteo';
import { daysOf, rateDay, seaFor, todayIso, dayLabel, compass, windArrowClass, VERDICT_WORD } from './summary';
import { alertIcons } from './alerts';
import { WEATHER_ICONS, KIND_WORD, weatherKind, windArrow as arrow } from './weather-icons';

/**
 * Explore mode's live weather layer: beside each pin on the map, the day's weather symbol and top
 * temperature, a wind arrow (pointing the way the wind blows) with its speed, and for coastal spots a
 * swell arrow with its height. A day stepper at the top picks the day. On by default while testing.
 */

const LAYER_KEY = 'adventure.conditions.layer';
const DAYS_AHEAD = 13;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/**
 * A small matrix beside the pin: a column for each part of the day that counts (AM and PM, or just the
 * night for camping), each with its weather symbol and temperature, wind, and swell on the coast.
 * Alerts (fire danger, wet rock…) sit at the end as small icons. The ring is the day's rating.
 */
export function chipFor(item: HitListItem, f: Forecast, date: string): { html: string; rank: number; label: string; verdict: string } | null {
  const cat = categoryOf(item.activity).id;
  const day = daysOf(f, [date], cat, item)[0];
  if (!day) return null;
  const rated = rateDay(cat, day);
  const coastal = COASTAL.has(cat) && !!day.surf;
  let body: string;
  if (day.periods.length) {
    body = day.periods
      .map((p) => {
        const sea = coastal ? seaFor(f, day.date, p.id) : null;
        return `<span class="wx-col"><small>${p.label}</small><span class="wx-part">${WEATHER_ICONS[p.kind]}${p.temp != null ? `<b>${Math.round(p.temp)}°</b>` : ''}</span>${
          p.wind != null ? `<span class="wx-part wx-wind">${p.windDir != null ? arrow(p.windDir, windArrowClass(cat, item.faces, p.windDir)) : ''}${Math.round(p.wind)}</span>` : ''
        }${sea?.swell != null ? `<span class="wx-part wx-swell">${sea.swellDir != null ? arrow(sea.swellDir, 'wx-a-swell') : ''}${sea.swell.toFixed(1)}m</span>` : ''}</span>`;
      })
      .join('');
  } else {
    // Older saved forecasts with no hour-by-hour weather: one column for the day.
    body = `<span class="wx-col"><span class="wx-part">${WEATHER_ICONS[weatherKind(day.code)]}${day.tmax != null ? `<b>${Math.round(day.tmax)}°</b>` : ''}</span>${
      day.wind != null ? `<span class="wx-part wx-wind">${day.windDir != null ? arrow(day.windDir, windArrowClass(cat, item.faces, day.windDir)) : ''}${Math.round(day.wind)}</span>` : ''
    }${coastal ? `<span class="wx-part wx-swell">${day.surf!.swellDir != null ? arrow(day.surf!.swellDir, 'wx-a-swell') : ''}${day.surf!.swellMax.toFixed(1)}m</span>` : ''}</span>`;
  }
  const label = [
    item.name,
    VERDICT_WORD[rated.verdict],
    ...rated.why.slice(0, 2),
    ...day.periods.map((p) => `${p.label} ${KIND_WORD[p.kind]}${p.temp != null ? ` ${Math.round(p.temp)} degrees` : ''}${p.wind != null ? `, wind ${p.windDir != null ? compass(p.windDir) + ' ' : ''}${Math.round(p.wind)} km/h` : ''}`),
    ...rated.alerts.map((a) => a.text),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    html: `<span class="wx-chip wx-v-${rated.verdict}">${body}${alertIcons(rated.alerts)}</span>`,
    rank: ['go', 'mar', 'skip', 'na'].indexOf(rated.verdict),
    label,
    verdict: rated.verdict,
  };
}

export function mountLayer(parent: HTMLElement, adv: AdventureMap, hl: HitListApi, data: ConditionsData) {
  const map = adv.map;
  let items: HitListItem[] = [];
  let on = true;
  try {
    on = localStorage.getItem(LAYER_KEY) !== 'off';
  } catch {
    /* private mode */
  }
  let offset = 0;
  const markers = new Map<string, maplibregl.Marker>();

  const bar = document.createElement('div');
  bar.className = 'wx-bar';
  parent.append(bar);

  const date = () => addDays(todayIso(), offset);

  function dayName(): string {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    return dayLabel(date());
  }

  function renderBar() {
    bar.classList.toggle('on', on);
    bar.innerHTML = `<button type="button" class="wx-toggle" aria-pressed="${on}" aria-label="${on ? 'Hide' : 'Show'} weather on the map">${WEATHER_ICONS.partly}</button>${
      on
        ? `<button type="button" class="wx-step" data-step="-1" aria-label="Previous day" ${offset === 0 ? 'disabled' : ''}>‹</button><span class="wx-day">${esc(dayName())}</span><button type="button" class="wx-step" data-step="1" aria-label="Next day" ${offset >= DAYS_AHEAD ? 'disabled' : ''}>›</button>`
        : ''
    }`;
    bar.querySelector('.wx-toggle')!.addEventListener('click', () => {
      on = !on;
      try {
        localStorage.setItem(LAYER_KEY, on ? 'on' : 'off');
      } catch {
        /* private mode */
      }
      render();
    });
    bar.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
      b.addEventListener('click', () => {
        offset = Math.max(0, Math.min(DAYS_AHEAD, offset + Number(b.dataset.step)));
        render();
      }),
    );
  }

  function render() {
    renderBar();
    markers.forEach((m) => m.remove());
    markers.clear();
    if (!on) {
      setRatings(null);
      return;
    }
    const ratings = new Map<string, string>();
    for (const item of items) {
      let c: ReturnType<typeof chipFor> = null;
      try {
        const f = data.get(item);
        if (f) c = chipFor(item, f, date());
      } catch (err) {
        console.error('Weather chip for', item.name, err);
      }
      if (!c) continue;
      if (c.verdict !== 'na') ratings.set(item.id, c.verdict);
      // No chip for pins folded into a numbered group; it appears once you zoom in.
      if (hl.isGrouped(item.id)) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'wx-marker';
      el.dataset.rank = String(c.rank);
      el.innerHTML = c.html;
      el.setAttribute('aria-label', c.label);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        hl.openItem(item.id);
      });
      markers.set(item.id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([item.lng!, item.lat!]).addTo(map));
    }
    declutter();
    setRatings(ratings);
  }

  /** Pin rings take the same rating colour as their tag. Only passed on when it changes (it redraws the groups). */
  let lastRatings = '';
  function setRatings(r: Map<string, string> | null) {
    const key = r ? [...r.entries()].sort().join() : '';
    if (key === lastRatings) return;
    lastRatings = key;
    hl.setPinRatings(r);
  }

  /** Hide chips that would overlap another; better-rated places win, then north to south. */
  function declutter() {
    const shown: DOMRect[] = [];
    [...markers.values()]
      .map((m) => m.getElement())
      .map((el) => {
        el.classList.remove('wx-hidden');
        return { el, rank: Number(el.dataset.rank), r: el.querySelector('.wx-chip')!.getBoundingClientRect() };
      })
      .sort((a, b) => a.rank - b.rank || a.r.top - b.r.top)
      .forEach(({ el, r }) => {
        if (!r.width) return;
        const hit = shown.some((s) => r.left < s.right + 3 && r.right > s.left - 3 && r.top < s.bottom + 3 && r.bottom > s.top - 3);
        if (hit) el.classList.add('wx-hidden');
        else shown.push(r);
      });
  }

  /** Zoomed out, chips shrink to the weather symbol and temperature so they don't cover the map. */
  const COMPACT_BELOW_ZOOM = 8;
  function compact() {
    const was = parent.classList.contains('wx-compact');
    const now = map.getZoom() < COMPACT_BELOW_ZOOM;
    if (was !== now) parent.classList.toggle('wx-compact', now);
  }
  map.on('zoom', compact);
  compact();

  map.on('moveend', declutter);
  hl.onGroupsChange(render);
  data.onChange(render);
  render();

  return {
    setItems(next: HitListItem[]) {
      items = next;
      render();
    },
    /** Jump the layer to a date (YYYY-MM-DD), e.g. the best day of a planner pick. */
    showDay(iso: string) {
      const today = todayIso();
      let n = 0;
      while (n < DAYS_AHEAD && addDays(today, n) < iso) n++;
      offset = n;
      on = true;
      render();
    },
  };
}

import * as maplibregl from 'maplibre-gl';
import type { AdventureMap } from '../map';
import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import { COASTAL, type ConditionsData } from './data';
import { daysOf, rateDay, todayIso, dayLabel, compass, VERDICT_WORD } from './summary';
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

  function chip(item: HitListItem): { html: string; rank: number; label: string } | null {
    const f = data.get(item);
    if (!f) return null;
    const cat = categoryOf(item.activity).id;
    const day = daysOf(f, [date()], cat, item.faces)[0];
    if (!day) return null;
    const rated = rateDay(cat, day);
    const parts: string[] = [];
    // Morning and afternoon (and night for camping) symbols, else one for the day.
    const icons = day.periods.length
      ? `<span class="wx-periods">${day.periods.map((p) => `<span class="wx-period">${WEATHER_ICONS[p.kind]}<small>${p.label}</small></span>`).join('')}</span>`
      : WEATHER_ICONS[weatherKind(day.code)];
    parts.push(`<span class="wx-part">${icons}${day.tmax != null ? `<b>${Math.round(day.tmax)}°</b>` : ''}</span>`);
    if (day.wind != null) {
      parts.push(`<span class="wx-part wx-wind">${day.windDir != null ? arrow(day.windDir, 'wx-a-wind') : ''}${Math.round(day.wind)}</span>`);
    }
    if (COASTAL.has(cat) && day.surf) {
      parts.push(`<span class="wx-part wx-swell">${day.surf.swellDir != null ? arrow(day.surf.swellDir, 'wx-a-swell') : ''}${day.surf.swellMax.toFixed(1)}m</span>`);
    }
    const label = [
      item.name,
      `${VERDICT_WORD[rated.verdict]}`,
      ...day.periods.map((p) => `${p.label} ${KIND_WORD[p.kind]}`),
      day.tmax != null ? `${Math.round(day.tmax)} degrees` : '',
      day.wind != null ? `wind ${day.windDir != null ? compass(day.windDir) + ' ' : ''}${Math.round(day.wind)} km/h` : '',
      day.surf ? `swell ${day.surf.swellMax.toFixed(1)} m` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return { html: `<span class="wx-chip wx-v-${rated.verdict}">${parts.join('')}</span>`, rank: ['go', 'mar', 'skip', 'na'].indexOf(rated.verdict), label };
  }

  function render() {
    renderBar();
    markers.forEach((m) => m.remove());
    markers.clear();
    if (!on) return;
    for (const item of items) {
      // No chip for pins folded into a numbered group; it appears once you zoom in.
      if (hl.isGrouped(item.id)) continue;
      let c: ReturnType<typeof chip> = null;
      try {
        c = chip(item);
      } catch (err) {
        console.error('Weather chip for', item.name, err);
      }
      if (!c) continue;
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

import './conditions.css';
import * as maplibregl from 'maplibre-gl';
import type { AdventureMap } from '../map';
import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { CATEGORIES, categoryOf } from '../hitlist/categories';
import { fetchForecasts, type Forecast } from './openmeteo';
import { WINDOWS, bubbleFor, daysFor, daysOf, rowsFor, type Bubble, type WindowId, VERDICT_WORD, dayShort } from './summary';

/**
 * Conditions: a "Conditions" button that fetches forecasts (Open-Meteo, straight from the browser) for the
 * hit list places on the map, a small callout bubble by each pin with what matters for that kind of
 * adventure, and a day-by-day section on each pin card.
 */

/** Categories that also get swell, tides and water temperature. */
const COASTAL = new Set(['surfing', 'diving', 'kayaking']);
/** Forecasts older than this are fetched again. */
const STALE_MS = 30 * 60 * 1000;
/** Bubbles show from this zoom in, where pins are spread out enough to read them. */
const BUBBLE_MIN_ZOOM = 8;
const WINDOW_KEY = 'adventure.conditions.window';

const ICON_WEATHER =
  '<svg class="hl-icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-760q-17 0-28.5-11.5T440-800v-80q0-17 11.5-28.5T480-920q17 0 28.5 11.5T520-880v80q0 17-11.5 28.5T480-760Zm198 82q-11-11-11-28t11-28l56-57q12-12 28.5-12t28.5 12q11 11 11 28t-11 28l-57 57q-11 11-28 11t-28-11Zm122 238q-17 0-28.5-11.5T760-480q0-17 11.5-28.5T800-520h80q17 0 28.5 11.5T920-480q0 17-11.5 28.5T880-440h-80Zm-66 271-56-57q-11-11-11-28t11-28q11-11 28-11t28 11l57 56q12 12 12 28.5T791-169q-12 12-28.5 12T734-169ZM226-678l-57-57q-11-11-11-28t11-28q12-12 28.5-12t28.5 12l56 57q11 11 11 28t-11 28q-11 11-28 11t-28-11Zm14 478h180q25 0 42.5-17.5T480-260q0-25-17-42.5T421-320h-51l-20-48q-14-33-44-52.5T240-440q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0 80q-83 0-141.5-58.5T40-320q0-83 58.5-141.5T240-520q60 0 109.5 32.5T423-400q58 0 97.5 43T560-254q-2 57-42.5 95.5T420-120H240Zm320-134q-5-20-10-39t-10-39q45-19 72.5-59t27.5-89q0-66-47-113t-113-47q-60 0-105 39t-53 99q-20-5-41-9t-41-9q14-88 82.5-144T480-720q100 0 170 70t70 170q0 77-44 138.5T560-254Zm-79-226Z"/></svg>';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function ago(when: number): string {
  const mins = Math.round((Date.now() - when) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

interface Entry {
  forecast: Forecast | null;
  /** Where and what it was fetched for, so a moved pin or changed category is fetched again. */
  key: string;
  at: number;
}

const keyOf = (i: HitListItem) => `${i.lat!.toFixed(4)},${i.lng!.toFixed(4)},${COASTAL.has(categoryOf(i.activity).id)}`;

export function mountConditions(parent: HTMLElement, adv: AdventureMap, hl: HitListApi) {
  const map = adv.map;
  let windowId: WindowId = 'weekend';
  try {
    const saved = localStorage.getItem(WINDOW_KEY) as WindowId | null;
    if (saved && WINDOWS.some((w) => w.id === saved)) windowId = saved;
  } catch {
    /* private mode */
  }
  let visible: HitListItem[] = [];
  const entries = new Map<string, Entry>();
  let showBubbles = false;
  let loading = false;
  let error = '';
  let open = false;
  const markers = new Map<string, maplibregl.Marker>();
  /** Re-fill the open pin card's section when data or window changes. */
  let refillCard: (() => void) | null = null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cd-btn';
  btn.innerHTML = `${ICON_WEATHER}<span>Conditions</span>`;

  const sheet = document.createElement('section');
  sheet.className = 'cd-sheet';
  sheet.hidden = true;
  parent.append(btn, sheet);

  // ---- Data ----

  function windowDays() {
    return daysFor(windowId);
  }

  function windowShort() {
    return WINDOWS.find((w) => w.id === windowId)!.short;
  }

  function entryFor(item: HitListItem): Entry | undefined {
    const e = entries.get(item.id);
    return e && e.key === keyOf(item) ? e : undefined;
  }

  function bubbleOf(item: HitListItem): Bubble | null {
    const f = entryFor(item)?.forecast;
    if (!f) return null;
    const cat = categoryOf(item.activity).id;
    return bubbleFor(cat, daysOf(f, windowDays(), cat, item.faces), windowShort());
  }

  /** Fetch forecasts for any of these items that don't have a fresh one. */
  async function ensure(items: HitListItem[], force = false) {
    const need = items.filter((i) => {
      const e = entryFor(i);
      return force || !e || Date.now() - e.at > STALE_MS;
    });
    if (!need.length || loading) return;
    loading = true;
    error = '';
    render();
    try {
      const results = await fetchForecasts(
        need.map((i) => ({ lat: i.lat!, lng: i.lng! })),
        need.map((i) => COASTAL.has(categoryOf(i.activity).id)),
      );
      const at = Date.now();
      need.forEach((i, n) => entries.set(i.id, { forecast: results[n], key: keyOf(i), at }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    loading = false;
    render();
  }

  function lastFetched(): number | null {
    const times = visible.map((i) => entryFor(i)?.at).filter((t): t is number => t != null);
    return times.length ? Math.min(...times) : null;
  }

  // ---- Bubbles on the map ----

  function bubbleHtml(name: string, b: Bubble): string {
    const strip = b.strip && b.strip.length > 1
      ? `<span class="cd-strip">${b.strip.map((s) => `<i class="cd-v-${s.verdict}" title="${dayShort(s.date)}: ${VERDICT_WORD[s.verdict]}"></i>`).join('')}</span>`
      : '';
    const lines = b.lines.filter(Boolean);
    return `<span class="cd-bubble-box ${b.verdict ? `cd-has-v cd-v-${b.verdict}` : ''}"><em>${esc(name)}</em><b>${esc(lines[0])}</b>${lines.slice(1).map((l) => `<span>${esc(l)}</span>`).join('')}${strip}</span>`;
  }

  function renderBubbles() {
    markers.forEach((m) => m.remove());
    markers.clear();
    if (!showBubbles) return;
    for (const item of visible) {
      const b = bubbleOf(item);
      if (!b) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cd-bubble';
      el.innerHTML = bubbleHtml(item.name, b);
      el.dataset.rank = String(b.verdict ? 'go mar skip na'.indexOf(b.verdict) : 1);
      el.setAttribute('aria-label', `${item.name}: ${b.lines.join(', ')}`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        hl.openItem(item.id);
      });
      markers.set(item.id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([item.lng!, item.lat!]).addTo(map));
    }
    declutter();
  }

  /** Hide bubbles that would sit on top of another one; better surf verdicts win, then north to south. */
  function declutter() {
    if (!map.getContainer().classList.contains('cd-zoom')) return;
    const shown: DOMRect[] = [];
    const els = [...markers.values()].map((m) => m.getElement());
    els.forEach((el) => el.classList.remove('cd-hidden'));
    els
      .map((el) => ({ el, rank: Number(el.dataset.rank), r: el.querySelector('.cd-bubble-box')!.getBoundingClientRect() }))
      .sort((a, b) => a.rank - b.rank || a.r.top - b.r.top)
      .forEach(({ el, r }) => {
        const hit = shown.some((s) => r.left < s.right + 4 && r.right > s.left - 4 && r.top < s.bottom + 4 && r.bottom > s.top - 4);
        if (hit) el.classList.add('cd-hidden');
        else shown.push(r);
      });
  }
  map.on('moveend', declutter);

  const zoomClass = () => {
    const was = map.getContainer().classList.contains('cd-zoom');
    const now = map.getZoom() >= BUBBLE_MIN_ZOOM;
    map.getContainer().classList.toggle('cd-zoom', now);
    if (now && !was) declutter();
  };
  map.on('zoom', zoomClass);
  zoomClass();

  // ---- Sheet ----

  function windowChips(): string {
    return `<div class="cd-windows" role="tablist">${WINDOWS.map(
      (w) => `<button type="button" data-win="${w.id}" class="${w.id === windowId ? 'on' : ''}" aria-pressed="${w.id === windowId}">${w.label}</button>`,
    ).join('')}</div>`;
  }

  function bindWindowChips(root: HTMLElement) {
    root.querySelectorAll<HTMLButtonElement>('[data-win]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        windowId = b.dataset.win as WindowId;
        try {
          localStorage.setItem(WINDOW_KEY, windowId);
        } catch {
          /* private mode */
        }
        render();
      }),
    );
  }

  function statusLine(): string {
    if (loading) return '<p class="cd-muted">Getting the latest forecasts…</p>';
    if (error) return `<p class="cd-warn">Couldn’t get conditions: ${esc(error)}. <button type="button" class="cd-link" data-act="retry">Try again</button></p>`;
    const at = lastFetched();
    return at ? `<p class="cd-muted">Open-Meteo forecast, fetched ${ago(at)}. <button type="button" class="cd-link" data-act="retry">Refresh</button></p>` : '';
  }

  function renderSheet() {
    if (!open) return;
    const rows = CATEGORIES.map((c) => {
      const inCat = visible.filter((i) => categoryOf(i.activity).id === c.id);
      if (!inCat.length) return '';
      const list = inCat
        .map((i) => ({ i, b: bubbleOf(i) }))
        .sort((a, b) => (a.b?.verdict && b.b?.verdict ? 'go mar skip na'.indexOf(a.b.verdict) - 'go mar skip na'.indexOf(b.b.verdict) : 0))
        .map(({ i, b }) => {
          const text = b ? b.lines.filter(Boolean).map(esc).join('<br>') : loading ? '…' : '<span class="cd-muted">No forecast</span>';
          return `<button type="button" class="cd-row ${b?.verdict ? `cd-v-${b.verdict}` : ''}" data-id="${i.id}" style="--pin:${c.color}"><span class="cd-row-icon">${c.icon}</span><span class="cd-row-name">${esc(i.name)}</span><span class="cd-row-sum">${text}</span></button>`;
        })
        .join('');
      return `<h3>${c.icon} ${esc(c.label)}</h3>${list}`;
    }).join('');
    const region = adv.getRegion();
    sheet.innerHTML = `<button type="button" class="cd-close" aria-label="Close">✕</button><div class="cd-body">
      <h2>Conditions</h2>
      ${windowChips()}
      ${statusLine()}
      <label class="cd-toggle"><input type="checkbox" ${showBubbles ? 'checked' : ''} data-act="bubbles" /> Show on the map (zoom in to see them)</label>
      ${visible.length ? rows : `<p class="cd-muted">No places on the map${region === 'AUS' ? '' : ` in ${region}`}. Sign in, or pick another state or category.</p>`}
      <p class="cd-muted cd-foot">Swell is the model’s open-ocean swell in metres, not the wave face height Surfline reports in feet. Surf verdicts are a first rough pass.</p>
    </div>`;
    sheet.querySelector('.cd-close')!.addEventListener('click', close);
    bindWindowChips(sheet);
    sheet.querySelector('[data-act="retry"]')?.addEventListener('click', () => ensure(visible, true));
    sheet.querySelector<HTMLInputElement>('[data-act="bubbles"]')!.addEventListener('change', (e) => {
      showBubbles = (e.target as HTMLInputElement).checked;
      renderBubbles();
    });
    sheet.querySelectorAll<HTMLButtonElement>('.cd-row').forEach((row) =>
      row.addEventListener('click', () => {
        close();
        hl.openItem(row.dataset.id!);
      }),
    );
  }

  function render() {
    renderSheet();
    renderBubbles();
    refillCard?.();
    btn.classList.toggle('on', showBubbles);
    btn.classList.toggle('loading', loading);
  }

  function close() {
    open = false;
    sheet.hidden = true;
    parent.classList.remove('cd-open');
  }

  btn.addEventListener('click', () => {
    if (open) return close();
    open = true;
    showBubbles = true;
    sheet.hidden = false;
    parent.classList.add('cd-open');
    render();
    ensure(visible);
  });

  // A hit list card (e.g. a tapped pin or bubble) takes the bottom of the screen.
  new MutationObserver(() => {
    if (parent.classList.contains('hl-sheet-open') && open) close();
  }).observe(parent, { attributes: true, attributeFilter: ['class'] });

  hl.onVisibleChange((items) => {
    visible = items;
    if (showBubbles || open) ensure(visible);
    render();
  });

  // ---- Section on each pin card ----

  hl.addCardSection((item, el) => {
    if (item.lat == null || item.lng == null) return;
    el.className = 'cd-card';
    const cat = categoryOf(item.activity).id;
    const fill = () => {
      if (!el.isConnected) {
        refillCard = null;
        return;
      }
      const f = entryFor(item)?.forecast;
      if (!f) {
        el.innerHTML = `<h3>Conditions</h3>${
          loading ? '<p class="cd-muted">Getting the forecast…</p>' : `${error ? `<p class="cd-warn">${esc(error)}</p>` : ''}<button type="button" class="cd-get">${ICON_WEATHER} Show conditions</button>`
        }`;
        el.querySelector('.cd-get')?.addEventListener('click', () => ensure([item, ...visible.filter((v) => v.id !== item.id)]));
        return;
      }
      const days = daysOf(f, windowDays(), cat, item.faces);
      const rows = rowsFor(cat, days);
      const water = days.map((d) => d.water).filter((w): w is number => w != null);
      const notes: string[] = [];
      if (cat === 'surfing') {
        notes.push('Swell is model open-ocean swell in metres, not Surfline’s face height in feet.');
        if (item.faces == null) notes.push('Set which way the beach faces (Edit) to see onshore and offshore wind.');
        if (!f.marine) notes.push('No marine forecast for this spot.');
      }
      el.innerHTML = `<h3>Conditions</h3>
        ${windowChips()}
        ${water.length ? `<p class="cd-muted">Water about ${Math.round(water.reduce((a, b) => a + b, 0) / water.length)}°</p>` : ''}
        ${rows.length ? `<div class="cd-days">${rows
          .map(
            (r) => `<div class="cd-day ${r.verdict ? `cd-v-${r.verdict}` : ''}">${r.cells
              .filter(Boolean)
              .map((c, n) => `<span class="${n === 0 ? 'cd-day-name' : r.verdict && n === 1 ? 'cd-verdict' : ''}">${esc(c)}</span>`)
              .join('')}${r.extra ? `<small>${esc(r.extra)}</small>` : ''}</div>`,
          )
          .join('')}</div>` : '<p class="cd-muted">No forecast for these days yet.</p>'}
        ${notes.map((n) => `<p class="cd-muted">${esc(n)}</p>`).join('')}
        <p class="cd-muted">Open-Meteo, fetched ${ago(entryFor(item)!.at)}.</p>`;
      bindWindowChips(el);
    };
    refillCard = fill;
    fill();
    // Fetch for this place if it's not already there (cheap: one place, or the whole map's worth together).
    if (!entryFor(item) && !loading) ensure([item, ...visible.filter((v) => v.id !== item.id)]);
  });
}

import { regionOf, type AdventureMap } from '../map';
import type { HitListItem } from '../shared/types';
import { CATEGORIES, categoryOf } from '../hitlist/categories';
import type { ConditionsData } from './data';
import { PRESETS, distanceKm, distanceText, getHome, setHome, type Base } from './home';
import { searchPlaces, type PlaceMatch } from '../hitlist/geocode';
import { WINDOWS, daysFor, daysOf, rateWindow, verdictRank, VERDICT_WORD, dayShort, type Option, type WindowId } from './summary';

/**
 * The opening screen, in two steps. First "What do you feel like, when, and from where?" with a
 * "Show places" button; then every matching place ranked by its conditions, with a line on how
 * they change across the window. Tapping one flies to it; "Back" returns to the questions.
 * "Explore the map" closes it; the Plan button brings it back.
 */

const PREFS_KEY = 'adventure.planner';
/** How many places to list before "Show all". */
const SHORT_LIST = 12;

const ICON_EXPLORE =
  '<svg class="hl-icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="m592-127-243-86-188 75q-8 3-15 1.5t-13-5.5q-6-4-9.5-10t-3.5-14v-565q0-13 7.5-23t19.5-15l182-64q5-2 10-2.5t10-.5q5 0 10 .5t10 2.5l243 85 187-75q8-3 15-2t13 5q6 4 9.5 10.5T840-795v572q0 11-7.5 19T814-192l-182 65q-5 2-10 2.5t-10 .5q-5 0-10-.5t-10-2.5Zm-14-68v-505l-196-66v505l196 66Zm60 0 142-47v-512l-142 54v505Zm-458-12 142-54v-505l-142 47v512Zm458-493v505-505Zm-316-66v505-505Z"/></svg>';
const ICON_PLAN =
  '<svg class="hl-icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Zm-53 113 166-76q8-4 14-10t10-14l76-166q4-10-3-17t-17-3l-166 76q-8 4-14 10t-10 14l-76 166q-4 10 3 17t17 3Zm53-73q-17 0-28.5-11.5T440-480q0-17 11.5-28.5T480-520q17 0 28.5 11.5T520-480q0 17-11.5 28.5T480-440Z"/></svg>';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Prefs {
  activity: string;
  windowId: WindowId;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { activity: p.activity ?? '', windowId: WINDOWS.some((w) => w.id === p.windowId) ? p.windowId! : 'weekend' };
  } catch {
    return { activity: '', windowId: 'weekend' };
  }
}

export function mountPlanner(
  parent: HTMLElement,
  adv: AdventureMap,
  data: ConditionsData,
  go: (item: HitListItem, date: string | null) => void,
) {
  const prefs = loadPrefs();
  let items: HitListItem[] = [];
  let isOpen = false;
  let showAll = false;
  /** Two steps: the questions, then the ranked places. */
  let step: 'ask' | 'results' = 'ask';
  /** Where this search starts: home, unless changed for this search. */
  let from: Base | null = getHome();
  let editingFrom = !from;
  let makeHome = !from;
  let found: PlaceMatch[] = [];
  let searchMsg = '';

  const screen = document.createElement('section');
  screen.className = 'pl-screen';
  screen.hidden = true;
  screen.setAttribute('aria-label', 'Plan an adventure');

  const planBtn = document.createElement('button');
  planBtn.type = 'button';
  planBtn.className = 'pl-btn';
  planBtn.innerHTML = `${ICON_PLAN}<span>Plan</span>`;
  planBtn.addEventListener('click', () => open());
  parent.append(planBtn, screen);

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
  }

  function options(): { item: HitListItem; option: Option | null }[] {
    const dates = daysFor(prefs.windowId);
    const chosen = items.filter((i) => prefs.activity === 'any' || categoryOf(i.activity).id === prefs.activity);
    return chosen
      .map((item) => {
        const f = data.get(item);
        const cat = categoryOf(item.activity).id;
        return { item, option: f ? rateWindow(cat, daysOf(f, dates, cat, item.faces)) : null };
      })
      .sort((a, b) => {
        if (!a.option || !b.option) return a.option ? -1 : b.option ? 1 : 0;
        const dist = (i: HitListItem) => (from ? distanceKm(from, { lat: i.lat!, lng: i.lng! }) : 0);
        return verdictRank(a.option.verdict) - verdictRank(b.option.verdict) || dist(a.item) - dist(b.item) || b.option.goDays - a.option.goDays;
      });
  }

  function resultsHtml(): string {
    if (!prefs.activity) return '';
    if (!items.length) return '<p class="pl-muted">Your hit list is empty or still loading. Sign in with the account button if you haven’t.</p>';
    const list = options();
    if (!list.length) return `<p class="pl-muted">Nothing on your hit list for ${esc(categoryOf(prefs.activity).label.toLowerCase())} yet.</p>`;
    const status = data.loading
      ? `<p class="pl-muted pl-loading">Getting forecasts for ${items.length} places…</p>`
      : data.error
        ? `<p class="pl-warn">Couldn’t get all forecasts: ${esc(data.error)}. <button type="button" class="pl-link" data-act="retry">Try again</button></p>`
        : `<p class="pl-muted pl-updated">${data.fetchedAt(items) ? `Forecasts from ${new Date(data.fetchedAt(items)!).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''} <button type="button" class="pl-link" data-act="update">Update now</button></p>`;
    const goCount = list.filter((x) => x.option?.verdict === 'go').length;
    const lead = list[0]?.option
      ? `<p class="pl-summary">${goCount ? `${goCount} of ${list.length} places look good ${esc(WINDOWS.find((w) => w.id === prefs.windowId)!.short)}.` : `Nothing looks great ${esc(WINDOWS.find((w) => w.id === prefs.windowId)!.short)}. Best of the rest:`}</p>`
      : '';
    const shown = showAll ? list : list.slice(0, SHORT_LIST);
    const rows = shown
      .map(({ item, option }) => {
        const c = categoryOf(item.activity);
        const where = [regionOf(item.lat!, item.lng!) ?? '', from ? `${distanceText(distanceKm(from, { lat: item.lat!, lng: item.lng! }))} from ${from.name}` : ''].filter(Boolean).join(' · ');
        const strip = option && option.strip.length > 1
          ? `<span class="pl-strip">${option.strip.map((s) => `<i class="pl-v-${s.verdict}" title="${dayShort(s.date)}: ${VERDICT_WORD[s.verdict]}"></i>`).join('')}</span>`
          : '';
        return `<button type="button" class="pl-row ${option ? `pl-v-${option.verdict}` : ''}" data-id="${item.id}" style="--pin:${c.color}">
          <span class="pl-row-icon">${c.icon}</span>
          <span class="pl-row-main"><b>${esc(item.name)}</b>${where ? `<small>${esc(where)}</small>` : ''}
          <span class="pl-row-head">${option ? esc(option.headline) : data.loading ? 'Loading…' : 'No forecast'}</span>
          ${option?.detail ? `<span class="pl-row-detail">${esc(option.detail)}</span>` : ''}${strip}</span>
        </button>`;
      })
      .join('');
    const more = !showAll && list.length > SHORT_LIST ? `<button type="button" class="pl-more" data-act="all">Show all ${list.length}</button>` : '';
    return `${status}${lead}<div class="pl-results">${rows}</div>${more}
      <p class="pl-muted pl-foot">Forecasts from Open-Meteo, one per area of about 25 km, refreshed every 3 hours. Distances are straight-line. Surf swell is model open-ocean swell in metres, not Surfline’s face height. Ratings are a first rough pass.</p>`;
  }

  function fromHtml(): string {
    const home = getHome();
    if (!editingFrom && from) {
      const isHome = home && home.name === from.name && home.lat === from.lat;
      return `<p class="pl-from">From <b>${esc(from.name)}</b>${isHome ? ' <span class="pl-muted">(home)</span>' : ''} <button type="button" class="pl-link" data-act="change-from">Change</button></p>`;
    }
    return `<div class="pl-from-edit">
      <p class="pl-q">${home ? 'Starting from?' : 'Where’s home? It’s saved on this phone.'}</p>
      <div class="pl-when">${PRESETS.map((b, n) => `<button type="button" data-preset="${n}" class="${from?.name === b.name ? 'on' : ''}">${esc(b.name)}</button>`).join('')}</div>
      <form class="pl-search"><input name="q" type="search" placeholder="Or search a town" enterkeyhint="search" /><button type="submit">Search</button></form>
      ${found.map((r, n) => `<button type="button" class="pl-found" data-found="${n}"><b>${esc(r.name)}</b><small>${esc(r.detail)}</small></button>`).join('')}
      ${searchMsg ? `<p class="pl-muted">${esc(searchMsg)}</p>` : ''}
      ${home ? `<label class="pl-check"><input type="checkbox" data-act="make-home" ${makeHome ? 'checked' : ''} /> Make this my home</label>` : ''}
      ${home ? '<button type="button" class="pl-link" data-act="cancel-from">Cancel</button>' : ''}
    </div>`;
  }

  function chooseFrom(b: Base) {
    from = b;
    if (makeHome || !getHome()) setHome(b);
    editingFrom = false;
    found = [];
    searchMsg = '';
    render();
  }

  function render() {
    if (!isOpen) return;
    const scroll = screen.querySelector('.pl-body')?.scrollTop ?? 0;
    const actLabel = prefs.activity === 'any' ? 'Anything' : prefs.activity ? categoryOf(prefs.activity).label : '';
    const win = WINDOWS.find((w) => w.id === prefs.windowId)!;
    const blocker = !prefs.activity ? 'Pick an activity' : !from || editingFrom ? 'Pick where you’re starting from' : '';
    if (step === 'results' && blocker) step = 'ask';
    screen.innerHTML =
      step === 'ask'
        ? `<div class="pl-body pl-ask">
      <div class="pl-top"><h2>Where to?</h2><button type="button" class="pl-explore" data-act="explore">${ICON_EXPLORE}<span>Explore the map</span></button></div>
      <p class="pl-q">What do you feel like?</p>
      <div class="pl-acts">
        ${CATEGORIES.filter((c) => c.id !== 'other').map((c) => `<button type="button" data-act-id="${c.id}" class="${prefs.activity === c.id ? 'on' : ''}" style="--pin:${c.color}">${c.icon}<span>${esc(c.label)}</span></button>`).join('')}
        <button type="button" data-act-id="any" class="pl-any ${prefs.activity === 'any' ? 'on' : ''}"><span>Anything</span></button>
      </div>
      <p class="pl-q">When?</p>
      <div class="pl-when">${WINDOWS.map((w) => `<button type="button" data-win="${w.id}" class="${w.id === prefs.windowId ? 'on' : ''}">${w.label}</button>`).join('')}</div>
      ${fromHtml()}
      <div class="pl-foot-bar"><button type="button" class="pl-go" data-act="show" ${blocker ? 'disabled' : ''}>${blocker || 'Show places'}</button></div>
    </div>`
        : `<div class="pl-body">
      <div class="pl-top"><button type="button" class="pl-back" data-act="back" aria-label="Back to the questions">‹</button><h2 class="pl-title">${esc(actLabel)}<small>${esc(win.label)} · from ${esc(from!.name)}</small></h2><button type="button" class="pl-explore" data-act="explore">${ICON_EXPLORE}<span>Map</span></button></div>
      ${resultsHtml()}
    </div>`;
    screen.querySelector<HTMLElement>('.pl-body')!.scrollTop = scroll;
    screen.querySelector('[data-act="explore"]')!.addEventListener('click', close);
    screen.querySelector('[data-act="show"]')?.addEventListener('click', () => {
      step = 'results';
      showAll = false;
      screen.querySelector<HTMLElement>('.pl-body')!.scrollTop = 0;
      render();
      screen.querySelector<HTMLElement>('.pl-body')!.scrollTop = 0;
    });
    screen.querySelector('[data-act="back"]')?.addEventListener('click', () => {
      step = 'ask';
      render();
      screen.querySelector<HTMLElement>('.pl-body')!.scrollTop = 0;
    });
    screen.querySelectorAll<HTMLButtonElement>('[data-act-id]').forEach((b) =>
      b.addEventListener('click', () => {
        prefs.activity = b.dataset.actId!;
        showAll = false;
        savePrefs();
        render();
      }),
    );
    screen.querySelectorAll<HTMLButtonElement>('[data-win]').forEach((b) =>
      b.addEventListener('click', () => {
        prefs.windowId = b.dataset.win as WindowId;
        savePrefs();
        render();
      }),
    );
    screen.querySelector('[data-act="update"]')?.addEventListener('click', () => data.ensure(items, true));
    screen.querySelector('[data-act="change-from"]')?.addEventListener('click', () => {
      editingFrom = true;
      makeHome = false;
      render();
    });
    screen.querySelector('[data-act="cancel-from"]')?.addEventListener('click', () => {
      editingFrom = false;
      found = [];
      render();
    });
    screen.querySelector<HTMLInputElement>('[data-act="make-home"]')?.addEventListener('change', (e) => (makeHome = (e.target as HTMLInputElement).checked));
    screen.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => chooseFrom(PRESETS[Number(b.dataset.preset)])));
    screen.querySelectorAll<HTMLButtonElement>('[data-found]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = found[Number(b.dataset.found)];
        chooseFrom({ name: r.name, lat: r.lat, lng: r.lng });
      }),
    );
    const form = screen.querySelector<HTMLFormElement>('.pl-search');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = String(new FormData(form).get('q')).trim();
      if (!q) return;
      searchMsg = 'Searching…';
      render();
      try {
        found = await searchPlaces(q);
        searchMsg = found.length ? '' : 'No matches. Try a nearby town.';
      } catch (err) {
        searchMsg = err instanceof Error ? err.message : String(err);
      }
      render();
    });
    screen.querySelector('[data-act="retry"]')?.addEventListener('click', () => data.ensure(items, true));
    screen.querySelector('[data-act="all"]')?.addEventListener('click', () => {
      showAll = true;
      render();
    });
    screen.querySelectorAll<HTMLButtonElement>('.pl-row').forEach((row) =>
      row.addEventListener('click', () => {
        const item = items.find((i) => i.id === row.dataset.id)!;
        const opt = options().find((o) => o.item.id === item.id)?.option;
        close();
        go(item, opt?.bestDate ?? null);
      }),
    );
  }

  function open() {
    isOpen = true;
    screen.hidden = false;
    parent.classList.add('pl-open');
    render();
  }

  function close() {
    isOpen = false;
    screen.hidden = true;
    parent.classList.remove('pl-open');
    adv.map.resize();
  }

  data.onChange(render);

  return {
    open,
    setItems(next: HitListItem[]) {
      items = next;
      render();
    },
  };
}

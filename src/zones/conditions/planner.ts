import { regionOf, type AdventureMap } from '../map';
import type { HitListItem } from '../shared/types';
import { CATEGORIES, categoryOf } from '../hitlist/categories';
import type { ConditionsData } from './data';
import { PRESETS, getHome, setHome, type Base } from './home';
import { ensureDrives, onDriveChange, travelMinutes, travelText } from './drive';
import { searchPlaces, type PlaceMatch } from '../hitlist/geocode';
import { onTab, showTab } from '../shared/tabs';
import { WINDOWS, daysFor, daysOf, rateWindow, verdictRank, VERDICT_WORD, dayShort, type Option, type WindowId } from './summary';

/**
 * The opening screen, in two steps. First "What do you feel like, when, and from where?" with a
 * "Show places" button; then every matching place ranked by its conditions, with a line on how
 * they change across the window. Tapping one switches to the Map tab and flies to it; "Back" returns
 * to the questions. It is the Plan tab: the other tabs close it.
 */

const PREFS_KEY = 'adventure.planner';
/** How many places to list before "Show all". */
const SHORT_LIST = 12;

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Prefs {
  activity: string;
  windowId: WindowId;
  /** Longest drive from the start point, in hours (1 to 8), or null for Australia-wide. */
  radius: number | null;
}

/** The drive radius slider runs 1 to 8 hours, and one more step past 8 means Australia-wide. */
const RADIUS_MAX = 8;
const radiusText = (r: number | null) => (r == null ? 'Australia-wide' : `Up to ${r} h drive`);

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    const radius = typeof p.radius === 'number' && p.radius >= 1 && p.radius <= RADIUS_MAX ? Math.round(p.radius) : null;
    return { activity: p.activity ?? '', windowId: WINDOWS.some((w) => w.id === p.windowId) ? p.windowId! : 'weekend', radius };
  } catch {
    return { activity: '', windowId: 'weekend', radius: null };
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

  parent.append(screen);
  onTab((tab) => (tab === 'plan' ? open() : isOpen && close()));

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
  }

  /** Places of the chosen activity, before the drive radius. */
  function ofActivity(): HitListItem[] {
    return items.filter((i) => prefs.activity === 'any' || categoryOf(i.activity).id === prefs.activity);
  }

  /** Inside the drive radius from the start point. Uses the road time when known, otherwise an estimate. */
  function inRadius(i: HitListItem): boolean {
    if (prefs.radius == null || !from || i.lat == null || i.lng == null) return true;
    return travelMinutes(from, { lat: i.lat, lng: i.lng }) <= prefs.radius * 60;
  }

  function options(): { item: HitListItem; option: Option | null }[] {
    const dates = daysFor(prefs.windowId);
    const chosen = ofActivity().filter(inRadius);
    return chosen
      .map((item) => {
        const f = data.get(item);
        const cat = categoryOf(item.activity).id;
        let option: Option | null = null;
        try {
          if (f) option = rateWindow(cat, daysOf(f, dates, cat, item.faces));
        } catch (err) {
          console.error('Conditions for', item.name, err); // one odd forecast shouldn't break the whole list
        }
        return { item, option };
      })
      .sort((a, b) => {
        if (!a.option || !b.option) return a.option ? -1 : b.option ? 1 : 0;
        const dist = (i: HitListItem) => (from ? travelMinutes(from, { lat: i.lat!, lng: i.lng! }) : 0);
        return verdictRank(a.option.verdict) - verdictRank(b.option.verdict) || dist(a.item) - dist(b.item) || b.option.goDays - a.option.goDays;
      });
  }

  function resultsHtml(): string {
    if (!prefs.activity) return '';
    if (!items.length) return '<p class="pl-muted">Your hit list is empty or still loading. Sign in with the account button if you haven’t.</p>';
    const list = options();
    const outside = ofActivity().length - list.length;
    const actWord = prefs.activity === 'any' ? 'anything' : categoryOf(prefs.activity).label.toLowerCase();
    if (!list.length && outside > 0)
      return `<p class="pl-muted">Nothing for ${esc(actWord)} within ${prefs.radius} h of ${esc(from!.name)}. ${outside} place${outside === 1 ? ' is' : 's are'} further away. <button type="button" class="pl-link" data-act="no-radius">Show Australia-wide</button></p>`;
    if (!list.length) return `<p class="pl-muted">Nothing on your hit list for ${esc(actWord)} yet.</p>`;
    const status = data.loading
      ? `<p class="pl-muted pl-loading">Getting forecasts for ${items.length} places…</p>`
      : data.error
        ? `<p class="pl-warn">Couldn’t get all forecasts: ${esc(data.error)}. <button type="button" class="pl-link" data-act="retry">Try again</button></p>`
        : `<p class="pl-muted pl-updated">${data.fetchedAt(items) ? `Forecasts from ${new Date(data.fetchedAt(items)!).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''} <button type="button" class="pl-link" data-act="update">Update now</button></p>`;
    const win = WINDOWS.find((w) => w.id === prefs.windowId)!;
    const goCount = list.filter((x) => x.option?.verdict === 'go').length;
    const km = (i: HitListItem) => (from ? travelText(from, { lat: i.lat!, lng: i.lng! }) : '');
    /** "Go Sat" for the pill, and the rest ("6–9am · 1.1 m 8 s SSE · offshore") for the line under the name. */
    const split = (o: Option) => {
      const [first, ...rest] = o.headline.split(' · ');
      const poor = o.verdict === 'skip' || o.verdict === 'na';
      if (poor) return { pill: VERDICT_WORD[o.verdict], line: first };
      // "Go Fri 5am–12pm": the verdict and day go in the pill, the hours start the line.
      const words = first.split(' ');
      const hours = words.slice(2).join(' ');
      return { pill: words.slice(0, 2).join(' '), line: [hours, ...rest].filter(Boolean).join(' · ') };
    };
    const strip = (o: Option | null) =>
      o && o.strip.length > 1 ? `<span class="pl-strip">${o.strip.map((x) => `<i class="pl-v-${x.verdict}" title="${dayShort(x.date)}: ${VERDICT_WORD[x.verdict]}"></i>`).join('')}</span>` : '';

    // The best pick leads: the top of the ranking (best rating, then nearest), if it's better than skip.
    const top = list[0];
    const hasBest = !!top?.option && (top.option.verdict === 'go' || top.option.verdict === 'mar');
    let hero = '';
    if (hasBest) {
      const { item, option } = top;
      const o = option!;
      const c = categoryOf(item.activity);
      const { pill, line } = split(o);
      const days =
        o.strip.length > 1 && o.strip.length <= 7
          ? `<span class="pl-days">${o.strip.map((x) => `<span class="pl-v-${x.verdict}">${dayShort(x.date)}</span>`).join('')}</span>`
          : strip(o);
      hero = `<p class="pl-eyebrow">Best ${esc(win.short)}</p>
        <button type="button" class="pl-hero pl-row-btn" data-id="${item.id}" style="--pin:${c.color}">
          <span class="pl-hero-head"><span class="pl-row-icon">${c.icon}</span>
          <span class="pl-row-main"><b>${esc(item.name)}</b><small>${esc([regionOf(item.lat!, item.lng!), km(item) && `${km(item)} from ${from!.name}`].filter(Boolean).join(' · '))}</small></span></span>
          <span class="pl-pill pl-v-${o.verdict}">${esc(pill)}</span>
          ${line ? `<span class="pl-hero-line">${esc(line)}</span>` : ''}
          ${days}
        </button>`;
    }
    const rest = hasBest ? list.slice(1) : list;
    const shown = showAll ? rest : rest.slice(0, SHORT_LIST);
    const moreGood = goCount - (top?.option?.verdict === 'go' ? 1 : 0);
    const heading = hasBest
      ? `<p class="pl-eyebrow pl-rest-head">${moreGood > 0 ? `${moreGood} more ${moreGood === 1 ? 'looks' : 'look'} good` : 'The rest'}</p>`
      : `<p class="pl-summary">Nothing looks good ${esc(win.short)}.</p>`;
    const rows = shown
      .map(({ item, option }) => {
        const c = categoryOf(item.activity);
        const s = option ? split(option) : null;
        const sub = [km(item), s?.line || (option ? '' : data.loading ? 'Loading…' : 'No forecast')].filter(Boolean).join(' · ');
        return `<button type="button" class="pl-row pl-row-btn" data-id="${item.id}" style="--pin:${c.color}">
          <span class="pl-row-icon">${c.icon}</span>
          <span class="pl-row-main"><b>${esc(item.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${strip(option)}</span>
          ${option ? `<span class="pl-pill pl-v-${option.verdict}">${VERDICT_WORD[option.verdict]}</span>` : ''}
        </button>`;
      })
      .join('');
    const more = !showAll && rest.length > SHORT_LIST ? `<button type="button" class="pl-more" data-act="all">Show all ${rest.length}</button>` : '';
    // While loading (or after an error) the status leads; otherwise it sits quietly under the list.
    const busy = data.loading || !!data.error;
    const outsideNote = outside > 0 ? `<p class="pl-muted">${outside} more place${outside === 1 ? ' is' : 's are'} over ${prefs.radius} h away. <button type="button" class="pl-link" data-act="no-radius">Show Australia-wide</button></p>` : '';
    return `${busy ? status : ''}${hero}${rest.length ? heading : ''}<div class="pl-results">${rows}</div>${more}${outsideNote}${busy ? '' : status}
      <p class="pl-muted pl-foot">Forecasts from Open-Meteo, one per area of about 25 km, refreshed every 3 hours. Drive times are by road (OpenStreetMap, via OSRM), without traffic; a km figure means the drive time isn’t in yet. Surf swell is model open-ocean swell in metres, not Surfline’s face height. Ratings are a first rough pass.</p>`;
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
    if (step === 'results' && from) void ensureDrives(from, items);
    screen.innerHTML =
      step === 'ask'
        ? `<div class="pl-body pl-ask">
      <div class="pl-top"><h2>Where to?</h2></div>
      <p class="pl-q">What do you feel like?</p>
      <div class="pl-acts">
        ${CATEGORIES.filter((c) => c.id !== 'other').map((c) => `<button type="button" data-act-id="${c.id}" class="${prefs.activity === c.id ? 'on' : ''}" style="--pin:${c.color}">${c.icon}<span>${esc(c.label)}</span></button>`).join('')}
        <button type="button" data-act-id="any" class="pl-any ${prefs.activity === 'any' ? 'on' : ''}"><span>Anything</span></button>
      </div>
      <p class="pl-q">When?</p>
      <div class="pl-when">${WINDOWS.map((w) => `<button type="button" data-win="${w.id}" class="${w.id === prefs.windowId ? 'on' : ''}">${w.label}</button>`).join('')}</div>
      ${fromHtml()}
      <p class="pl-q">Drive radius${from ? ` from ${esc(from.name)}` : ''}</p>
      <div class="pl-radius">
        <input type="range" min="1" max="${RADIUS_MAX + 1}" step="1" value="${prefs.radius ?? RADIUS_MAX + 1}" aria-label="Drive radius in hours" />
        <output>${radiusText(prefs.radius)}</output>
        <div class="pl-radius-scale" aria-hidden="true"><span>1 h</span><span>8 h</span><span>All</span></div>
      </div>
      <div class="pl-foot-bar"><button type="button" class="pl-go" data-act="show" ${blocker ? 'disabled' : ''}>${blocker || 'Show places'}</button></div>
    </div>`
        : `<div class="pl-body">
      <div class="pl-top"><button type="button" class="pl-back" data-act="back" aria-label="Back to the questions">‹</button><h2 class="pl-title">${esc(actLabel)}<small>${esc(win.label)} · ${prefs.radius == null ? `from ${esc(from!.name)}` : `within ${prefs.radius} h of ${esc(from!.name)}`}</small></h2></div>
      ${resultsHtml()}
    </div>`;
    screen.querySelector<HTMLElement>('.pl-body')!.scrollTop = scroll;
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
    const range = screen.querySelector<HTMLInputElement>('.pl-radius input');
    range?.addEventListener('input', () => {
      const v = Number(range.value);
      prefs.radius = v > RADIUS_MAX ? null : v;
      screen.querySelector('.pl-radius output')!.textContent = radiusText(prefs.radius);
    });
    range?.addEventListener('change', savePrefs);
    screen.querySelector('[data-act="no-radius"]')?.addEventListener('click', () => {
      prefs.radius = null;
      savePrefs();
      render();
    });
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
    screen.querySelectorAll<HTMLButtonElement>('.pl-row-btn').forEach((row) =>
      row.addEventListener('click', () => {
        const item = items.find((i) => i.id === row.dataset.id)!;
        const opt = options().find((o) => o.item.id === item.id)?.option;
        showTab('map');
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
  onDriveChange(render);

  return {
    setItems(next: HitListItem[]) {
      items = next;
      render();
    },
  };
}

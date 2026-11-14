import './campsites.css';
import { inRegion, type AdventureMap } from '../map';
import type { HitListItem } from '../shared/types';
import { supabase } from '../shared/supabase';
import { ICONS } from '../hitlist/icons';

/**
 * "Any free campsites?" button and panel.
 *
 * Free nights come from campsites.json on the `campsite-data` branch, written every 6 hours by
 * .github/workflows/campsites.yml (scripts/campsites/check.py). The panel matches those results to
 * the camping items on the hit list by their park link.
 */

const DATA_URL = 'https://raw.githubusercontent.com/samclagett/adventure/campsite-data/campsites.json';
/** Where to run the check by hand: the workflow's page in the Actions tab. */
const RUN_URL = 'https://github.com/samclagett/adventure/actions/workflows/campsites.yml';

interface CampgroundResult {
  link: string;
  /** ISO dates (YYYY-MM-DD) with at least one site free that night. */
  free_nights: string[];
  error: string | null;
}
interface CampsiteData {
  checked_at: string;
  campgrounds: CampgroundResult[];
}

type Window = 'weekend' | 'week' | '2weeks';
const WINDOWS: { id: Window; label: string }[] = [
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'Next week' },
  { id: '2weeks', label: 'Next 2 weeks' },
];

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Local date as YYYY-MM-DD. */
function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * The nights (as ISO dates) a window covers, starting tonight.
 * "This weekend" is Friday, Saturday and Sunday night; from Friday on it's the rest of this weekend.
 */
export function nightsFor(w: Window, today = new Date()): string[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (w === 'weekend') {
    const day = start.getDay(); // 0 Sun … 6 Sat
    const fri = day === 6 ? addDays(start, -1) : day === 0 ? addDays(start, -2) : addDays(start, 5 - day);
    return [0, 1, 2].map((i) => addDays(fri, i)).filter((d) => d >= start).map(iso);
  }
  const n = w === 'week' ? 7 : 14;
  return Array.from({ length: n }, (_, i) => iso(addDays(start, i)));
}

function nightLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseIso(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A Monday-to-Sunday calendar of the window's nights for one campground.
 * Free nights are green, booked nights are dim, and Saturday and Sunday columns are shaded as the weekend.
 */
function weekCalendar(nights: string[], freeNights: Set<string>): string {
  // Blank cells before the first night so it lines up under the right weekday.
  const lead = (parseIso(nights[0]).getDay() + 6) % 7;
  const cells: string[] = Array.from({ length: lead }, (_, i) => `<span class="cs-day cs-pad ${i >= 5 ? 'cs-we' : ''}"></span>`);
  for (const n of nights) {
    const d = parseIso(n);
    const col = (d.getDay() + 6) % 7;
    const free = freeNights.has(n);
    const label = `${d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}: ${free ? 'free' : 'booked'}`;
    cells.push(`<span class="cs-day ${col >= 5 ? 'cs-we' : ''} ${free ? 'cs-free' : 'cs-booked'}" title="${label}" aria-label="${label}">${d.getDate()}</span>`);
  }
  const head = WEEKDAYS.map((w, i) => `<span class="cs-dow ${i >= 5 ? 'cs-we' : ''}">${w[0]}</span>`).join('');
  return `<div class="cs-cal" role="img" aria-label="Free nights calendar">${head}${cells.join('')}</div>`;
}

function ago(when: string): string {
  const mins = Math.round((Date.now() - new Date(when).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const isNsw = (link: string | null) => !!link && link.startsWith('https://www.nationalparks.nsw.gov.au/camping-and-accommodation/campgrounds/');

export function mountCampsites(parent: HTMLElement, adv: AdventureMap) {
  let windowId: Window = 'weekend';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-btn';
  btn.innerHTML = `${ICONS.camping} Any free campsites?`;

  const sheet = document.createElement('section');
  sheet.className = 'cs-sheet';
  sheet.hidden = true;
  parent.append(btn, sheet);

  let open = false;
  let lastItems: HitListItem[] = [];
  let lastData: CampsiteData | null = null;

  function close() {
    open = false;
    sheet.hidden = true;
    parent.classList.remove('cs-open');
  }

  function show(html: string) {
    open = true;
    sheet.innerHTML = `<button type="button" class="cs-close" aria-label="Close">✕</button><div class="cs-body">${html}</div>`;
    sheet.hidden = false;
    parent.classList.add('cs-open');
    sheet.querySelector('.cs-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });
  }

  // If a hit list card opens (e.g. a pin is tapped), step out of its way.
  new MutationObserver(() => {
    if (parent.classList.contains('hl-sheet-open') && !sheet.hidden) close();
  }).observe(parent, { attributes: true, attributeFilter: ['class'] });

  async function loadCamping(): Promise<HitListItem[] | string> {
    if (!supabase) return 'Supabase isn’t set up yet (see SETUP.md).';
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return 'Sign in first: tap the account button at the top right and use the shared login.';
    const { data, error } = await supabase.from('hit_list').select('*').eq('activity', 'camping').order('name');
    if (error) return `Couldn’t load the hit list: ${esc(error.message)}`;
    return data as HitListItem[];
  }

  async function loadResults(): Promise<CampsiteData | null> {
    try {
      const r = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      return r.ok ? ((await r.json()) as CampsiteData) : null;
    } catch {
      return null;
    }
  }

  function render(allItems: HitListItem[], data: CampsiteData | null) {
    lastItems = allItems;
    lastData = data;
    // Only the camping spots in the region picked at the bottom (NSW, VIC, TAS or all of Australia).
    const region = adv.getRegion();
    const items = allItems.filter((i) => i.lat == null || i.lng == null || inRegion(i.lat, i.lng, region));
    const where = region === 'AUS' ? '' : ` in ${region}`;
    const nights = nightsFor(windowId);
    const calendar = windowId === 'week' || windowId === '2weeks';
    const byLink = new Map((data?.campgrounds ?? []).map((c) => [c.link, c]));

    const rows = items.map((item) => {
      const res = item.link ? byLink.get(item.link) : undefined;
      const free = res ? nights.filter((n) => res.free_nights.includes(n)) : [];
      let status: string;
      let rank: number;
      if (!isNsw(item.link)) {
        status = '<span class="cs-muted">Not checked automatically. Check on the park’s booking page.</span>';
        rank = 3;
      } else if (!res) {
        status = '<span class="cs-muted">Not checked yet. It’s included in the next check.</span>';
        rank = 2;
      } else if (res.error) {
        status = `<span class="cs-warn">Couldn’t check this one last time.</span>`;
        rank = 2;
      } else if (calendar) {
        status = weekCalendar(nights, new Set(res.free_nights));
        rank = free.length ? 0 : 1;
      } else if (free.length) {
        const shown = free.slice(0, 6).map((n) => `<span class="cs-night">${nightLabel(n)}</span>`).join('');
        const more = free.length > 6 ? `<span class="cs-muted">+${free.length - 6} more</span>` : '';
        const all = free.length === nights.length && nights.length > 2 ? '<span class="cs-muted">Every night free</span>' : '';
        status = all || `<span class="cs-nights">${shown}${more}</span>`;
        rank = 0;
      } else {
        status = '<span class="cs-full">Booked out</span>';
        rank = 1;
      }
      const book = item.link ? `<a class="cs-book" href="${esc(item.link)}" target="_blank" rel="noopener">Book</a>` : '';
      return {
        rank,
        free: free.length,
        html: `<div class="cs-row ${rank === 0 ? 'cs-has-free' : ''}">
          <button type="button" class="cs-name" data-id="${item.id}">${esc(item.name)}</button>${book}
          <div class="cs-status">${status}</div>
        </div>`,
      };
    });
    rows.sort((a, b) => a.rank - b.rank || b.free - a.free);
    const freeCount = rows.filter((r) => r.rank === 0).length;

    const picker = `<div class="cs-windows" role="tablist">${WINDOWS.map(
      (w) => `<button type="button" role="tab" data-w="${w.id}" class="${w.id === windowId ? 'on' : ''}">${w.label}</button>`,
    ).join('')}</div>`;
    const summary = !allItems.length
      ? 'No camping spots on the hit list yet. Add one with the <b>+</b> button and pick Camping.'
      : !items.length
        ? `No camping spots on the hit list${where}. Pick another region at the bottom.`
        : freeCount
          ? `${freeCount} of ${items.length} camping spot${items.length === 1 ? '' : 's'}${where} ${freeCount === 1 ? 'has' : 'have'} a free night.`
          : `Nothing free${where} in these dates.`;
    const legend = calendar ? '<p class="cs-legend"><span class="cs-key cs-free"></span>Free <span class="cs-key cs-booked"></span>Booked <span class="cs-key cs-we-key"></span>Weekend</p>' : '';
    const checked = data
      ? `Checked ${ago(data.checked_at)}. <a href="${RUN_URL}" target="_blank" rel="noopener">Check again now</a>`
      : `No check has run yet. <a href="${RUN_URL}" target="_blank" rel="noopener">Run the first check</a>`;

    show(`
      <h2>Any free campsites?</h2>
      ${picker}
      <p>${summary}</p>
      ${legend}
      ${rows.map((r) => r.html).join('')}
      <p class="cs-muted cs-foot">${checked}<br />A night counts as free when at least one site is open. Cancellations go fast, so book soon. NSW National Parks only for now.</p>
    `);

    sheet.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) =>
      b.addEventListener('click', () => {
        windowId = b.dataset.w as Window;
        render(allItems, data);
      }),
    );
    sheet.querySelectorAll<HTMLButtonElement>('.cs-name').forEach((b) =>
      b.addEventListener('click', () => {
        const item = items.find((i) => i.id === b.dataset.id);
        if (item?.lat == null) return;
        const covered = sheet.offsetHeight;
        adv.map.flyTo({ center: [item.lng!, item.lat], zoom: Math.max(adv.map.getZoom(), 11), offset: [0, -covered / 2], duration: 1500, essential: true });
      }),
    );
  }

  // Picking another region while the panel is open updates it.
  adv.onRegionChange(() => {
    if (open && lastItems.length) render(lastItems, lastData);
  });

  btn.addEventListener('click', async () => {
    show('<h2>Any free campsites?</h2><p class="cs-muted">Looking…</p>');
    const [items, data] = await Promise.all([loadCamping(), loadResults()]);
    if (typeof items === 'string') show(`<h2>Any free campsites?</h2><p class="cs-muted">${items}</p>`);
    else render(items, data);
  });
}

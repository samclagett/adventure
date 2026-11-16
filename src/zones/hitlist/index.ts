import './hitlist.css';
import type { MapMouseEvent } from 'maplibre-gl';
import { inRegion, type AdventureMap } from '../map';
import { supabase } from '../shared/supabase';
import type { HitListItem } from '../shared/types';
import { CATEGORIES, categoryOf } from './categories';
import { ICONS } from './icons';
import { Pins } from './pins';
import * as store from './store';
import { searchPlaces, type PlaceMatch } from './geocode';
import { parseLocationText } from './gmaps';
import { currentTab, onTab, setTabBadge, showTab } from '../shared/tabs';
import { makeDraggable, type Snap } from '../shared/sheet';
import { regionOf } from '../map';
import * as done from './done';
import type { DoneTrip } from './done';

/** What the add/edit form is working on. `id` is set when editing an existing item. */
interface Draft {
  id?: string;
  activity: string;
  name: string;
  notes: string;
  link: string;
  lat: number | null;
  lng: number | null;
  /** Which way a beach faces (degrees), for surf spots. */
  faces: number | null;
  /** Where the location came from, e.g. a search result's name or "Dropped pin". */
  where: string;
}

type LocTab = 'search' | 'map' | 'link';

/** Escape user text before putting it into HTML. */
function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fmt(n: number) {
  return n.toFixed(5);
}

/** The 8 compass points a beach can face, for the surf spot form. */
const FACINGS: [string, number][] = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg: number) => COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
/** Categories whose form asks which way the beach faces. */
const HAS_FACING = new Set(['surfing']);

/** What other zones can do with the hit list (see main.ts). */
export interface HitListApi {
  reload(): Promise<void>;
  /** Called with the located items shown on the map, whenever that changes (region, filter, edits). */
  onVisibleChange(cb: (items: HitListItem[]) => void): void;
  /** Called with every located item on the hit list (any region or category), whenever that changes. */
  onItemsChange(cb: (items: HitListItem[]) => void): void;
  /** Open an item's card (and fly to it). */
  openItem(id: string): void;
  /** True while an item's pin is folded into a numbered group on the map (zoomed out). */
  isGrouped(id: string): boolean;
  /** Called whenever pins are grouped or ungrouped (after zooming). */
  onGroupsChange(cb: () => void): void;
  /** Add a section to every pin card. `fill` is called with the card's empty section element. */
  addCardSection(fill: (item: HitListItem, el: HTMLElement) => void): void;
  /** Fill the short summary at the top of each place card (shown while the card is pulled down). */
  addCardSummary(fill: (item: HitListItem, el: HTMLElement) => void): void;
}

/**
 * The hit list: pins on the map, and a bottom sheet for the list (with the category filter at its top),
 * adding, viewing, editing and deleting adventures. Data is saved in Supabase (`hit_list`).
 */
export function mountHitList(parent: HTMLElement, adv: AdventureMap): HitListApi {
  const map = adv.map;
  let items: HitListItem[] = [];
  let signedIn = false;
  let loadError = '';
  /** Categories shown on the map and in the list. Empty means all. */
  const filter = new Set<string>();
  let draft: Draft | null = null;
  let locTab: LocTab = 'search';
  let results: PlaceMatch[] = [];
  let picking = false;
  let view: 'list' | 'other' | null = null;
  const visibleListeners: ((items: HitListItem[]) => void)[] = [];
  const itemsListeners: ((items: HitListItem[]) => void)[] = [];
  const located = () => items.filter((i) => i.lat != null && i.lng != null);
  const cardSections: ((item: HitListItem, el: HTMLElement) => void)[] = [];
  const cardSummaries: ((item: HitListItem, el: HTMLElement) => void)[] = [];
  /** The Done list (done.ts): every visit, newest first. */
  let trips: DoneTrip[] = [];
  /** Which half of the Hit list sheet is showing. */
  let listMode: 'todo' | 'done' = 'todo';

  // ---- Sheet and banner ----
  // The Hit list tab opens the list (category filters at its top, and the Add button).
  // Pressing and holding on the map also adds an adventure there.
  const sheet = document.createElement('section');
  sheet.className = 'hl-sheet';
  sheet.hidden = true;

  const banner = document.createElement('div');
  banner.className = 'hl-banner';
  banner.hidden = true;
  banner.innerHTML = `<span>Tap the map where it is. Drag the pin to fine-tune.</span><button type="button">Cancel</button>`;

  parent.append(sheet, banner);

  const pins = new Pins(map, (item) => openCard(item));
  const groupListeners: (() => void)[] = [];
  pins.onGroupsChange = () => groupListeners.forEach((cb) => cb());

  /** Items in the selected region (NSW, VIC, TAS or all of Australia). Unlocated items always count. */
  function regionItems() {
    const region = adv.getRegion();
    return items.filter((i) => i.lat == null || i.lng == null || inRegion(i.lat, i.lng, region));
  }

  function visibleItems() {
    return regionItems().filter((i) => filter.size === 0 || filter.has(categoryOf(i.activity).id));
  }

  function refresh() {
    const shown = visibleItems();
    pins.show(shown);
    const shownLocated = shown.filter((i) => i.lat != null && i.lng != null);
    visibleListeners.forEach((cb) => cb(shownLocated));
    itemsListeners.forEach((cb) => cb(located()));
    // Names beside the pins only while some categories are picked, so the map stays tidy otherwise.
    map.getContainer().classList.toggle('hl-show-names', filter.size > 0);
    // Badge on the Hit list tab: how many categories are picked, or a dot while some adventures still need a pin.
    const toLocate = items.filter((i) => i.lat == null).length;
    if (filter.size) setTabBadge('list', String(filter.size), `${filter.size} categories picked`);
    else if (toLocate) setTabBadge('list', '', `${toLocate} to locate`);
    else setTabBadge('list', null);
    if (view === 'list') openList();
  }

  adv.onRegionChange(() => refresh());

  // ---- Bottom sheet ----

  /**
   * Draw the sheet. `kind` names what it shows ('list', 'form', 'card:<id>'…): redrawing the same kind
   * keeps the height the person dragged it to; a new kind starts at `start`.
   */
  let sheetKind = '';
  function openSheet(html: string, kind: string, start: Snap = 'half', snaps: Snap[] = ['half', 'full']) {
    sheet.innerHTML = `<div class="sheet-grab" role="button" aria-label="Drag to resize"></div><button type="button" class="hl-close" aria-label="Close">✕</button><div class="hl-sheet-body">${html}</div>`;
    sheet.querySelector('.hl-close')!.addEventListener('click', userClose);
    const fresh = sheet.hidden || kind !== sheetKind;
    sheet.hidden = false;
    parent.classList.add('hl-sheet-open');
    if (fresh) drag.open(start, snaps);
    sheetKind = kind;
  }

  /** Closed by the person (✕ or dragged down): go back to the map if the Hit list tab was showing. */
  function userClose() {
    closeSheet();
    if (currentTab() === 'list') showTab('map');
  }
  const drag = makeDraggable(sheet, userClose);

  function closeSheet() {
    sheet.hidden = true;
    sheet.style.height = '';
    sheetKind = '';
    view = null;
    draft = null;
    results = [];
    pins.hideDraft();
    pins.setHidden(undefined, false);
    parent.classList.remove('hl-sheet-open');
  }

  /** Fly so the point sits in the part of the map the sheet doesn't cover. */
  function flyTo(lat: number, lng: number) {
    // The height the sheet is heading to (it may still be sliding there).
    const covered = sheet.hidden ? 0 : parseFloat(sheet.style.height) || sheet.offsetHeight;
    adv.flyToPlace(lat, lng, covered);
  }

  function needSignIn(): boolean {
    if (signedIn) return false;
    view = 'other';
    openSheet(`<h2>Sign in first</h2><p class="hl-muted">${
      supabase ? 'Tap the account button at the top right and use the shared login. Your hit list appears once you’re in.' : 'Supabase isn’t set up yet (see SETUP.md).'
    }</p>`, 'signin');
    return true;
  }

  // ---- List ----

  function itemRow(i: HitListItem) {
    const c = categoryOf(i.activity);
    const sub = i.notes ? `<small>${esc(i.notes.split('\n')[0].slice(0, 80))}</small>` : '';
    return `<button type="button" class="hl-row" data-id="${i.id}" style="--pin:${c.color}"><span class="hl-row-icon">${c.icon}</span><span>${esc(i.name)}${sub}</span></button>`;
  }

  /** Checkable category chips. None picked means everything shows. Counts are for the selected region. */
  function categoryFilter() {
    const counts = new Map<string, number>();
    regionItems().forEach((i) => counts.set(categoryOf(i.activity).id, (counts.get(categoryOf(i.activity).id) ?? 0) + 1));
    return `<div class="hl-filter-head"><span>${filter.size ? `Showing ${filter.size} categor${filter.size === 1 ? 'y' : 'ies'}` : 'Tap categories to show only those'}</span>${
      filter.size ? '<button type="button" class="hl-link" data-act="clear">Clear all</button>' : ''
    }</div>
      <div class="hl-filter-grid">${CATEGORIES.map((c) => {
        const n = counts.get(c.id) ?? 0;
        const on = filter.has(c.id);
        return `<button type="button" class="hl-chip ${on ? 'on' : ''} ${n ? '' : 'empty'}" data-cat="${c.id}" aria-pressed="${on}" style="--pin:${c.color}">${c.icon}<span>${esc(c.label)}</span><small>${n}</small><span class="hl-check" aria-hidden="true">${on ? '✓' : ''}</span></button>`;
      }).join('')}</div>`;
  }

  function openList() {
    if (needSignIn()) return;
    view = 'list';
    const shown = visibleItems();
    const region = adv.getRegion();
    const inArea = regionItems().length;
    const toLocate = shown.filter((i) => i.lat == null);
    const filterNote = filter.size ? ` · showing ${[...filter].map((id) => categoryOf(id).label).join(', ')}` : '';
    const regionNote = region === 'AUS' ? '' : ` in ${region}`;
    const modes = `<div class="hl-tabs hl-modes" role="tablist">
        <button type="button" role="tab" data-mode="todo" class="${listMode === 'todo' ? 'on' : ''}" aria-selected="${listMode === 'todo'}">To do</button>
        <button type="button" role="tab" data-mode="done" class="${listMode === 'done' ? 'on' : ''}" aria-selected="${listMode === 'done'}">Done${trips.length ? ` (${trips.length})` : ''}</button>
      </div>`;
    if (listMode === 'done') {
      openSheet(`<div class="hl-head"><h2>Hit list</h2></div>${modes}${doneListHtml()}`, 'list');
      bindModes();
      sheet.querySelectorAll<HTMLButtonElement>('[data-trip]').forEach((row) =>
        row.addEventListener('click', () => openTrip(trips.find((t) => t.id === row.dataset.trip)!)),
      );
      fillPhotos();
      return;
    }
    let html = `<div class="hl-head"><h2>Hit list</h2><button type="button" class="hl-add" data-act="add">${ICONS.plus}<span>Add</span></button></div>${modes}<p class="hl-muted">${inArea} adventure${inArea === 1 ? '' : 's'}${regionNote}${esc(filterNote)}</p>`;
    html += categoryFilter();
    if (loadError) html += `<p class="hl-error">Couldn’t load the hit list: ${esc(loadError)}</p>`;
    if (toLocate.length) {
      html += `<h3>${ICONS.pin} To locate (${toLocate.length})</h3><p class="hl-muted">No pin yet. Tap one to find it.</p>${toLocate.map(itemRow).join('')}`;
    }
    for (const c of CATEGORIES) {
      const inCat = shown.filter((i) => i.lat != null && categoryOf(i.activity).id === c.id);
      if (inCat.length) html += `<h3>${c.icon} ${esc(c.label)} (${inCat.length})</h3>${inCat.map(itemRow).join('')}`;
    }
    if (!shown.length && !loadError) {
      html += `<p class="hl-muted">${items.length ? `Nothing${regionNote} in the selected categories.` : 'Nothing yet. Tap <b>Add</b>, or press and hold on the map, to add your first adventure.'}</p>`;
    }
    openSheet(html, 'list');
    bindModes();
    sheet.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.cat!;
        if (filter.has(id)) filter.delete(id);
        else filter.add(id);
        refresh();
      }),
    );
    sheet.querySelector('[data-act="add"]')!.addEventListener('click', () => openCategoryPicker());
    sheet.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      filter.clear();
      refresh();
    });
    sheet.querySelectorAll<HTMLButtonElement>('.hl-row').forEach((row) =>
      row.addEventListener('click', () => {
        const item = items.find((i) => i.id === row.dataset.id)!;
        if (item.lat == null) openForm(draftFrom(item));
        else openCard(item);
      }),
    );
  }

  function bindModes() {
    sheet.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        listMode = b.dataset.mode as 'todo' | 'done';
        openList();
      }),
    );
  }

  // ---- Done list ----

  /** A photo (filled in by fillPhotos once its link arrives) or the category icon. */
  function tripThumb(t: DoneTrip, cls = 'hl-row-icon') {
    const c = categoryOf(t.activity);
    return t.photo_path
      ? `<span class="${cls} hl-thumb" data-photo="${esc(t.photo_path)}" role="img" aria-label="Photo"></span>`
      : `<span class="${cls}">${c.icon}</span>`;
  }

  function doneListHtml(): string {
    if (!trips.length) return '<p class="hl-muted">Nothing done yet. Open a place and tap <b>Mark as done</b> after you’ve been.</p>';
    const rows = trips
      .map((t) => {
        const c = categoryOf(t.activity);
        const sub = [done.doneDate(t.done_on), t.note?.split('\n')[0].slice(0, 80)].filter(Boolean).join(' · ');
        return `<button type="button" class="hl-row" data-trip="${t.id}" style="--pin:${c.color}">${tripThumb(t)}<span>${esc(t.name)}<small>${esc(sub)}</small></span></button>`;
      })
      .join('');
    const places = new Set(trips.map((t) => t.item_id ?? t.name)).size;
    return `<p class="hl-muted">${trips.length} trip${trips.length === 1 ? '' : 's'} to ${places} place${places === 1 ? '' : 's'}</p>${rows}`;
  }

  /** Put photos into any `[data-photo]` spots in the sheet. */
  async function fillPhotos() {
    const spots = [...sheet.querySelectorAll<HTMLElement>('[data-photo]')];
    if (!spots.length) return;
    const links = await done.photoUrls(spots.map((s) => s.dataset.photo!));
    spots.forEach((s) => {
      const url = links.get(s.dataset.photo!);
      if (url && s.isConnected) s.style.backgroundImage = `url("${url}")`;
    });
  }

  /** The visits to one place, shown on its card, with the Mark as done button. */
  function cardDoneHtml(item: HitListItem): string {
    const mine = trips.filter((t) => t.item_id === item.id);
    const list = mine
      .map((t) => `<button type="button" class="hl-done-row" data-trip="${t.id}">${tripThumb(t, 'hl-done-thumb')}<span><b>${done.doneDate(t.done_on)}</b>${t.note ? `<small>${esc(t.note.split('\n')[0].slice(0, 80))}</small>` : ''}</span></button>`)
      .join('');
    return `<div class="hl-done">
        ${mine.length ? `<h3>${ICONS.check} Been here${mine.length > 1 ? ` ${mine.length} times` : ''}</h3>${list}` : ''}
        <button type="button" class="hl-wide" data-act="mark-done">${ICONS.check} ${mine.length ? 'Add another visit' : 'Mark as done'}</button>
      </div>`;
  }

  /** Log a visit: date (today by default), an optional photo and note. */
  function openDoneForm(item: HitListItem) {
    view = 'other';
    let photo: File | null = null;
    openSheet(
      `<h2>Done: ${esc(item.name)}</h2>
      <label class="hl-field">When<input name="done_on" type="date" value="${done.todayIso()}" max="${done.todayIso()}" /></label>
      <label class="hl-field"><span>Photo <small>(optional)</small></span>
        <span class="hl-photo-pick"><span class="hl-photo-preview" hidden></span><span class="hl-photo-label">Choose a photo</span>
        <input name="photo" type="file" accept="image/*" /></span></label>
      <label class="hl-field"><span>Note <small>(optional)</small></span><textarea name="note" rows="3" placeholder="Who came, how it was, what to do next time…"></textarea></label>
      <div class="hl-actions">
        <button type="button" class="hl-primary" data-act="save-done">Save</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
      <p class="hl-error" hidden></p>`,
      'done-form',
      'full',
      ['half', 'full'],
    );
    const input = sheet.querySelector<HTMLInputElement>('input[name="photo"]')!;
    input.addEventListener('change', () => {
      photo = input.files?.[0] ?? null;
      const preview = sheet.querySelector<HTMLElement>('.hl-photo-preview')!;
      preview.hidden = !photo;
      if (photo) preview.style.backgroundImage = `url("${URL.createObjectURL(photo)}")`;
      sheet.querySelector('.hl-photo-label')!.textContent = photo ? 'Change photo' : 'Choose a photo';
    });
    sheet.querySelector('[data-act="cancel"]')!.addEventListener('click', () => openCard(item));
    sheet.querySelector('[data-act="save-done"]')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const date = sheet.querySelector<HTMLInputElement>('input[name="done_on"]')!.value || done.todayIso();
      const note = sheet.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!.value.trim();
      btn.disabled = true;
      btn.textContent = photo ? 'Uploading…' : 'Saving…';
      try {
        const t = await done.addDone({ item_id: item.id, name: item.name, activity: item.activity, done_on: date, note: note || null }, photo);
        trips = [t, ...trips].sort((a, b) => b.done_on.localeCompare(a.done_on) || b.created_at.localeCompare(a.created_at));
        refresh();
        openCard(item);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Save';
        showError(err);
      }
    });
  }

  /** One visit: the photo large, the date and note, and a way back to the place. */
  function openTrip(t: DoneTrip) {
    view = 'other';
    const item = t.item_id ? items.find((i) => i.id === t.item_id) : undefined;
    const c = categoryOf(t.activity);
    openSheet(
      `<div class="hl-card-head" data-drag style="--pin:${c.color}"><span class="hl-card-icon">${c.icon}</span><div><h2>${esc(t.name)}</h2><small>${esc(c.label)} · ${done.doneDate(t.done_on)}</small></div></div>
      ${t.photo_path ? `<div class="hl-photo-big" data-photo="${esc(t.photo_path)}" role="img" aria-label="Photo from ${esc(t.name)}"></div>` : ''}
      ${t.note ? `<p class="hl-notes">${esc(t.note)}</p>` : ''}
      <div class="hl-actions">
        ${item ? '<button type="button" class="hl-primary" data-act="open-place">Open the place</button>' : ''}
        <button type="button" data-act="back">Back to Done</button>
      </div>
      <button type="button" class="hl-delete" data-act="delete-trip">Delete this visit</button>
      <p class="hl-error" hidden></p>`,
      `trip:${t.id}`,
      'full',
      ['half', 'full'],
    );
    fillPhotos();
    sheet.querySelector('[data-act="open-place"]')?.addEventListener('click', () => openCard(item!));
    sheet.querySelector('[data-act="back"]')!.addEventListener('click', () => {
      listMode = 'done';
      if (currentTab() !== 'list') showTab('list');
      else openList();
    });
    sheet.querySelector('[data-act="delete-trip"]')!.addEventListener('click', async () => {
      if (!confirm(`Delete this visit to “${t.name}”?`)) return;
      try {
        await done.deleteDone(t);
        trips = trips.filter((x) => x.id !== t.id);
        refresh();
        if (item) openCard(item);
        else {
          listMode = 'done';
          openList();
        }
      } catch (err) {
        showError(err);
      }
    });
  }

  // ---- Card ----

  /**
   * A place card. Pulled down ("peek") it shows the name, a short forecast summary and the main
   * buttons, with the map above; drag it up for notes and the full forecast.
   */
  function openCard(item: HitListItem) {
    if (picking) return;
    view = 'other';
    const c = categoryOf(item.activity);
    const located = item.lat != null && item.lng != null;
    const region = located ? regionOf(item.lat!, item.lng!) : null;
    const sub = [c.label, region].filter(Boolean).join(' · ');
    const directions = located ? `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}` : '';
    openSheet(
      `
      <div class="hl-peek">
        <div class="hl-card-head" data-drag style="--pin:${c.color}">
          <span class="hl-card-icon">${c.icon}</span>
          <div><h2>${esc(item.name)}</h2><small>${esc(sub)}</small></div>
        </div>
        <div class="hl-card-summary"></div>
        <div class="hl-card-buttons">
          ${located ? `<a class="hl-card-btn hl-primary" href="${directions}" target="_blank" rel="noopener">${ICONS.directions}<span>Directions</span></a>` : ''}
          <button type="button" class="hl-card-btn" data-act="share">${ICONS.share}<span>Share</span></button>
          <button type="button" class="hl-card-btn" data-act="edit">${ICONS.edit}<span>Edit</span></button>
        </div>
      </div>
      ${item.notes ? `<p class="hl-notes">${esc(item.notes)}</p>` : ''}
      ${item.link ? `<p><a href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*/, ''))}</a></p>` : ''}
      ${item.faces != null && HAS_FACING.has(c.id) ? `<p class="hl-muted">Beach faces ${compass(item.faces)}</p>` : ''}
      ${located ? '' : '<p class="hl-muted">Not on the map yet.</p>'}
      ${cardDoneHtml(item)}
      <div class="hl-card-extra"></div>
      <button type="button" class="hl-delete" data-act="delete">Delete from the hit list</button>
      <p class="hl-error" hidden></p>
    `,
      `card:${item.id}`,
      'peek',
      ['peek', 'half', 'full'],
    );
    // A place card belongs to the map, wherever it was opened from.
    if (currentTab() !== 'map') showTab('map');
    const summary = sheet.querySelector<HTMLElement>('.hl-card-summary')!;
    cardSummaries.forEach((fill) => fill(item, summary));
    const extra = sheet.querySelector<HTMLElement>('.hl-card-extra')!;
    cardSections.forEach((fill) => {
      const el = document.createElement('div');
      extra.append(el);
      fill(item, el);
    });
    // Peek shows everything down to the buttons.
    const peek = sheet.querySelector<HTMLElement>('.hl-peek')!;
    drag.open('peek', ['peek', 'half', 'full'], peek.offsetTop + peek.offsetHeight + 8);

    sheet.querySelector('[data-act="edit"]')!.addEventListener('click', () => openForm(draftFrom(item)));
    sheet.querySelector('[data-act="mark-done"]')!.addEventListener('click', () => openDoneForm(item));
    sheet.querySelectorAll<HTMLButtonElement>('.hl-done [data-trip]').forEach((b) =>
      b.addEventListener('click', () => openTrip(trips.find((t) => t.id === b.dataset.trip)!)),
    );
    fillPhotos();
    sheet.querySelector('[data-act="share"]')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const url = located ? `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}` : item.link ?? '';
      const text = [item.name, item.notes?.split('\n')[0]].filter(Boolean).join(' · ');
      try {
        if (navigator.share) await navigator.share({ title: item.name, text, url: url || undefined });
        else {
          await navigator.clipboard.writeText([text, url].filter(Boolean).join('\n'));
          btn.querySelector('span')!.textContent = 'Copied';
        }
      } catch {
        /* share sheet closed */
      }
    });
    sheet.querySelector('[data-act="delete"]')!.addEventListener('click', async () => {
      if (!confirm(`Delete “${item.name}” from the hit list?`)) return;
      try {
        await store.deleteItem(item.id);
        items = items.filter((i) => i.id !== item.id);
        closeSheet();
        refresh();
      } catch (err) {
        showError(err);
      }
    });
    if (located) flyTo(item.lat!, item.lng!);
  }

  // ---- Add / edit ----

  function draftFrom(item: HitListItem): Draft {
    return {
      id: item.id,
      activity: categoryOf(item.activity).id,
      name: item.name,
      notes: item.notes ?? '',
      link: item.link ?? '',
      lat: item.lat,
      lng: item.lng,
      faces: item.faces,
      where: item.lat != null ? 'Saved pin' : '',
    };
  }

  /** Step one of adding: pick a category. `at` is set when adding from a long press on the map. */
  function openCategoryPicker(at?: { lat: number; lng: number }) {
    if (needSignIn()) return;
    view = 'other';
    openSheet(`
      <h2>What kind of adventure?</h2>
      <div class="hl-cat-grid">
        ${CATEGORIES.map((c) => `<button type="button" data-cat="${c.id}" style="--pin:${c.color}">${c.icon}<span>${esc(c.label)}</span></button>`).join('')}
      </div>
    `, 'picker');
    sheet.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        locTab = 'search';
        openForm({ activity: b.dataset.cat!, name: '', notes: '', link: '', lat: at?.lat ?? null, lng: at?.lng ?? null, faces: null, where: at ? 'Dropped pin' : '' });
      }),
    );
  }

  function setLocation(lat: number, lng: number, where: string, fly = true) {
    if (!draft) return;
    draft.lat = lat;
    draft.lng = lng;
    draft.where = where;
    openForm(draft);
    if (fly) flyTo(lat, lng);
  }

  function locPanel(): string {
    if (locTab === 'search') {
      return `
        <form class="hl-search">
          <input name="q" type="search" placeholder="e.g. Grand Canyon Track, Blackheath" value="" enterkeyhint="search" />
          <button type="submit">Search</button>
        </form>
        <div class="hl-results">${results
          .map((r, n) => `<button type="button" class="hl-row" data-n="${n}"><span class="hl-row-icon">${ICONS.pin}</span><span>${esc(r.name)}<small>${esc(r.detail)}</small></span></button>`)
          .join('')}</div>
        <p class="hl-muted hl-search-msg">Searches OpenStreetMap in NSW, ACT, VIC and TAS.</p>`;
    }
    if (locTab === 'map') {
      return `<button type="button" class="hl-wide" data-act="pick">${ICONS.map} Choose on the map</button>`;
    }
    return `
      <form class="hl-link">
        <input name="url" type="text" inputmode="url" placeholder="Paste a Google Maps link or -33.86, 151.21" />
        <button type="submit">Use</button>
      </form>
      <p class="hl-muted hl-link-msg">Use the full link from the address bar. Short maps.app.goo.gl links can’t be read here.</p>`;
  }

  function openForm(d: Draft) {
    draft = d;
    view = 'other';
    const c = categoryOf(d.activity);
    const where =
      d.lat != null
        ? `<div class="hl-where ok">${ICONS.pin} ${esc(d.where || 'Pin set')} <small>${fmt(d.lat)}, ${fmt(d.lng!)}</small><button type="button" data-act="clear-loc">Remove</button></div>`
        : `<div class="hl-where">No location yet. You can save it now and it goes in the <b>To locate</b> list.</div>`;
    openSheet(`
      <h2>${d.id ? 'Edit adventure' : 'New adventure'}</h2>
      <div class="hl-cat-row">
        ${CATEGORIES.map((k) => `<button type="button" class="hl-chip ${k.id === c.id ? 'on' : ''}" data-cat="${k.id}" style="--pin:${k.color}">${k.icon} ${esc(k.label)}</button>`).join('')}
      </div>
      <label class="hl-field">Name<input name="name" value="${esc(d.name)}" placeholder="e.g. Grand Canyon Track" autocomplete="off" /></label>
      <div class="hl-field">Location</div>
      ${where}
      <div class="hl-tabs" role="tablist">
        <button type="button" data-tab="search" class="${locTab === 'search' ? 'on' : ''}">Search</button>
        <button type="button" data-tab="map" class="${locTab === 'map' ? 'on' : ''}">Tap map</button>
        <button type="button" data-tab="link" class="${locTab === 'link' ? 'on' : ''}">Maps link</button>
      </div>
      <div class="hl-tabpanel">${locPanel()}</div>
      ${HAS_FACING.has(c.id) ? `<div class="hl-field">Beach faces <small>(out to sea, for onshore and offshore wind)</small></div>
      <div class="hl-facing">${FACINGS.map(([label, deg]) => `<button type="button" data-face="${deg}" class="${d.faces != null && compass(d.faces) === label ? 'on' : ''}">${label}</button>`).join('')}${
        d.faces != null && !FACINGS.some(([l]) => l === compass(d.faces!)) ? `<span class="hl-muted">${compass(d.faces)} (${d.faces}°)</span>` : ''
      }</div>` : ''}
      <label class="hl-field">Notes<textarea name="notes" rows="3" placeholder="Best season, who wants to go, gear…">${esc(d.notes)}</textarea></label>
      <label class="hl-field">Link<input name="link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="AllTrails, park page…" /></label>
      <div class="hl-actions">
        <button type="button" class="hl-primary" data-act="save">${d.id ? 'Save changes' : 'Save'}</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
      <p class="hl-error" hidden></p>
    `, 'form');

    // Keep the draft in step with what's typed, so re-rendering the form never loses anything.
    const bind = (name: 'name' | 'notes' | 'link') =>
      sheet.querySelector<HTMLInputElement>(`[name="${name}"]`)!.addEventListener('input', (e) => (d[name] = (e.target as HTMLInputElement).value));
    bind('name');
    bind('notes');
    bind('link');

    sheet.querySelectorAll<HTMLButtonElement>('.hl-cat-row [data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        d.activity = b.dataset.cat!;
        openForm(d);
      }),
    );
    sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        locTab = b.dataset.tab as LocTab;
        openForm(d);
      }),
    );
    sheet.querySelectorAll<HTMLButtonElement>('[data-face]').forEach((b) =>
      b.addEventListener('click', () => {
        const deg = Number(b.dataset.face);
        d.faces = d.faces === deg ? null : deg;
        openForm(d);
      }),
    );
    sheet.querySelector('[data-act="clear-loc"]')?.addEventListener('click', () => {
      d.lat = d.lng = null;
      d.where = '';
      openForm(d);
    });
    sheet.querySelector('[data-act="pick"]')?.addEventListener('click', startPicking);
    sheet.querySelector('[data-act="cancel"]')!.addEventListener('click', closeSheet);
    sheet.querySelector('[data-act="save"]')!.addEventListener('click', save);

    const searchForm = sheet.querySelector<HTMLFormElement>('.hl-search');
    searchForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = String(new FormData(searchForm).get('q')).trim();
      const msg = sheet.querySelector<HTMLElement>('.hl-search-msg')!;
      if (!q) return;
      msg.textContent = 'Searching…';
      try {
        results = await searchPlaces(q);
        if (draft !== d) return;
        openForm(d);
        const input = sheet.querySelector<HTMLInputElement>('.hl-search input')!;
        input.value = q;
        sheet.querySelector<HTMLElement>('.hl-search-msg')!.textContent = results.length
          ? 'Tap the right one.'
          : 'No matches in NSW, ACT, VIC or TAS. Try a nearby town, or drop a pin on the map.';
      } catch (err) {
        msg.textContent = err instanceof Error ? err.message : String(err);
      }
    });
    sheet.querySelectorAll<HTMLButtonElement>('.hl-results [data-n]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = results[Number(b.dataset.n)];
        results = [];
        if (!d.name.trim()) d.name = r.name;
        setLocation(r.lat, r.lng, r.name);
      }),
    );

    const linkForm = sheet.querySelector<HTMLFormElement>('.hl-link');
    linkForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const res = parseLocationText(String(new FormData(linkForm).get('url')));
      if (!res.ok) {
        const msg = sheet.querySelector<HTMLElement>('.hl-link-msg')!;
        msg.textContent = res.message;
        msg.classList.add('hl-error');
        return;
      }
      if (res.name && !d.name.trim()) d.name = res.name;
      setLocation(res.lat, res.lng, res.name ? `From link: ${res.name}` : 'From Google Maps link');
    });

    // Show the draft pin (draggable) instead of the saved one while editing.
    pins.setHidden(d.id, true);
    if (d.lat != null && d.lng != null) {
      pins.showDraft(d.lat, d.lng, c.icon, c.color, (lat, lng) => {
        d.lat = lat;
        d.lng = lng;
        d.where = 'Dropped pin';
        openForm(d);
      });
    } else {
      pins.hideDraft();
    }
  }

  function startPicking() {
    picking = true;
    adv.setTapToZoom(false);
    sheet.hidden = true;
    banner.hidden = false;
    map.getCanvas().style.cursor = 'crosshair';
  }

  function stopPicking() {
    picking = false;
    adv.setTapToZoom(true);
    banner.hidden = true;
    map.getCanvas().style.cursor = '';
  }

  banner.querySelector('button')!.addEventListener('click', () => {
    stopPicking();
    if (draft) openForm(draft);
  });

  map.on('click', (e: MapMouseEvent) => {
    if (!picking || !draft) return;
    stopPicking();
    setLocation(e.lngLat.lat, e.lngLat.lng, 'Dropped pin');
  });

  function showError(err: unknown) {
    const el = sheet.querySelector<HTMLElement>('.hl-error');
    const text = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
    if (el) {
      el.textContent = text;
      el.hidden = false;
    } else alert(text);
  }

  async function save() {
    const d = draft;
    if (!d) return;
    const name = d.name.trim() || (d.lat != null ? d.where.replace(/^From link: /, '') : '');
    if (!name || name === 'Dropped pin' || name === 'Saved pin' || name === 'From Google Maps link') {
      showError('Give it a name first.');
      sheet.querySelector<HTMLInputElement>('[name="name"]')?.focus();
      return;
    }
    let link = d.link.trim();
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    const fields: store.ItemFields = { name, activity: d.activity, lat: d.lat, lng: d.lng, notes: d.notes.trim() || null, link: link || null, faces: HAS_FACING.has(d.activity) ? d.faces : null };
    const btn = sheet.querySelector<HTMLButtonElement>('[data-act="save"]')!;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const saved = d.id ? await store.updateItem(d.id, fields) : await store.addItem(fields);
      items = d.id ? items.map((i) => (i.id === saved.id ? saved : i)) : [...items, saved];
      // Make sure the new pin is visible even if its category was filtered out.
      if (filter.size && !filter.has(categoryOf(saved.activity).id)) filter.add(categoryOf(saved.activity).id);
      closeSheet();
      refresh();
      if (saved.lat != null) openCard(saved);
      else openList();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = d.id ? 'Save changes' : 'Save';
      showError(err);
    }
  }

  // ---- Tabs ----
  // Hit list opens the list. Map closes the list but keeps a place card open. Camps closes the sheet.
  // Plan covers everything, so the sheet is left as it is underneath.
  onTab((tab) => {
    if (picking) {
      stopPicking();
      closeSheet();
    }
    if (tab === 'list') openList();
    else if (tab === 'map' && view === 'list') closeSheet();
    else if (tab === 'camps') closeSheet();
  });

  // ---- Press and hold on the map to add an adventure there ----
  let pressTimer = 0;
  let pressStart: { x: number; y: number } | null = null;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressStart = null;
  };
  map.on('touchstart', (e) => {
    cancelPress();
    if (picking || e.points.length !== 1) return;
    const at = e.lngLat;
    pressStart = { x: e.point.x, y: e.point.y };
    pressTimer = window.setTimeout(() => {
      pressStart = null;
      navigator.vibrate?.(10);
      openCategoryPicker({ lat: at.lat, lng: at.lng });
    }, 600);
  });
  map.on('touchmove', (e) => {
    if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 10) cancelPress();
  });
  map.on('touchend', cancelPress);
  map.on('touchcancel', cancelPress);
  map.on('movestart', cancelPress);
  // Right-click on a computer does the same.
  map.on('contextmenu', (e) => {
    if (!picking) openCategoryPicker({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  // ---- Loading ----

  async function load() {
    try {
      [items, trips] = await Promise.all([store.loadItems(), done.loadDone().catch(() => [] as DoneTrip[])]);
      loadError = '';
    } catch (err) {
      loadError = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
    }
    refresh();
  }

  refresh();
  supabase?.auth.onAuthStateChange((_event, session) => {
    const now = !!session;
    if (now && !signedIn) setTimeout(load, 0); // Supabase advises not calling it from inside this callback.
    if (!now) {
      items = [];
      trips = [];
      refresh();
    }
    signedIn = now;
  });

  return {
    reload: load,
    onVisibleChange(cb) {
      visibleListeners.push(cb);
      cb(visibleItems().filter((i) => i.lat != null && i.lng != null));
    },
    onItemsChange(cb) {
      itemsListeners.push(cb);
      cb(located());
    },
    openItem(id) {
      const item = items.find((i) => i.id === id);
      if (item) openCard(item);
    },
    isGrouped: (id) => pins.isGrouped(id),
    onGroupsChange(cb) {
      groupListeners.push(cb);
    },
    addCardSection(fill) {
      cardSections.push(fill);
    },
    addCardSummary(fill) {
      cardSummaries.push(fill);
    },
  };
}

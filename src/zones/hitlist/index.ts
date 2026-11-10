import './hitlist.css';
import type { MapMouseEvent } from 'maplibre-gl';
import type { AdventureMap } from '../map';
import { supabase } from '../shared/supabase';
import type { HitListItem } from '../shared/types';
import { CATEGORIES, categoryOf } from './categories';
import { Pins } from './pins';
import * as store from './store';
import { searchPlaces, type PlaceMatch } from './geocode';
import { parseLocationText } from './gmaps';

/** What the add/edit form is working on. `id` is set when editing an existing item. */
interface Draft {
  id?: string;
  activity: string;
  name: string;
  notes: string;
  link: string;
  lat: number | null;
  lng: number | null;
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

/**
 * The hit list: category filter chips, pins on the map, and a bottom sheet for the list,
 * adding, viewing, editing and deleting adventures. Data is saved in Supabase (`hit_list`).
 */
export function mountHitList(parent: HTMLElement, adv: AdventureMap) {
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

  // ---- Floating UI ----
  const chips = document.createElement('div');
  chips.className = 'hl-filter';
  chips.setAttribute('role', 'toolbar');
  chips.setAttribute('aria-label', 'Show categories');

  const listBtn = document.createElement('button');
  listBtn.className = 'hl-list-btn';
  listBtn.type = 'button';

  const addBtn = document.createElement('button');
  addBtn.className = 'hl-add-btn';
  addBtn.type = 'button';
  addBtn.setAttribute('aria-label', 'Add an adventure');
  addBtn.textContent = '+';

  const sheet = document.createElement('section');
  sheet.className = 'hl-sheet';
  sheet.hidden = true;

  const banner = document.createElement('div');
  banner.className = 'hl-banner';
  banner.hidden = true;
  banner.innerHTML = `<span>Tap the map where it is. Drag the pin to fine-tune.</span><button type="button">Cancel</button>`;

  parent.append(chips, listBtn, addBtn, sheet, banner);

  const pins = new Pins(map, (item) => openCard(item));

  function visibleItems() {
    return items.filter((i) => filter.size === 0 || filter.has(categoryOf(i.activity).id));
  }

  function refresh() {
    pins.show(visibleItems());
    renderChips();
    const toLocate = items.filter((i) => i.lat == null).length;
    listBtn.innerHTML = `☰ Hit list <b>${items.length}</b>${toLocate ? `<span class="hl-badge" title="To locate">📍${toLocate}</span>` : ''}`;
    if (view === 'list') openList();
  }

  function renderChips() {
    const counts = new Map<string, number>();
    items.forEach((i) => counts.set(categoryOf(i.activity).id, (counts.get(categoryOf(i.activity).id) ?? 0) + 1));
    chips.innerHTML =
      `<button type="button" class="hl-chip ${filter.size === 0 ? 'on' : ''}" data-cat="">All</button>` +
      CATEGORIES.map((c) => {
        const n = counts.get(c.id) ?? 0;
        return `<button type="button" class="hl-chip ${filter.has(c.id) ? 'on' : ''} ${n ? '' : 'empty'}" data-cat="${c.id}" style="--pin:${c.color}">${c.emoji} ${esc(c.label)}${n ? ` <small>${n}</small>` : ''}</button>`;
      }).join('');
  }

  chips.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cat]');
    if (!btn) return;
    const id = btn.dataset.cat!;
    if (!id) filter.clear();
    else if (filter.has(id)) filter.delete(id);
    else filter.add(id);
    refresh();
  });

  // ---- Bottom sheet ----

  function openSheet(html: string) {
    sheet.innerHTML = `<button type="button" class="hl-close" aria-label="Close">✕</button><div class="hl-sheet-body">${html}</div>`;
    sheet.hidden = false;
    sheet.querySelector('.hl-close')!.addEventListener('click', closeSheet);
    parent.classList.add('hl-sheet-open');
  }

  function closeSheet() {
    sheet.hidden = true;
    view = null;
    draft = null;
    results = [];
    pins.hideDraft();
    pins.setHidden(undefined, false);
    parent.classList.remove('hl-sheet-open');
  }

  /** Fly so the point sits in the part of the map the sheet doesn't cover. */
  function flyTo(lat: number, lng: number) {
    const covered = sheet.hidden ? 0 : sheet.offsetHeight;
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 11), offset: [0, -covered / 2], duration: 1500, essential: true });
  }

  function needSignIn(): boolean {
    if (signedIn) return false;
    view = 'other';
    openSheet(`<h2>Sign in first</h2><p class="hl-muted">${
      supabase ? 'Open <b>Sign in</b> at the top left and use the shared login. Your hit list appears once you’re in.' : 'Supabase isn’t set up yet (see SETUP.md).'
    }</p>`);
    return true;
  }

  // ---- List ----

  function itemRow(i: HitListItem) {
    const c = categoryOf(i.activity);
    const sub = i.notes ? `<small>${esc(i.notes.split('\n')[0].slice(0, 80))}</small>` : '';
    return `<button type="button" class="hl-row" data-id="${i.id}" style="--pin:${c.color}"><span class="hl-row-icon">${c.emoji}</span><span>${esc(i.name)}${sub}</span></button>`;
  }

  function openList() {
    if (needSignIn()) return;
    view = 'list';
    const shown = visibleItems();
    const toLocate = shown.filter((i) => i.lat == null);
    const filterNote = filter.size ? ` · showing ${[...filter].map((id) => categoryOf(id).label).join(', ')}` : '';
    let html = `<h2>Hit list</h2><p class="hl-muted">${items.length} adventure${items.length === 1 ? '' : 's'}${esc(filterNote)}</p>`;
    if (loadError) html += `<p class="hl-error">Couldn’t load the hit list: ${esc(loadError)}</p>`;
    if (toLocate.length) {
      html += `<h3>📍 To locate (${toLocate.length})</h3><p class="hl-muted">No pin yet. Tap one to find it.</p>${toLocate.map(itemRow).join('')}`;
    }
    for (const c of CATEGORIES) {
      const inCat = shown.filter((i) => i.lat != null && categoryOf(i.activity).id === c.id);
      if (inCat.length) html += `<h3>${c.emoji} ${esc(c.label)} (${inCat.length})</h3>${inCat.map(itemRow).join('')}`;
    }
    if (!shown.length && !loadError) {
      html += `<p class="hl-muted">${items.length ? 'Nothing in the selected categories.' : 'Nothing yet. Tap <b>+</b> to add your first adventure.'}</p>`;
    }
    openSheet(html);
    sheet.querySelectorAll<HTMLButtonElement>('.hl-row').forEach((row) =>
      row.addEventListener('click', () => {
        const item = items.find((i) => i.id === row.dataset.id)!;
        if (item.lat == null) openForm(draftFrom(item));
        else openCard(item);
      }),
    );
  }

  // ---- Card ----

  function openCard(item: HitListItem) {
    if (picking) return;
    view = 'other';
    const c = categoryOf(item.activity);
    const gmaps = item.lat != null ? `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}` : '';
    openSheet(`
      <div class="hl-cat-tag" style="--pin:${c.color}">${c.emoji} ${esc(c.label)}</div>
      <h2>${esc(item.name)}</h2>
      ${item.notes ? `<p class="hl-notes">${esc(item.notes)}</p>` : ''}
      ${item.link ? `<p><a href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a></p>` : ''}
      ${item.lat != null ? `<p class="hl-muted">${fmt(item.lat)}, ${fmt(item.lng!)} · <a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a></p>` : '<p class="hl-muted">📍 Not on the map yet.</p>'}
      <div class="hl-actions">
        <button type="button" class="hl-primary" data-act="edit">Edit</button>
        <button type="button" class="hl-danger" data-act="delete">Delete</button>
      </div>
      <p class="hl-error" hidden></p>
    `);
    sheet.querySelector('[data-act="edit"]')!.addEventListener('click', () => openForm(draftFrom(item)));
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
    if (item.lat != null) flyTo(item.lat, item.lng!);
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
      where: item.lat != null ? 'Saved pin' : '',
    };
  }

  function openCategoryPicker() {
    if (needSignIn()) return;
    view = 'other';
    openSheet(`
      <h2>What kind of adventure?</h2>
      <div class="hl-cat-grid">
        ${CATEGORIES.map((c) => `<button type="button" data-cat="${c.id}" style="--pin:${c.color}"><span>${c.emoji}</span>${esc(c.label)}</button>`).join('')}
      </div>
    `);
    sheet.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        locTab = 'search';
        openForm({ activity: b.dataset.cat!, name: '', notes: '', link: '', lat: null, lng: null, where: '' });
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
          .map((r, n) => `<button type="button" class="hl-row" data-n="${n}"><span class="hl-row-icon">📍</span><span>${esc(r.name)}<small>${esc(r.detail)}</small></span></button>`)
          .join('')}</div>
        <p class="hl-muted hl-search-msg">Searches OpenStreetMap in NSW, ACT, VIC and TAS.</p>`;
    }
    if (locTab === 'map') {
      return `<button type="button" class="hl-wide" data-act="pick">🗺️ Choose on the map</button>`;
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
        ? `<div class="hl-where ok">📍 ${esc(d.where || 'Pin set')} <small>${fmt(d.lat)}, ${fmt(d.lng!)}</small><button type="button" data-act="clear-loc">Remove</button></div>`
        : `<div class="hl-where">No location yet. You can save it now and it goes in the <b>To locate</b> list.</div>`;
    openSheet(`
      <h2>${d.id ? 'Edit adventure' : 'New adventure'}</h2>
      <div class="hl-cat-row">
        ${CATEGORIES.map((k) => `<button type="button" class="hl-chip ${k.id === c.id ? 'on' : ''}" data-cat="${k.id}" style="--pin:${k.color}">${k.emoji} ${esc(k.label)}</button>`).join('')}
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
      <label class="hl-field">Notes<textarea name="notes" rows="3" placeholder="Best season, who wants to go, gear…">${esc(d.notes)}</textarea></label>
      <label class="hl-field">Link<input name="link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="AllTrails, park page…" /></label>
      <div class="hl-actions">
        <button type="button" class="hl-primary" data-act="save">${d.id ? 'Save changes' : 'Save'}</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
      <p class="hl-error" hidden></p>
    `);

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
      pins.showDraft(d.lat, d.lng, c.emoji, c.color, (lat, lng) => {
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
    const fields: store.ItemFields = { name, activity: d.activity, lat: d.lat, lng: d.lng, notes: d.notes.trim() || null, link: link || null };
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

  listBtn.addEventListener('click', () => (view === 'list' ? closeSheet() : openList()));
  addBtn.addEventListener('click', openCategoryPicker);

  // ---- Loading ----

  async function load() {
    try {
      items = await store.loadItems();
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
      refresh();
    }
    signedIn = now;
  });

  return { reload: load };
}

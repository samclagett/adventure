import * as maplibregl from 'maplibre-gl';
import type { HitListItem } from '../shared/types';
import { categoryOf } from './categories';

/** A round paper-coloured pin with the category's sketch icon and a thin accent ring. */
function pinElement(icon: string, color: string, extraClass = '', name = ''): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `hl-pin ${extraClass}`.trim();
  el.style.setProperty('--pin', color);
  // MapLibre sets the marker's own transform, so the shape lives on an inner element.
  // The name label only shows while a category filter is on (see .hl-show-names in hitlist.css).
  const label = name ? `<span class="hl-pin-name">${name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</span>` : '';
  el.innerHTML = `<span class="hl-pin-shape">${icon}</span>${label}`;
  return el;
}

/** Zoom level from which pin names show while a category is picked. */
const NAMES_MIN_ZOOM = 7;

/** Pin size for a zoom level: about half size when looking at a whole state, full size from zoom 12. */
function pinScale(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 4) / 8));
  return 0.5 + 0.5 * t;
}

/** From this zoom in, every pin shows on its own. Further out, pins that would pile up become one numbered circle. */
const GROUP_MAX_ZOOM = 11.5;
/** How close (in screen pixels) two pins can be before they are grouped. */
const GROUP_RADIUS = 36;
/** Activity icons shown on a group, before a "+". */
const GROUP_ICONS = 4;

/** Where a point sits on the flat world map, in pixels, at a zoom level (standard web-map maths). */
function worldPx(lat: number, lng: number, zoom: number): [number, number] {
  const size = 512 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

interface Group {
  ids: string[];
  x: number;
  y: number;
  lat: number;
  lng: number;
}

/** Keeps one marker per located hit list item on the map. */
export class Pins {
  private markers = new Map<string, maplibregl.Marker>();
  private draft: maplibregl.Marker | null = null;
  private items: HitListItem[] = [];
  private groupMarkers: maplibregl.Marker[] = [];
  private grouped = new Set<string>();
  private groupStep = -1;
  /** Today's rating per item (go / mar / skip), from the weather layer. Colours each pin's ring. */
  private ratings = new Map<string, string>();
  /** Called whenever the set of grouped pins changes (the weather layer hides chips for grouped pins). */
  onGroupsChange: () => void = () => {};

  constructor(
    private map: maplibregl.Map,
    private onTap: (item: HitListItem) => void,
  ) {
    // Pins grow as you zoom in. The size is a CSS variable on the map, read by hitlist.css.
    const resize = () => {
      const el = map.getContainer();
      el.style.setProperty('--pin-s', pinScale(map.getZoom()).toFixed(2));
      // Names (when a category is picked) only from regional zoom in, where pins are spread out enough to read.
      el.classList.toggle('hl-names-zoom', map.getZoom() >= NAMES_MIN_ZOOM);
    };
    map.on('zoom', resize);
    resize();
    // Regroup when the zoom has moved half a level, so groups stay steady while panning.
    map.on('zoomend', () => {
      if (Math.round(map.getZoom() * 2) !== this.groupStep) this.regroup();
    });
  }

  /** True while this item's pin is folded into a numbered group. */
  isGrouped(id: string): boolean {
    return this.grouped.has(id);
  }

  /** Fold pins that would pile up into numbered circles; tap one to zoom in on its pins. */
  private regroup(notify = true) {
    const zoom = this.map.getZoom();
    this.groupStep = Math.round(zoom * 2);
    this.groupMarkers.forEach((m) => m.remove());
    this.groupMarkers = [];
    this.grouped.clear();
    const groups: Group[] = [];
    if (zoom < GROUP_MAX_ZOOM) {
      for (const item of this.items) {
        if (item.lat == null || item.lng == null) continue;
        const [x, y] = worldPx(item.lat, item.lng, zoom);
        const g = groups.find((o) => Math.hypot(o.x - x, o.y - y) < GROUP_RADIUS);
        if (g) {
          const n = g.ids.length;
          g.x = (g.x * n + x) / (n + 1);
          g.y = (g.y * n + y) / (n + 1);
          g.lat = (g.lat * n + item.lat) / (n + 1);
          g.lng = (g.lng * n + item.lng) / (n + 1);
          g.ids.push(item.id);
        } else groups.push({ ids: [item.id], x, y, lat: item.lat, lng: item.lng });
      }
    }
    for (const g of groups) {
      if (g.ids.length < 2) continue;
      g.ids.forEach((id) => this.grouped.add(id));
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hl-group';
      // The count, then a small string of the activities inside, most common first (Sam, 2026-11-19).
      const members = this.items.filter((i) => g.ids.includes(i.id));
      const counts = new Map<string, number>();
      members.forEach((i) => counts.set(categoryOf(i.activity).id, (counts.get(categoryOf(i.activity).id) ?? 0) + 1));
      const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => categoryOf(id));
      const shown = cats.slice(0, GROUP_ICONS);
      el.innerHTML = `<b>${g.ids.length}</b><span class="hl-group-icons">${shown.map((c) => c.icon).join('')}${cats.length > shown.length ? '<i>+</i>' : ''}</span>`;
      // The ring takes the best rating inside, so a group with a good option stands out.
      const best = ['go', 'mar', 'skip'].find((v) => g.ids.some((id) => this.ratings.get(id) === v));
      if (best) el.dataset.v = best;
      el.setAttribute('aria-label', `${g.ids.length} adventures here: ${cats.map((c) => c.label).join(', ')}. Tap to zoom in.`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const bounds = new maplibregl.LngLatBounds();
        members.forEach((i) => bounds.extend([i.lng!, i.lat!]));
        // Zoom to fit the group's pins. If they are so close that this barely zooms, step in on the group instead.
        const cam = this.map.cameraForBounds(bounds, { padding: { top: 140, bottom: 180, left: 60, right: 60 }, maxZoom: 13 });
        const zoom = Math.max(cam?.zoom ?? 0, this.map.getZoom() + 1.5);
        this.map.flyTo({ center: zoom === cam?.zoom ? cam.center : [g.lng, g.lat], zoom, duration: 1200, essential: true });
      });
      this.groupMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([g.lng, g.lat]).addTo(this.map));
    }
    this.markers.forEach((m, id) => m.getElement().classList.toggle('hl-grouped', this.grouped.has(id)));
    if (notify) this.onGroupsChange();
  }

  /** Colour each pin's ring by its rating (null clears them, e.g. when the weather layer is off). */
  setRatings(ratings: Map<string, string> | null) {
    this.ratings = ratings ?? new Map();
    this.markers.forEach((m, id) => {
      const v = this.ratings.get(id);
      if (v) m.getElement().dataset.v = v;
      else delete m.getElement().dataset.v;
    });
    // Redraw the groups for their rings, without telling the weather layer (it called this).
    this.regroup(false);
  }

  show(items: HitListItem[]) {
    this.items = items;
    this.markers.forEach((m) => m.remove());
    this.markers.clear();
    for (const item of items) {
      if (item.lat == null || item.lng == null) continue;
      const cat = categoryOf(item.activity);
      const el = pinElement(cat.icon, cat.color, '', item.name);
      el.setAttribute('aria-label', `${cat.label}: ${item.name}`);
      el.title = item.name;
      const v = this.ratings.get(item.id);
      if (v) el.dataset.v = v;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTap(item);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([item.lng, item.lat])
        .addTo(this.map);
      this.markers.set(item.id, marker);
    }
    this.regroup();
  }

  /** The pin being placed or edited. Draggable so it can be nudged into place. */
  showDraft(lat: number, lng: number, icon: string, color: string, onMove: (lat: number, lng: number) => void) {
    this.hideDraft();
    const el = pinElement(icon, color, 'hl-pin-draft');
    this.draft = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true })
      .setLngLat([lng, lat])
      .addTo(this.map);
    this.draft.on('dragend', () => {
      const p = this.draft!.getLngLat();
      onMove(p.lat, p.lng);
    });
  }

  hideDraft() {
    this.draft?.remove();
    this.draft = null;
  }

  /** Hide the saved pin for an item while its draft copy is being edited. */
  setHidden(id: string | undefined, hidden: boolean) {
    this.markers.forEach((m, key) => {
      m.getElement().style.visibility = hidden && key === id ? 'hidden' : '';
    });
  }
}

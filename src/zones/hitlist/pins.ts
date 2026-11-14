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

/** Pin size for a zoom level: about a third size when looking at a whole state, full size from zoom 12. */
function pinScale(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 3) / 9));
  return 0.35 + 0.65 * t;
}

/** Keeps one marker per located hit list item on the map. */
export class Pins {
  private markers = new Map<string, maplibregl.Marker>();
  private draft: maplibregl.Marker | null = null;

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
  }

  show(items: HitListItem[]) {
    this.markers.forEach((m) => m.remove());
    this.markers.clear();
    for (const item of items) {
      if (item.lat == null || item.lng == null) continue;
      const cat = categoryOf(item.activity);
      const el = pinElement(cat.icon, cat.color, '', item.name);
      el.setAttribute('aria-label', `${cat.label}: ${item.name}`);
      el.title = item.name;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTap(item);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([item.lng, item.lat])
        .addTo(this.map);
      this.markers.set(item.id, marker);
    }
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

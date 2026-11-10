import * as maplibregl from 'maplibre-gl';
import type { HitListItem } from '../shared/types';
import { categoryOf } from './categories';

/** A round, coloured pin with the category's emoji. */
function pinElement(emoji: string, color: string, extraClass = ''): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `hl-pin ${extraClass}`.trim();
  el.style.setProperty('--pin', color);
  // MapLibre sets the marker's own transform, so the teardrop shape lives on an inner element.
  el.innerHTML = `<span class="hl-pin-shape"><span class="hl-pin-icon">${emoji}</span></span>`;
  return el;
}

/** Keeps one marker per located hit list item on the map. */
export class Pins {
  private markers = new Map<string, maplibregl.Marker>();
  private draft: maplibregl.Marker | null = null;

  constructor(
    private map: maplibregl.Map,
    private onTap: (item: HitListItem) => void,
  ) {}

  show(items: HitListItem[]) {
    this.markers.forEach((m) => m.remove());
    this.markers.clear();
    for (const item of items) {
      if (item.lat == null || item.lng == null) continue;
      const cat = categoryOf(item.activity);
      const el = pinElement(cat.emoji, cat.color);
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
  showDraft(lat: number, lng: number, emoji: string, color: string, onMove: (lat: number, lng: number) => void) {
    this.hideDraft();
    const el = pinElement(emoji, color, 'hl-pin-draft');
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

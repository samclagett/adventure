import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import { fetchForecasts, type Forecast } from './openmeteo';

/**
 * Keeps one forecast per hit list place, fetched in as few requests as possible and saved in the
 * browser for an hour, so reopening the app shows conditions straight away.
 */

/** Categories that also get swell, tides and water temperature. */
export const COASTAL = new Set(['surfing', 'diving', 'kayaking']);
/** Forecasts older than this are fetched again. */
const STALE_MS = 60 * 60 * 1000;
const CACHE_KEY = 'adventure.conditions.cache.v1';

interface Entry {
  forecast: Forecast | null;
  /** Where and what it was fetched for, so a moved pin or changed category is fetched again. */
  key: string;
  at: number;
}

const keyOf = (i: HitListItem) => `${i.lat!.toFixed(4)},${i.lng!.toFixed(4)},${COASTAL.has(categoryOf(i.activity).id)}`;

export class ConditionsData {
  private entries = new Map<string, Entry>();
  private listeners: (() => void)[] = [];
  private queued: HitListItem[] | null = null;
  loading = false;
  error = '';

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Entry>;
      for (const [id, e] of Object.entries(saved)) if (Date.now() - e.at < STALE_MS * 6) this.entries.set(id, e);
    } catch {
      /* nothing saved, or private mode */
    }
  }

  onChange(cb: () => void) {
    this.listeners.push(cb);
  }

  private changed() {
    this.listeners.forEach((cb) => cb());
  }

  /** The forecast for a place, if it has one for its current position and category. */
  get(item: HitListItem): Forecast | null {
    const e = this.entries.get(item.id);
    return e && e.key === keyOf(item) ? e.forecast : null;
  }

  fetchedAt(items: HitListItem[]): number | null {
    const times = items.map((i) => this.entries.get(i.id)).filter((e) => e && e.forecast).map((e) => e!.at);
    return times.length ? Math.min(...times) : null;
  }

  /** Fetch forecasts for any of these places that don't have a fresh one. Shows saved ones meanwhile. */
  async ensure(items: HitListItem[], force = false) {
    const located = items.filter((i) => i.lat != null && i.lng != null);
    const need = located.filter((i) => {
      const e = this.entries.get(i.id);
      return force || !e || e.key !== keyOf(i) || !e.forecast || Date.now() - e.at > STALE_MS;
    });
    if (!need.length) return;
    if (this.loading) {
      // One fetch at a time; ask again once this one is done.
      this.queued = located;
      return;
    }
    this.loading = true;
    this.error = '';
    this.changed();
    try {
      const results = await fetchForecasts(
        need.map((i) => ({ lat: i.lat!, lng: i.lng! })),
        need.map((i) => COASTAL.has(categoryOf(i.activity).id)),
      );
      const at = Date.now();
      need.forEach((i, n) => this.entries.set(i.id, { forecast: results[n], key: keyOf(i), at }));
      this.save();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.loading = false;
    this.changed();
    const next = this.queued;
    this.queued = null;
    if (next) await this.ensure(next);
  }

  private save() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(this.entries)));
    } catch {
      /* full or private mode: it just won't be remembered */
    }
  }
}

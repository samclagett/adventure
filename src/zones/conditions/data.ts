import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import { fetchForecasts, type Forecast } from './openmeteo';
import { setExtras, type RiverReading, type PlaceLike } from './summary';
import type { Alert } from './ratings';

/**
 * Forecasts by AREA, not by pin: one per 0.25° grid square (about 25 km) that has hit list places.
 * Each pin then reads its area's forecast and makes its own summary from it (e.g. a beach's facing).
 *
 * Where they come from, fastest first:
 * 1. Saved in the browser from last time (instant).
 * 2. conditions.json on the `conditions-data` branch, refreshed every 3 hours by
 *    .github/workflows/conditions.yml (scripts/conditions/fetch.py). Same areas as here (`areaId`).
 * 3. Open-Meteo live, for areas missing from both, or for everything when "Update now" is pressed.
 */

/** Categories that also get swell, tides and water temperature. */
export const COASTAL = new Set(['surfing', 'diving', 'kayaking']);
/** Grid size in degrees. Must match the `conditions_areas` function in supabase/schema.sql. */
const CELL = 0.25;
/** Older than this, an area is fetched live (the job runs every 3 hours, so allow some slack). */
const STALE_MS = 4 * 60 * 60 * 1000;
const CACHE_KEY = 'adventure.conditions.areas.v1';
const REMOTE_URL = 'https://raw.githubusercontent.com/samclagett/adventure/conditions-data/conditions.json';
/** River heights from BoM, saved by the same job (scripts/conditions/rivers.py). */
const RIVERS_URL = 'https://raw.githubusercontent.com/samclagett/adventure/conditions-data/rivers.json';

export function areaId(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;
}

const isCoastal = (i: HitListItem) => COASTAL.has(categoryOf(i.activity).id);

interface Entry {
  forecast: Forecast | null;
  coastal: boolean;
  /** When the forecast was fetched (ms). */
  at: number;
}

interface Remote {
  fetched_at: string;
  areas: Record<string, { coastal: boolean; forecast: Forecast }>;
}

export class ConditionsData {
  private entries = new Map<string, Entry>();
  private listeners: (() => void)[] = [];
  private queued: { items: HitListItem[]; force: boolean } | null = null;
  private remoteTried = false;
  /** River gauges by id (rivers.json). */
  private rivers: Record<string, RiverReading> = {};
  /** Alerts from outside the forecast, by place id (fire danger, closures: hazards.ts). */
  private hazards = new Map<string, Alert[]>();
  loading = false;
  error = '';

  constructor() {
    setExtras((p) => this.extras(p));
    void this.loadRivers();
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Entry>;
      for (const [id, e] of Object.entries(saved)) if (Date.now() - e.at < 24 * 60 * 60 * 1000) this.entries.set(id, e);
    } catch {
      /* nothing saved, or private mode */
    }
  }

  /** Alerts and river heights for a place, used by every rating (summary.ts daysOf). */
  private extras(place: PlaceLike) {
    const gauge = typeof place.settings?.gauge === 'string' ? place.settings.gauge : null;
    return { alerts: (place.id && this.hazards.get(place.id)) || [], river: (gauge && this.rivers[gauge]) || null };
  }

  /** Set the outside alerts for each place (hazards.ts), then redraw. */
  setHazards(byPlace: Map<string, Alert[]>) {
    this.hazards = byPlace;
    this.changed();
  }

  private async loadRivers() {
    try {
      const r = await fetch(`${RIVERS_URL}?t=${Math.floor(Date.now() / 300000)}`);
      if (!r.ok) return;
      this.rivers = ((await r.json()) as { gauges: Record<string, RiverReading> }).gauges ?? {};
      this.changed();
    } catch {
      /* not there yet, or offline */
    }
  }

  onChange(cb: () => void) {
    this.listeners.push(cb);
  }

  private changed() {
    this.listeners.forEach((cb) => cb());
  }

  /** The forecast for a place: its area's. */
  get(item: HitListItem): Forecast | null {
    if (item.lat == null || item.lng == null) return null;
    const e = this.entries.get(areaId(item.lat, item.lng));
    // A coastal place needs an area forecast that includes the marine part.
    if (!e || (isCoastal(item) && !e.coastal)) return null;
    return e.forecast;
  }

  /** When the oldest forecast for these places was fetched. */
  fetchedAt(items: HitListItem[]): number | null {
    const times = items
      .filter((i) => i.lat != null && i.lng != null)
      .map((i) => this.entries.get(areaId(i.lat!, i.lng!)))
      .filter((e): e is Entry => !!e?.forecast)
      .map((e) => e.at);
    return times.length ? Math.min(...times) : null;
  }

  /** Read the file the background job writes. Only replaces areas it has newer forecasts for. */
  private async loadRemote() {
    this.remoteTried = true;
    try {
      const r = await fetch(`${REMOTE_URL}?t=${Math.floor(Date.now() / 300000)}`);
      if (!r.ok) return;
      const remote = (await r.json()) as Remote;
      const at = new Date(remote.fetched_at).getTime();
      for (const [id, a] of Object.entries(remote.areas)) {
        const mine = this.entries.get(id);
        const lacksHourly = !a.forecast.hourly && !!mine?.forecast?.hourly;
        if (!lacksHourly && (!mine || mine.at < at || (a.coastal && !mine.coastal))) this.entries.set(id, { forecast: a.forecast, coastal: a.coastal, at });
      }
      this.save();
    } catch {
      /* not there yet, or offline: live fetch covers it */
    }
  }

  /**
   * Make sure these places have a forecast: from the background job's file first, then live for
   * any area still missing or stale. `force` fetches every area live ("Update now").
   */
  async ensure(items: HitListItem[], force = false) {
    if (this.loading) {
      this.queued = { items, force: force || !!this.queued?.force };
      return;
    }
    this.loading = true;
    this.error = '';
    this.changed();
    if (!this.remoteTried && !force) {
      await this.loadRemote();
      this.changed();
    }

    // One representative point per area, preferring a coastal place so the marine forecast is at the sea.
    const areas = new Map<string, { lat: number; lng: number; coastal: boolean }>();
    for (const i of items) {
      if (i.lat == null || i.lng == null) continue;
      const id = areaId(i.lat, i.lng);
      const a = areas.get(id);
      if (!a) areas.set(id, { lat: i.lat, lng: i.lng, coastal: isCoastal(i) });
      else if (!a.coastal && isCoastal(i)) areas.set(id, { lat: i.lat, lng: i.lng, coastal: true });
    }
    const need = [...areas.entries()].filter(([id, a]) => {
      const e = this.entries.get(id);
      // Forecasts saved before AM/PM periods have no hourly weather: fetch those again.
      return force || !e?.forecast || !e.forecast.hourly || (a.coastal && !e.coastal) || Date.now() - e.at > STALE_MS;
    });

    if (need.length) {
      try {
        const results = await fetchForecasts(
          need.map(([, a]) => ({ lat: a.lat, lng: a.lng })),
          need.map(([, a]) => a.coastal),
        );
        const at = Date.now();
        need.forEach(([id, a], n) => {
          if (results[n]) this.entries.set(id, { forecast: results[n], coastal: a.coastal, at });
        });
        this.save();
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
    }
    this.loading = false;
    this.changed();
    const next = this.queued;
    this.queued = null;
    if (next) await this.ensure(next.items, next.force);
  }

  private save() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(this.entries)));
    } catch {
      /* full or private mode: it just won't be remembered */
    }
  }
}

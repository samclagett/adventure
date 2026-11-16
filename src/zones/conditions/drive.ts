import type { HitListItem } from '../shared/types';
import { distanceKm, distanceText, type Base } from './home';

/**
 * Drive times from a start point (usually home) to every hit list place.
 *
 * Comes from the free public OSRM router (OpenStreetMap roads, no key), asked once per start point
 * with one "table" request for up to 90 places, and saved on the phone so it's only asked again for
 * new places or a new home. If the router can't be reached, places fall back to straight-line distance.
 * OSRM's demo server asks for light use (about one request a second), which this easily stays under.
 */

const OSRM = 'https://router.project-osrm.org/table/v1/driving/';
const CACHE_KEY = 'adventure.drive.v1';
/** OSRM's demo server allows 100 points per table request; keep a margin. */
const CHUNK = 90;

export interface Drive {
  /** Minutes by car, or null when there's no road route (an island with no car ferry). */
  min: number | null;
  km: number | null;
}

type Cache = Record<string, Record<string, Drive>>;

const pt = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

let cache: Cache = {};
try {
  cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache;
} catch {
  /* nothing saved, or private mode */
}
const listeners: (() => void)[] = [];
const inFlight = new Set<string>();
/** Don't keep asking a router that just failed. */
let failedAt = 0;

function save() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* full or private mode */
  }
}

/** Run `cb` whenever new drive times arrive. */
export function onDriveChange(cb: () => void) {
  listeners.push(cb);
}

/** The saved drive from `from` to this place, if known. */
export function driveOf(from: Base, place: { lat: number; lng: number }): Drive | null {
  return cache[pt(from)]?.[pt(place)] ?? null;
}

/** Fetch drive times from `from` to any of these places not already known. Safe to call often. */
export async function ensureDrives(from: Base, items: HitListItem[]) {
  if (Date.now() - failedAt < 5 * 60 * 1000) return;
  const key = pt(from);
  const known = (cache[key] ??= {});
  const todo = [...new Map(
    items
      .filter((i) => i.lat != null && i.lng != null)
      .map((i) => ({ lat: i.lat!, lng: i.lng! }))
      .filter((p) => !known[pt(p)] && !inFlight.has(key + '>' + pt(p)))
      .map((p) => [pt(p), p] as const),
  ).values()];
  if (!todo.length) return;
  todo.forEach((p) => inFlight.add(key + '>' + pt(p)));
  try {
    for (let i = 0; i < todo.length; i += CHUNK) {
      const batch = todo.slice(i, i + CHUNK);
      // OSRM wants lng,lat; the start is point 0.
      const coords = [from, ...batch].map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
      const r = await fetch(`${OSRM}${coords}?sources=0&annotations=duration,distance`);
      if (!r.ok) throw new Error(`router said ${r.status}`);
      const j = (await r.json()) as { code: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
      if (j.code !== 'Ok' || !j.durations) throw new Error(j.code);
      batch.forEach((p, n) => {
        const s = j.durations![0][n + 1];
        const m = j.distances?.[0][n + 1] ?? null;
        known[pt(p)] = { min: s == null ? null : Math.round(s / 60), km: m == null ? null : Math.round(m / 1000) };
      });
      save();
      listeners.forEach((cb) => cb());
    }
  } catch (err) {
    failedAt = Date.now();
    console.warn('Drive times unavailable, showing straight-line distance', err);
  } finally {
    todo.forEach((p) => inFlight.delete(key + '>' + pt(p)));
  }
}

/** "1 h 40", "35 min", "9 h". */
export function minutesText(min: number): string {
  if (min < 60) return `${Math.max(5, Math.round(min / 5) * 5)} min`;
  const rounded = min < 240 ? Math.round(min / 5) * 5 : Math.round(min / 15) * 15;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/**
 * How far a place is, for a line of text: "1 h 40 drive" when the drive time is known, otherwise
 * straight-line km ("120 km").
 */
export function travelText(from: Base, place: { lat: number; lng: number }): string {
  const d = driveOf(from, place);
  if (d?.min != null) return `${minutesText(d.min)} drive`;
  return distanceText(distanceKm(from, place));
}

/** For sorting nearest first: drive minutes when known, otherwise straight-line km at about 80 km/h on the road. */
export function travelMinutes(from: Base, place: { lat: number; lng: number }): number {
  const d = driveOf(from, place);
  if (d?.min != null) return d.min;
  return (distanceKm(from, place) * 1.3 * 60) / 80;
}

import type { HitListItem } from '../shared/types';

/**
 * Snow depth at a ski resort's base and top (Sam, 2026-11-19), from Open-Meteo's snow depth at each
 * elevation (`settings.base` and `settings.top` on the place, in metres). It's a weather model's estimate,
 * not the resort's measured report. One request covers every resort; saved on the phone for 3 hours.
 */

const URL = 'https://api.open-meteo.com/v1/forecast';
const KEY = 'adventure.snow.v1';
const MAX_AGE = 3 * 60 * 60 * 1000;

interface Depth {
  /** Centimetres, or null when the model has none. */
  base: number | null;
  top: number | null;
  at: number;
}

let saved: Record<string, Depth> = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Depth>;
} catch {
  /* private mode */
}
let busy = false;
const listeners: (() => void)[] = [];

export function onSnowChange(cb: () => void) {
  listeners.push(cb);
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);

/** Base and top elevations for a resort, from its settings. */
function levels(item: HitListItem): [number | null, number | null] {
  const s = item.settings ?? {};
  return [num(s.base), num(s.top)];
}

/** Fetch snow depth for these ski places, unless saved recently. */
export async function ensureSnow(items: HitListItem[]) {
  const need = items.filter((i) => i.lat != null && i.lng != null && !(saved[i.id] && Date.now() - saved[i.id].at < MAX_AGE));
  if (!need.length || busy) return;
  busy = true;
  // Two points per resort: base, then top. Without elevations, the model's own height at the spot.
  const points = need.flatMap((i) => {
    const [b, t] = levels(i);
    return [
      { lat: i.lat!, lng: i.lng!, elev: b },
      { lat: i.lat!, lng: i.lng!, elev: t },
    ];
  });
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lng.toFixed(4)).join(','),
    hourly: 'snow_depth',
    timezone: 'Australia/Sydney',
    forecast_days: '1',
  });
  if (points.every((p) => p.elev != null)) q.set('elevation', points.map((p) => String(p.elev)).join(','));
  try {
    const r = await fetch(`${URL}?${q}`);
    if (r.ok) {
      const body = await r.json();
      const list = (Array.isArray(body) ? body : [body]) as { hourly?: { time: string[]; snow_depth: (number | null)[] } }[];
      const hour = new Date().toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' }).slice(0, 13).replace(' ', 'T');
      const depthOf = (n: number) => {
        const h = list[n]?.hourly;
        if (!h) return null;
        const i = Math.max(0, h.time.findIndex((t) => t.startsWith(hour)));
        const m = h.snow_depth[i];
        return m == null ? null : Math.round(m * 100);
      };
      need.forEach((item, n) => (saved[item.id] = { base: depthOf(n * 2), top: depthOf(n * 2 + 1), at: Date.now() }));
      try {
        localStorage.setItem(KEY, JSON.stringify(saved));
      } catch {
        /* private mode */
      }
    }
  } catch {
    /* offline: try again next time */
  }
  busy = false;
  listeners.forEach((cb) => cb());
}

const cm = (n: number | null) => (n == null ? '–' : n >= 100 ? `${(n / 100).toFixed(1)} m` : `${n} cm`);

/** A line for the place card: "Snow depth: base 45 cm · top 1.2 m (model estimate)". */
export function snowHtml(item: HitListItem): string {
  const d = saved[item.id];
  if (!d || Date.now() - d.at > MAX_AGE) void ensureSnow([item]);
  if (!d) return '<small class="cd-sum-dist">Snow depth: loading…</small>';
  const [b, t] = levels(item);
  const label = (name: string, elev: number | null) => `${name}${elev != null ? ` (${elev} m)` : ''}`;
  return `<small class="cd-sum-dist">Snow depth: ${label('base', b)} ${cm(d.base)} · ${label('top', t)} ${cm(d.top)}, model estimate</small>`;
}

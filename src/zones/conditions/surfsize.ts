import type { HourlyMarine, HourlyWind } from './openmeteo';
import { angDist, inRange } from './ratings';

/**
 * Estimated surf size at a beach, in body terms (waist to chest, head high...), from the model swell.
 * Design: doc "Surf size research and design" (2026-11-28). Three steps, per hour:
 *
 * 1. Breaking height of each part of the sea (main swell, second swell, local wind waves) from the
 *    Komar and Gaughan breaker formula, Hb = 0.39 g^0.2 (T H²)^0.4, so a longer period breaks bigger.
 * 2. Times how directly that part reaches the beach (its direction against the way the beach faces).
 *    Long-period swell wraps into corners more, so it loses less. The parts add up as energy
 *    (square root of the sum of squares), the same way the model's total wave height does.
 * 3. Times SET_FACTOR, because people call the sets (roughly the biggest tenth of waves), not the
 *    average the formula gives, then times what we've learned from reports ("What did you see?",
 *    surfreport.ts): a correction for all spots, and one per spot, both pulled towards 1 while reports are few.
 *
 * Checked against Sam's first report (Bronte, Sat 28 Nov 2026, 7am, "at least head high, very choppy"):
 * model 1.5 m total (1.2 m ENE swell at 6 s plus 0.8 m NE wind waves); this gives about 1.9 m face,
 * "head to overhead, choppy". Without reports it's an estimate, and the app always says so.
 */

const G = 9.81;
/** People report the sets, about 1.2 to 1.3 times the significant breaking height. */
export const SET_FACTOR = 1.2;

// ---- Body sizes (face height, metres) ----

export interface Band {
  id: string;
  /** "Chest to head" */
  label: string;
  /** Face heights it covers, m. */
  lo: number;
  hi: number;
  /** Middle, used when learning from a report. */
  mid: number;
  /** The body words at its bottom and top, for ranges like "waist to head". */
  from: string;
  to: string;
}

export const BANDS: Band[] = [
  { id: 'flat', label: 'Flat', lo: 0, hi: 0.3, mid: 0.15, from: 'flat', to: 'flat' },
  { id: 'ankle-knee', label: 'Ankle to knee', lo: 0.3, hi: 0.6, mid: 0.45, from: 'ankle', to: 'knee' },
  { id: 'knee-waist', label: 'Knee to waist', lo: 0.6, hi: 0.9, mid: 0.75, from: 'knee', to: 'waist' },
  { id: 'waist-chest', label: 'Waist to chest', lo: 0.9, hi: 1.2, mid: 1.05, from: 'waist', to: 'chest' },
  { id: 'chest-head', label: 'Chest to head', lo: 1.2, hi: 1.6, mid: 1.4, from: 'chest', to: 'head' },
  { id: 'head-overhead', label: 'Head to overhead', lo: 1.6, hi: 2.0, mid: 1.8, from: 'head', to: 'overhead' },
  { id: 'overhead', label: 'Overhead', lo: 2.0, hi: 2.6, mid: 2.3, from: 'overhead', to: 'well overhead' },
  { id: 'double', label: 'Double overhead', lo: 2.6, hi: 3.5, mid: 3.05, from: 'well overhead', to: 'double overhead' },
  { id: 'bigger', label: 'Bigger', lo: 3.5, hi: 99, mid: 4.0, from: 'double overhead', to: 'huge' },
];

export function bandOf(face: number): Band {
  return BANDS.find((b) => face < b.hi) ?? BANDS[BANDS.length - 1];
}

export const bandById = (id: string): Band | undefined => BANDS.find((b) => b.id === id);

/** "waist to head" for a spread of face heights; one band's label when they all sit in it. */
export function rangeText(faces: number[]): string {
  if (!faces.length) return '';
  const lo = bandOf(Math.min(...faces));
  const hi = bandOf(Math.max(...faces));
  if (lo === hi) return lo.label.toLowerCase();
  return lo.id === 'flat' ? `flat to ${hi.to}` : `${lo.from} to ${hi.to}`;
}

// ---- What the sea is doing in one hour ----

/** One part of the sea: height m, period s, from degrees. */
export type Part = [number, number, number | null];

/** The forecast for one hour, as saved with a report so it can be re-learned from later. */
export interface SeaInput {
  /** Model total wave height, m (used when the parts are missing, e.g. older saved forecasts). */
  total: number | null;
  swell: Part | null;
  second: Part | null;
  windWave: Part | null;
  /** Wind at the beach: km/h and from degrees. */
  wind: number | null;
  windDir: number | null;
}

const at = (list: (number | null)[] | undefined, i: number) => list?.[i] ?? null;

function part(h: number | null, t: number | null, d: number | null): Part | null {
  return h != null && h > 0.02 && t != null && t > 0 ? [h, t, d] : null;
}

/** Pick out hour `i` of the marine forecast (and the wind at that time, when given). */
export function inputAt(m: HourlyMarine, i: number, wind?: { speed: number | null; dir: number | null }): SeaInput {
  return {
    total: at(m.wave_height, i),
    swell: part(at(m.swell_wave_height, i), at(m.swell_wave_period, i), at(m.swell_wave_direction, i)),
    second: part(at(m.secondary_swell_wave_height, i), at(m.secondary_swell_wave_period, i), at(m.secondary_swell_wave_direction, i)),
    windWave: part(at(m.wind_wave_height, i), at(m.wind_wave_period, i), at(m.wind_wave_direction, i)),
    wind: wind?.speed ?? null,
    windDir: wind?.dir ?? null,
  };
}

/** Komar and Gaughan breaking height from deep-water height (m) and period (s). */
export function breaker(h: number, t: number): number {
  return 0.39 * G ** 0.2 * (t * h * h) ** 0.4;
}

/**
 * How much of a swell from `dir` reaches a beach facing `faces`: straight in 1.0, side-on about 0.5,
 * from behind 0.15 (wrap only). Long-period swell bends round more, so loses less (up to 40% of the gap at 19 s).
 */
export function exposure(dir: number | null, period: number, faces: number | null, swellFrom?: [number, number] | null): number {
  if (dir == null) return 1;
  let e = 1;
  if (faces != null) {
    const d = angDist(dir, faces);
    e = d <= 20 ? 1 : d <= 90 ? 1 - ((d - 20) / 70) * 0.5 : d <= 150 ? 0.5 - ((d - 90) / 60) * 0.3 : 0.15;
    const wrap = Math.min(0.4, Math.max(0, (period - 9) / 25));
    e += (1 - e) * wrap;
  }
  // A beach set up to only take swell from some directions (hit_list.settings.swellFrom) is sheltered from the rest.
  if (swellFrom && !inRange(dir, swellFrom)) e *= 0.4;
  return e;
}

/** Where a place is and its own settings, enough to estimate its surf. */
export interface SurfPlace {
  id?: string;
  faces: number | null;
  settings?: Record<string, unknown> | null;
}

const swellFromOf = (p: SurfPlace) => {
  const s = p.settings?.swellFrom;
  return Array.isArray(s) && s.length === 2 ? (s as [number, number]) : null;
};

/** Face height before anything learned from reports, m (sets, not average waves). */
export function rawFace(inp: SeaInput, faces: number | null, swellFrom: [number, number] | null = null): number | null {
  const parts = [inp.swell, inp.second, inp.windWave].filter((p): p is Part => p != null);
  // Older saved forecasts have only the total (see rawFaceOrTotal).
  if (!parts.length) return null;
  let energy = 0;
  for (const [h, t, d] of parts) energy += (breaker(h, t) * exposure(d, t, faces, swellFrom)) ** 2;
  let face = Math.sqrt(energy);
  // The parts can miss a small third swell the total includes; never read less than the parts say,
  // but if the total is bigger than the parts add up to, scale up a little towards it.
  const sumH = Math.sqrt(parts.reduce((a, [h]) => a + h * h, 0));
  if (inp.total != null && sumH > 0 && inp.total > sumH) face *= Math.min(1.2, inp.total / sumH);
  return face * SET_FACTOR;
}

/** Same as rawFace but falls back to the total height with the main swell's period and direction. */
function rawFaceOrTotal(inp: SeaInput, faces: number | null, swellFrom: [number, number] | null, period: number | null, dir: number | null): number | null {
  const r = rawFace(inp, faces, swellFrom);
  if (r != null) return r;
  if (inp.total == null || period == null) return null;
  return breaker(inp.total, period) * exposure(dir, period, faces, swellFrom) * SET_FACTOR;
}

// ---- Surface: clean, bumpy or choppy ----

export type Surface = 'clean' | 'bumpy' | 'choppy';

/** From the wind at the beach and how much short wind chop is coming in. */
export function surfaceOf(inp: SeaInput, faces: number | null): Surface | null {
  const ww = inp.windWave && (faces == null || inp.windWave[2] == null || angDist(inp.windWave[2], faces) <= 90) ? inp.windWave[0] : 0;
  if (inp.wind == null && !inp.windWave) return null;
  const s = inp.wind ?? 0;
  const d = faces != null && inp.windDir != null ? angDist(inp.windDir, faces) : 90;
  const rel = d <= 45 ? 'onshore' : d >= 135 ? 'offshore' : 'cross';
  if (ww >= 0.7 || (rel !== 'offshore' && s >= 20) || (rel === 'onshore' && s >= 15)) return 'choppy';
  if (ww >= 0.4 || (rel !== 'offshore' && s >= 10)) return 'bumpy';
  return 'clean';
}

// ---- Learning from reports ----

/** One "What did you see?" report. Mirrors the `surf_reports` table in supabase/schema.sql. */
export interface SurfReport {
  id: string;
  place_id: string | null;
  place_name: string;
  /** When the surf was seen. */
  seen_at: string;
  band: string;
  surface: Surface | null;
  note: string | null;
  who: string | null;
  /** The forecast for that hour, and the beach's facing then, so it can be re-learned if the maths changes. */
  forecast: { input: SeaInput; faces: number | null; swellFrom?: [number, number] | null } | null;
  /** The face height the app showed then, m. */
  estimate: number | null;
  created_at: string;
}

/** How many reports it takes before the learned correction counts for half (for all spots, and for one spot). */
const PRIOR_ALL = 4;
const PRIOR_SPOT = 2;
/** Only the latest reports per spot count, so it follows sandbanks moving. */
const RECENT = 20;

let reports: SurfReport[] = [];
let allFactor = 1;
const spotFactor = new Map<string, { factor: number; n: number }>();
const listeners: (() => void)[] = [];

/** Log of what was seen over what the maths alone says, or null when a report can't be used. */
function logRatio(r: SurfReport): number | null {
  const band = bandById(r.band);
  if (!band || !r.forecast) return null;
  const raw = rawFace(r.forecast.input, r.forecast.faces, r.forecast.swellFrom ?? null);
  if (raw == null || raw < 0.1) return null;
  return Math.max(-1.2, Math.min(1.2, Math.log(band.mid / raw)));
}

/** Load the reports (surfreport.ts) and work out the corrections. */
export function setReports(list: SurfReport[]) {
  reports = [...list].sort((a, b) => b.seen_at.localeCompare(a.seen_at));
  const all = reports.map(logRatio).filter((x): x is number => x != null);
  allFactor = Math.exp(all.reduce((a, b) => a + b, 0) / (all.length + PRIOR_ALL));
  spotFactor.clear();
  const byPlace = new Map<string, number[]>();
  for (const r of reports) {
    const lr = logRatio(r);
    if (lr == null || !r.place_id) continue;
    const list = byPlace.get(r.place_id) ?? [];
    if (list.length < RECENT) list.push(lr - Math.log(allFactor));
    byPlace.set(r.place_id, list);
  }
  for (const [id, list] of byPlace) spotFactor.set(id, { factor: Math.exp(list.reduce((a, b) => a + b, 0) / (list.length + PRIOR_SPOT)), n: list.length });
  listeners.forEach((fn) => fn());
}

export function reportsFor(placeId: string): SurfReport[] {
  return reports.filter((r) => r.place_id === placeId);
}

/** Redraw when reports load or change. */
export function onSurfChange(fn: () => void) {
  listeners.push(fn);
}

/** What multiplies the maths at this place, and how many of its own reports it's learned from. */
export function correctionFor(p: SurfPlace): { factor: number; n: number } {
  const manual = typeof p.settings?.surfFactor === 'number' ? (p.settings.surfFactor as number) : 1;
  const spot = (p.id && spotFactor.get(p.id)) || { factor: 1, n: 0 };
  return { factor: manual * allFactor * spot.factor, n: spot.n };
}

// ---- The estimate ----

export interface SurfEstimate {
  /** Face height, m (sets). */
  face: number;
  /** Before the learned correction, m. */
  raw: number;
  band: Band;
  /** "Chest to head" */
  label: string;
  surface: Surface | null;
}

/** Hourly wind by time, for matching with the marine hours (their lists start on different days). */
export function windByTime(w: HourlyWind | undefined): Map<string, { speed: number | null; dir: number | null }> {
  const out = new Map<string, { speed: number | null; dir: number | null }>();
  w?.time.forEach((t, i) => out.set(t, { speed: w.wind_speed_10m[i] ?? null, dir: w.wind_direction_10m[i] ?? null }));
  return out;
}

/**
 * The estimated surf at hour `i` of the marine forecast, at this place. `wind` is the place's hourly wind
 * (for clean or choppy); without it there's no surface word.
 */
export function surfAt(m: HourlyMarine, i: number, place: SurfPlace, wind?: Map<string, { speed: number | null; dir: number | null }>): SurfEstimate | null {
  const inp = inputAt(m, i, wind?.get(m.time[i]));
  const raw = rawFaceOrTotal(inp, place.faces, swellFromOf(place), at(m.swell_wave_period, i), at(m.swell_wave_direction, i));
  if (raw == null) return null;
  const face = raw * correctionFor(place).factor;
  const band = bandOf(face);
  return { face, raw, band, label: band.label, surface: surfaceOf(inp, place.faces) };
}

/** The usual surface over some hours (the rougher one on a tie). */
export function surfaceOver(list: SurfEstimate[]): Surface | null {
  const count = { clean: 0, bumpy: 0, choppy: 0 };
  for (const e of list) if (e.surface) count[e.surface]++;
  const best = (['choppy', 'bumpy', 'clean'] as Surface[]).sort((a, b) => count[b] - count[a])[0];
  return count[best] ? best : null;
}

/** "chest to head, choppy" over some hours. */
export function surfText(list: SurfEstimate[]): string {
  if (!list.length) return '';
  const s = surfaceOver(list);
  return `${rangeText(list.map((e) => e.face))}${s ? `, ${s}` : ''}`;
}

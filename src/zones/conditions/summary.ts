import type { Forecast, HourlyMarine, HourlyWeather, HourlyWind } from './openmeteo';
import { periodKind, type WeatherKind } from './weather-icons';

/**
 * Turns raw forecasts into what each category cares about: a short summary for the map bubble,
 * and day-by-day rows for the pin card. No swell on a mountain, no snow on a beach.
 */

export type WindowId = 'weekend' | '5days' | '2weeks';
export const WINDOWS: { id: WindowId; label: string; short: string }[] = [
  { id: 'weekend', label: 'This weekend', short: 'this weekend' },
  { id: '5days', label: 'Next 5 days', short: 'next 5 days' },
  { id: '2weeks', label: 'Next 2 weeks', short: 'next 2 weeks' },
];

// ---- Dates (all in Sydney time, like the forecasts) ----

/** Today's date in Sydney as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The days a window covers, from today. "This weekend" is Friday to Sunday, the same as the campsite
 * finder; from Friday on it's the rest of this weekend.
 */
export function daysFor(w: WindowId, today = todayIso()): string[] {
  if (w === 'weekend') {
    const day = parseIso(today).getUTCDay(); // 0 Sun … 6 Sat
    const fri = day === 6 ? addDays(today, -1) : day === 0 ? addDays(today, -2) : addDays(today, 5 - day);
    return [0, 1, 2].map((i) => addDays(fri, i)).filter((d) => d >= today);
  }
  const n = w === '5days' ? 5 : 14;
  return Array.from({ length: n }, (_, i) => addDays(today, i));
}

export function dayShort(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' });
}

export function dayLabel(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---- Small formatters ----

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

const round = (n: number) => Math.round(n);
const m1 = (n: number) => n.toFixed(1);

/** Hour of day (0–24, may be fractional) as "6am", "12:30pm". */
export function clock(h: number): string {
  const mins = Math.round(h * 60);
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const suffix = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${suffix}`;
}

/** WMO weather codes, as Open-Meteo gives them, in plain words. */
export function weatherWord(code: number | null): string {
  if (code == null) return '';
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61) return 'Light rain';
  if (code === 65) return 'Heavy rain';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Storms';
  return '';
}

// ---- One day, worked out from the forecast ----

export type Verdict = 'go' | 'mar' | 'skip' | 'na';
export const VERDICT_WORD: Record<Verdict, string> = { go: 'Go', mar: 'Marginal', skip: 'Skip', na: 'No data' };

export interface Tide {
  hour: number;
  type: 'High' | 'Low';
}

export interface SurfDay {
  verdict: Verdict;
  /** Model swell height range over daylight, metres. */
  swellMin: number;
  swellMax: number;
  period: number | null;
  swellDir: number | null;
  /** Best stretch of the day, as hours [start, end). */
  best: [number, number] | null;
  /** Average wind 6–9am and 1–4pm: [km/h, from degrees]. */
  am: [number, number] | null;
  pm: [number, number] | null;
  /** What the wind does at the beach in the best window (or the morning). */
  windRel: 'offshore' | 'cross-shore' | 'onshore' | null;
  tides: Tide[];
}

/** Part of a day: AM 6–11am, PM 12–8pm, and for camping the night (9pm to 5am next morning). */
export interface Period {
  id: 'am' | 'pm' | 'night';
  label: string;
  /** One symbol for the period, showing a mix when the hours differ. */
  kind: WeatherKind;
  /** Warmest for AM and PM, coldest for the night, °C. */
  temp: number | null;
  /** Total rain, mm. */
  rain: number | null;
  /** Highest chance of rain, %. */
  rainProb: number | null;
  /** Average wind, km/h, and where it comes from. */
  wind: number | null;
  windDir: number | null;
}

export const PERIODS: { id: Period['id']; label: string; from: number; to: number }[] = [
  { id: 'am', label: 'AM', from: 6, to: 11 },
  { id: 'pm', label: 'PM', from: 12, to: 20 },
  // Hours past 23 are the next morning.
  { id: 'night', label: 'Night', from: 21, to: 29 },
];

export interface Day {
  date: string;
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  rain: number | null;
  rainProb: number | null;
  wind: number | null;
  gust: number | null;
  windDir: number | null;
  snow: number | null;
  /** Average sea temperature, °C. */
  water: number | null;
  /** Swell for the day (any coastal category), and the full surf read for surf spots. */
  surf: SurfDay | null;
  /** AM and PM (and Night for camping). Empty when the forecast has no hourly weather. */
  periods: Period[];
}

/** Angle between two compass bearings, 0–180. */
function angDist(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Wind coming from `from` at a beach facing `faces`: from the sea is onshore, from the land is offshore. */
export function windRelation(from: number, faces: number): 'offshore' | 'cross-shore' | 'onshore' {
  const d = angDist(from, faces);
  if (d <= 45) return 'onshore';
  if (d >= 135) return 'offshore';
  return 'cross-shore';
}

/** Hourly values for one date, as [hour, value] pairs. */
function hoursOf(time: string[], values: (number | null)[], date: string): [number, number][] {
  const out: [number, number][] = [];
  time.forEach((t, i) => {
    if (t.startsWith(date) && values[i] != null) out.push([Number(t.slice(11, 13)), values[i]!]);
  });
  return out;
}

function avg(list: number[]): number | null {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

/** Average wind (speed, and direction averaged as a vector) over some hours of the day. */
function windOver(wind: HourlyWind, date: string, from: number, to: number): [number, number] | null {
  const speeds = hoursOf(wind.time, wind.wind_speed_10m, date).filter(([h]) => h >= from && h < to);
  const dirs = hoursOf(wind.time, wind.wind_direction_10m, date).filter(([h]) => h >= from && h < to);
  const s = avg(speeds.map(([, v]) => v));
  if (s == null || !dirs.length) return null;
  const x = avg(dirs.map(([, d]) => Math.sin((d * Math.PI) / 180)))!;
  const y = avg(dirs.map(([, d]) => Math.cos((d * Math.PI) / 180)))!;
  return [s, ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360];
}

/** High and low tide times, found as turning points in the hourly sea level (refined to the minute). */
export function tidesOn(marine: HourlyMarine, date: string): Tide[] {
  const out: Tide[] = [];
  const t = marine.time;
  const h = marine.sea_level_height_msl;
  for (let i = 1; i < t.length - 1; i++) {
    if (!t[i].startsWith(date) || h[i - 1] == null || h[i] == null || h[i + 1] == null) continue;
    const [a, b, c] = [h[i - 1]!, h[i]!, h[i + 1]!];
    const high = b >= a && b > c;
    const low = b <= a && b < c;
    if (!high && !low) continue;
    const denom = a - 2 * b + c;
    const shift = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    out.push({ hour: Number(t[i].slice(11, 13)) + shift, type: high ? 'High' : 'Low' });
  }
  return out;
}

/** Daylight hours we judge surf over. */
const FIRST_LIGHT = 5;
const LAST_LIGHT = 19;

/**
 * Read one day for a surf spot. A simple first pass at "good conditions", built on what Sam's surf report
 * weighed up: enough swell, light or offshore wind, and the best window in the day.
 */
function surfDay(marine: HourlyMarine | undefined, wind: HourlyWind | undefined, date: string, faces: number | null): SurfDay | null {
  if (!marine) return null;
  const swellH = hoursOf(marine.time, marine.swell_wave_height, date);
  const waveH = hoursOf(marine.time, marine.wave_height, date);
  const heights = new Map((swellH.length ? swellH : waveH).filter(([h]) => h >= FIRST_LIGHT && h <= LAST_LIGHT));
  if (!heights.size) return null;
  const periods = new Map(hoursOf(marine.time, marine.swell_wave_period, date));
  const dirs = new Map(hoursOf(marine.time, marine.swell_wave_direction, date));
  const speeds = wind ? new Map(hoursOf(wind.time, wind.wind_speed_10m, date)) : new Map<number, number>();
  const wdirs = wind ? new Map(hoursOf(wind.time, wind.wind_direction_10m, date)) : new Map<number, number>();

  const hs = [...heights.values()];
  const peakHour = [...heights.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const period = periods.get(peakHour) ?? null;
  const swellDir = dirs.get(peakHour) ?? null;

  // Score each daylight hour: 2 = good, 1 = surfable, 0 = no.
  const score = new Map<number, number>();
  for (const [hour, height] of heights) {
    const p = periods.get(hour) ?? 0;
    const size = height < 0.4 ? 0 : height < 0.7 && p < 8 ? 1 : height > 3 ? 1 : 2;
    const s = speeds.get(hour);
    const d = wdirs.get(hour);
    let w = 1;
    if (s != null) {
      const rel = faces != null && d != null ? windRelation(d, faces) : null;
      if (s < 10 || (rel === 'offshore' && s < 30)) w = 2;
      else if (s < 18 && rel !== 'onshore') w = 1;
      else if (s < 14) w = 1;
      else w = 0;
    }
    score.set(hour, Math.min(size, w));
  }

  // Best window: the longest run of good hours, else of surfable ones.
  const runOf = (min: number): [number, number] | null => {
    let best: [number, number] | null = null;
    let start: number | null = null;
    for (let h = FIRST_LIGHT; h <= LAST_LIGHT + 1; h++) {
      const ok = (score.get(h) ?? -1) >= min;
      if (ok && start == null) start = h;
      if (!ok && start != null) {
        if (!best || h - start > best[1] - best[0]) best = [start, h];
        start = null;
      }
    }
    return best;
  };
  const good = runOf(2);
  const fair = runOf(1);
  let verdict: Verdict = good && good[1] - good[0] >= 2 ? 'go' : fair ? 'mar' : 'skip';
  // A beach facing away from the swell won't get much of it.
  if (faces != null && swellDir != null && angDist(swellDir, faces) > 100) verdict = verdict === 'go' ? 'mar' : 'skip';
  const best = verdict === 'skip' ? null : good ?? fair;

  const am = wind ? windOver(wind, date, 6, 9) : null;
  const pm = wind ? windOver(wind, date, 13, 16) : null;
  const relAt = best && wind ? windOver(wind, date, best[0], best[1]) : am;
  const windRel = faces != null && relAt ? windRelation(relAt[1], faces) : null;

  return { verdict, swellMin: Math.min(...hs), swellMax: Math.max(...hs), period, swellDir, best, am, pm, windRel, tides: tidesOn(marine, date) };
}

/** Indexes into the hourly lists for `date` from hour `from` to hour `to` (inclusive; past 23 runs into the next day). */
function hourIndexes(time: string[], date: string, from: number, to: number): number[] {
  const start = time.indexOf(`${date}T00:00`);
  if (start < 0) return [];
  const out: number[] = [];
  for (let h = from; h <= to; h++) if (start + h < time.length) out.push(start + h);
  return out;
}

function periodsOf(h: HourlyWeather | undefined, date: string, category: string): Period[] {
  if (!h?.weather_code) return [];
  return PERIODS.filter((p) => p.id !== 'night' || category === 'camping')
    .map((p) => {
      const idx = hourIndexes(h.time, date, p.from, p.to);
      const nums = (list: (number | null)[]) => idx.map((i) => list[i]).filter((v): v is number => v != null);
      const codes = idx.map((i) => h.weather_code[i]);
      if (!codes.some((c) => c != null)) return null;
      const temps = nums(h.temperature_2m);
      const rain = nums(h.precipitation);
      const probs = nums(h.precipitation_probability);
      const speeds = nums(h.wind_speed_10m);
      const dirs = nums(h.wind_direction_10m);
      const x = avg(dirs.map((d) => Math.sin((d * Math.PI) / 180)));
      const y = avg(dirs.map((d) => Math.cos((d * Math.PI) / 180)));
      const period: Period = {
        id: p.id,
        label: p.label,
        kind: periodKind(codes, p.id === 'night'),
        temp: temps.length ? (p.id === 'night' ? Math.min(...temps) : Math.max(...temps)) : null,
        rain: rain.length ? rain.reduce((a, b) => a + b, 0) : null,
        rainProb: probs.length ? Math.max(...probs) : null,
        wind: avg(speeds),
        windDir: x != null && y != null ? ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 : null,
      };
      return period;
    })
    .filter((p): p is Period => p != null);
}

function marineHasData(m: HourlyMarine | undefined): boolean {
  return !!m && (m.wave_height ?? []).some((v) => v != null);
}

/** Work out each requested day for one place. Days beyond the forecast are left out. */
export function daysOf(f: Forecast, dates: string[], category: string, faces: number | null): Day[] {
  const d = f.daily;
  const marine = marineHasData(f.marine) ? f.marine : undefined;
  return dates
    .map((date) => {
      const i = d.time?.indexOf(date) ?? -1;
      if (i < 0) return null;
      const water = marine ? avg(hoursOf(marine.time, marine.sea_surface_temperature, date).map(([, v]) => v)) : null;
      const day: Day = {
        date,
        code: d.weather_code[i],
        tmax: d.temperature_2m_max[i],
        tmin: d.temperature_2m_min[i],
        rain: d.precipitation_sum[i],
        rainProb: d.precipitation_probability_max[i],
        wind: d.wind_speed_10m_max[i],
        gust: d.wind_gusts_10m_max[i],
        windDir: d.wind_direction_10m_dominant[i],
        snow: d.snowfall_sum[i],
        water,
        surf: marine ? surfDay(marine, f.hourly ?? f.hourlyWind, date, category === 'surfing' ? faces : null) : null,
        periods: periodsOf(f.hourly, date, category),
      };
      return day;
    })
    .filter((x): x is Day => x != null);
}

// ---- Window summary for the map bubble ----

const isWet = (day: Day) => (day.rain ?? 0) >= 1 || (day.rainProb ?? 0) >= 50;

function rainText(days: Day[]): string {
  const wet = days.filter(isWet);
  if (!wet.length) return 'dry';
  if (wet.length === days.length) return days.length === 1 ? 'rain' : 'rain every day';
  if (days.length <= 3) return `rain ${wet.map((x) => dayShort(x.date)).join(', ')}`;
  return `rain ${wet.length} of ${days.length} days`;
}

function range(values: (number | null)[], unit = ''): string {
  const v = values.filter((x): x is number => x != null).map(round);
  if (!v.length) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return lo === hi ? `${hi}${unit}` : `${lo}–${hi}${unit}`;
}

const maxOf = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};

const windText = (days: Day[]) => {
  const w = maxOf(days.map((d) => d.wind));
  return w == null ? '' : `wind to ${round(w)} km/h`;
};

function swellText(s: SurfDay): string {
  const size = s.swellMin.toFixed(1) === s.swellMax.toFixed(1) ? `${m1(s.swellMax)} m` : `${m1(s.swellMin)}–${m1(s.swellMax)} m`;
  return [size, s.period != null ? `${round(s.period)} s` : '', s.swellDir != null ? compass(s.swellDir) : ''].filter(Boolean).join(' ');
}

const RANK: Record<Verdict, number> = { go: 0, mar: 1, skip: 2, na: 3 };

export interface Bubble {
  /** Lines of text for the bubble, most important first. */
  lines: string[];
  /** One verdict per day (surf only), drawn as a little strip. */
  strip?: { date: string; verdict: Verdict }[];
  /** The best verdict in the window (surf only), used for the bubble's accent. */
  verdict?: Verdict;
}

export function bubbleFor(category: string, days: Day[], windowShort: string): Bubble | null {
  if (!days.length) return null;
  const rain = rainText(days);
  const temps = range(days.map((d) => d.tmax), '°');
  const wind = windText(days);
  switch (category) {
    case 'surfing': {
      const surf = days.filter((d) => d.surf);
      if (!surf.length) return { lines: ['No swell data here', wind] };
      const best = [...surf].sort((a, b) => RANK[a.surf!.verdict] - RANK[b.surf!.verdict])[0];
      const s = best.surf!;
      const head =
        s.verdict === 'skip' ? `Poor ${windowShort}` : `${VERDICT_WORD[s.verdict]} ${dayShort(best.date)}${s.best ? ` ${clock(s.best[0])}–${clock(s.best[1])}` : ''}`;
      return {
        lines: [head, `${swellText(s)}${s.windRel && s.verdict !== 'skip' ? ` · ${s.windRel}` : ''}`],
        strip: days.map((d) => ({ date: d.date, verdict: d.surf?.verdict ?? 'na' })),
        verdict: s.verdict,
      };
    }
    case 'diving': {
      const swell = maxOf(days.map((d) => d.surf?.swellMax ?? null));
      const water = maxOf(days.map((d) => d.water));
      return { lines: [[swell != null ? `swell to ${m1(swell)} m` : '', water != null ? `water ${round(water)}°` : ''].filter(Boolean).join(' · ') || rain, wind] };
    }
    case 'kayaking': {
      const swell = maxOf(days.map((d) => d.surf?.swellMax ?? null));
      return { lines: [wind, [rain, swell != null ? `swell to ${m1(swell)} m` : ''].filter(Boolean).join(' · ')] };
    }
    case 'camping': {
      const lows = days.map((d) => d.tmin).filter((x): x is number => x != null);
      return { lines: [lows.length ? `nights down to ${round(Math.min(...lows))}°` : rain, [rain, wind].filter(Boolean).join(' · ')] };
    }
    case 'climbing':
      return { lines: [rain === 'dry' ? 'dry rock' : rain, [temps, wind].filter(Boolean).join(' · ')] };
    case 'skiing': {
      const snow = days.reduce((a, d) => a + (d.snow ?? 0), 0);
      return { lines: [snow >= 1 ? `${round(snow)} cm new snow` : 'no new snow', [range(days.map((d) => d.tmax), '°'), wind].filter(Boolean).join(' · ')] };
    }
    default:
      return { lines: [[temps, rain].filter(Boolean).join(' · '), wind] };
  }
}

// ---- Day-by-day rows for the pin card ----

export interface Row {
  date: string;
  /** Short cells, shown in order. */
  cells: string[];
  /** A second, quieter line (tides, best time). */
  extra?: string;
  verdict?: Verdict;
}

const windCell = (d: Day) => (d.wind != null ? `${d.windDir != null ? `${compass(d.windDir)} ` : ''}${round(d.wind)} km/h` : '');
const rainCell = (d: Day) => (d.rain != null ? `${(d.rain ?? 0) < 0.5 ? 'dry' : `${round(d.rain)} mm`}${d.rainProb != null && (d.rain ?? 0) >= 0.5 ? ` (${d.rainProb}%)` : ''}` : '');
const tempCell = (d: Day) => (d.tmin != null && d.tmax != null ? `${round(d.tmin)}–${round(d.tmax)}°` : '');

export function rowsFor(category: string, days: Day[]): Row[] {
  return days.map((d) => {
    const label = dayLabel(d.date);
    if (category === 'surfing' && d.surf) {
      const s = d.surf;
      const amPm = [s.am ? `am ${compass(s.am[1])} ${round(s.am[0])}` : '', s.pm ? `pm ${compass(s.pm[1])} ${round(s.pm[0])}` : ''].filter(Boolean).join(', ');
      const tides = s.tides.map((t) => `${t.type === 'High' ? 'H' : 'L'} ${clock(t.hour)}`).join(' · ');
      const best = s.best ? `Best ${clock(s.best[0])}–${clock(s.best[1])}${s.windRel ? `, ${s.windRel}` : ''}` : '';
      return {
        date: d.date,
        verdict: s.verdict,
        // With AM/PM periods the wind shows there, by the weather.
        cells: [label, VERDICT_WORD[s.verdict], swellText(s), d.periods.length ? '' : amPm ? `${amPm} km/h` : windCell(d)],
        extra: [best, tides ? `Tides ${tides}` : ''].filter(Boolean).join(' · '),
      };
    }
    if (category === 'skiing') {
      const snow = d.snow != null && d.snow >= 0.5 ? `${round(d.snow)} cm snow` : 'no snow';
      return { date: d.date, cells: d.periods.length ? [label, tempCell(d), snow] : [label, weatherWord(d.code), tempCell(d), snow, windCell(d)] };
    }
    const cells = d.periods.length ? [label, tempCell(d)] : [label, weatherWord(d.code), tempCell(d), rainCell(d), windCell(d)];
    if ((category === 'diving' || category === 'kayaking') && d.surf) cells.push(`swell ${swellText(d.surf)}`);
    return { date: d.date, cells };
  });
}

// ---- Ratings for every category ----

/**
 * A first, simple idea of "good conditions" per activity (agreed starting point, 2026-11-16; tune later).
 * Each rule that isn't met adds a reason and lowers the verdict: one strike makes a day marginal,
 * a hard limit makes it a skip. Surf uses its own hour-by-hour read (surfDay).
 */
interface Check {
  /** True when the condition is bad enough to skip. */
  skip?: boolean;
  /** True when it makes the day marginal. */
  mar?: boolean;
  why: string;
}

function checksFor(category: string, d: Day): Check[] {
  const rain = d.rain ?? 0;
  const prob = d.rainProb ?? 0;
  const wind = d.wind ?? 0;
  const hot = d.tmax ?? 0;
  const swell = d.surf?.swellMax ?? null;
  const wet: Check = { skip: rain >= 5 || prob >= 80, mar: rain >= 1 || prob >= 50, why: rain >= 1 ? `${Math.round(rain)} mm rain` : `${prob}% chance of rain` };
  const windy = (mar: number, skip: number): Check => ({ skip: wind >= skip, mar: wind >= mar, why: `wind ${Math.round(wind)} km/h` });
  const heat: Check = { skip: hot >= 38, mar: hot >= 32, why: `${Math.round(hot)}°` };
  const sea = (mar: number, skip: number): Check => ({ skip: swell != null && swell >= skip, mar: swell != null && swell >= mar, why: `swell ${swell?.toFixed(1)} m` });
  switch (category) {
    case 'climbing':
      return [{ skip: rain >= 1 || prob >= 60, mar: prob >= 30, why: rain >= 1 ? 'wet rock' : `${prob}% chance of rain` }, windy(30, 45), { skip: hot >= 36, mar: hot >= 30, why: `${Math.round(hot)}°` }];
    case 'camping':
      return [wet, windy(30, 45), { skip: (d.tmin ?? 10) < 0, mar: (d.tmin ?? 10) < 5, why: `night ${Math.round(d.tmin ?? 0)}°` }, heat];
    case 'kayaking':
      return [windy(15, 25), { skip: rain >= 15, mar: rain >= 5, why: `${Math.round(rain)} mm rain` }, sea(1, 1.5)];
    case 'diving':
      return [windy(15, 25), sea(1, 1.5), { mar: rain >= 10, why: 'heavy rain (runoff)' }];
    case 'canyoning':
      // Rain is the big one: canyons flash-flood. Cold days make the water swims hard work.
      return [
        { skip: rain >= 10 || prob >= 70, mar: rain >= 2 || prob >= 40, why: rain >= 2 ? `${Math.round(rain)} mm rain (flood risk)` : `${prob}% chance of rain (flood risk)` },
        { mar: (d.tmax ?? 25) < 18, why: `only ${Math.round(d.tmax ?? 0)}° (cold swims)` },
        heat,
      ];
    case 'skiing': {
      const snow = d.snow ?? 0;
      return [{ skip: snow < 1 && hot > 8, mar: snow < 5, why: snow >= 1 ? `only ${Math.round(snow)} cm new snow` : 'no new snow' }, windy(35, 55)];
    }
    default:
      return [wet, windy(30, 45), heat];
  }
}

export interface Rated {
  verdict: Verdict;
  /** Why it isn't a go, shortest first. */
  why: string[];
}

export function rateDay(category: string, d: Day): Rated {
  if (category === 'surfing') {
    if (!d.surf) return { verdict: 'na', why: ['no swell data'] };
    return { verdict: d.surf.verdict, why: [] };
  }
  if (d.tmax == null && d.wind == null) return { verdict: 'na', why: ['no forecast'] };
  const checks = checksFor(category, d);
  // Storms are a worry for everything outdoors; any rain makes rock slippery.
  const code = d.code ?? 0;
  if (code >= 95) checks.push({ mar: true, why: 'storms' });
  if (category === 'climbing' && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) checks.push({ mar: true, why: 'showers' });
  const skips = checks.filter((c) => c.skip).map((c) => c.why);
  const mars = checks.filter((c) => !c.skip && c.mar).map((c) => c.why);
  return { verdict: skips.length ? 'skip' : mars.length ? 'mar' : 'go', why: [...skips, ...mars] };
}

export interface Option {
  verdict: Verdict;
  /** The best day in the window, if any are better than skip. */
  bestDate: string | null;
  /** How many days in the window are a go. */
  goDays: number;
  /** One line for the list, e.g. "Go Sat 6–9am · 1.1 m 8 s SSE · offshore". */
  headline: string;
  /** A second, quieter line on how the window changes. */
  detail: string;
  /** One verdict per day, for the strip. */
  strip: { date: string; verdict: Verdict }[];
}

/** Rate a place over a window: its best day, how many days are good, and a short summary. */
export function rateWindow(category: string, days: Day[]): Option | null {
  if (!days.length) return null;
  const rated = days.map((d) => ({ d, r: rateDay(category, d) }));
  const best = [...rated].sort((a, b) => RANK[a.r.verdict] - RANK[b.r.verdict])[0];
  const goDays = rated.filter((x) => x.r.verdict === 'go').length;
  const strip = rated.map((x) => ({ date: x.d.date, verdict: x.r.verdict }));
  const v = best.r.verdict;
  const when = dayShort(best.d.date);
  let headline: string;
  if (category === 'surfing' && best.d.surf) {
    const s = best.d.surf;
    headline = v === 'skip' ? 'Poor all window' : `${VERDICT_WORD[v]} ${when}${s.best ? ` ${clock(s.best[0])}–${clock(s.best[1])}` : ''} · ${swellText(s)}${s.windRel ? ` · ${s.windRel}` : ''}`;
  } else if (v === 'skip' || v === 'na') {
    headline = `Poor all window${best.r.why[0] ? ` (${best.r.why[0]})` : ''}`;
  } else {
    const d = best.d;
    const bits = [weatherWord(d.code).toLowerCase(), d.tmax != null ? `${Math.round(d.tmax)}°` : '', d.wind != null ? `wind ${Math.round(d.wind)} km/h` : ''];
    if (category === 'skiing' && (d.snow ?? 0) >= 1) bits.unshift(`${Math.round(d.snow!)} cm new snow`);
    if (category === 'camping' && d.tmin != null) bits.push(`night ${Math.round(d.tmin)}°`);
    headline = `${VERDICT_WORD[v]} ${when} · ${bits.filter(Boolean).join(', ')}`;
  }
  // How it changes: name the good days, and the main problem on the others.
  let detail = '';
  if (days.length > 1) {
    const good = rated.filter((x) => x.r.verdict === 'go').map((x) => dayShort(x.d.date));
    const bad = rated.filter((x) => x.r.verdict === 'skip' && x.r.why[0]);
    const parts: string[] = [];
    if (good.length) parts.push(good.length === days.length ? 'good every day' : `good ${good.slice(0, 4).join(', ')}${good.length > 4 ? '…' : ''}`);
    if (bad.length) parts.push(`${bad[0].r.why[0]} ${dayShort(bad[0].d.date)}`);
    detail = parts.join('; ');
  }
  return { verdict: v, bestDate: v === 'skip' || v === 'na' ? null : best.d.date, goDays, headline, detail, strip };
}

export const verdictRank = (v: Verdict) => RANK[v];

// ---- Sea for part of a day (the conditions table, matrix.ts) ----

export interface PeriodSea {
  /** Highest swell over the period, m (wave height where there's no swell figure). */
  swell: number | null;
  /** Swell period at that peak, seconds. */
  swellPeriod: number | null;
  /** Where the swell comes from, degrees. */
  swellDir: number | null;
  /** High and low tides within the period. */
  tides: Tide[];
}

/** Swell and tides for one part of a day (AM 6–11am, PM 12–8pm, Night 9pm–5am). */
export function seaFor(f: Forecast, date: string, id: Period['id']): PeriodSea | null {
  const m = marineHasData(f.marine) ? f.marine! : null;
  if (!m) return null;
  const p = PERIODS.find((x) => x.id === id)!;
  const idx = hourIndexes(m.time, date, p.from, p.to);
  const swellList = m.swell_wave_height.some((v) => v != null) ? m.swell_wave_height : m.wave_height;
  let peak = -1;
  idx.forEach((i) => {
    if (swellList[i] != null && (peak < 0 || swellList[i]! > swellList[peak]!)) peak = i;
  });
  const tides = [...tidesOn(m, date), ...tidesOn(m, nextDay(date)).map((t) => ({ ...t, hour: t.hour + 24 }))]
    .filter((t) => t.hour >= p.from && t.hour < p.to + 1);
  if (peak < 0) return { swell: null, swellPeriod: null, swellDir: null, tides };
  return { swell: swellList[peak], swellPeriod: m.swell_wave_period[peak], swellDir: m.swell_wave_direction[peak], tides };
}

function nextDay(iso: string): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

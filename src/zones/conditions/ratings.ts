import { RAIN, type Rules } from './rules';
import type { Day, Hour, Verdict } from './summary';

/**
 * Rates one day for one activity: green (go), orange (marginal) or red (skip), with the reasons, and any
 * alerts that sit beside the rating without changing its colour (wet sandstone, rain in a canyon's catchment,
 * and later fire danger and park closures). The numbers all come from rules.ts.
 */

export type AlertKind = 'fire' | 'closure' | 'rain' | 'river' | 'snow';

export interface Alert {
  kind: AlertKind;
  /** Short words, e.g. "Wet sandstone: 14 mm yesterday". */
  text: string;
  /** Dates (YYYY-MM-DD) it applies to. Unset = every day. */
  on?: string[];
  /** Where to read more. */
  link?: string;
}

export interface Rated {
  verdict: Verdict;
  /** Why it isn't a go, worst first. */
  why: string[];
  alerts: Alert[];
}

/** One strike against a day: `skip` makes it red, otherwise orange. */
interface Strike {
  skip: boolean;
  why: string;
}

const r0 = (n: number) => Math.round(n);

/** Hour of day as "6am" or "2pm" (past 24 is the next morning). */
function hourText(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? 'am' : 'pm'}`;
}

/** Rainy hours as spans: "2–4pm", "6am, 3–5pm". */
function spansText(hours: number[]): string {
  const spans: [number, number][] = [];
  for (const h of hours) {
    const last = spans[spans.length - 1];
    if (last && h === last[1]) last[1] = h + 1;
    else spans.push([h, h + 1]);
  }
  return spans
    .slice(0, 3)
    .map(([a, b]) => (b - a === 1 ? hourText(a) : `${hourText(a).replace(/am|pm/, (s) => (hourText(b).endsWith(s) ? '' : s))}–${hourText(b)}`))
    .join(', ');
}

/** What the weather does over the hours that count for an activity. */
interface Stats {
  /** How many hours there are forecasts for. */
  n: number;
  /** Total rain, mm, and the wettest hour. */
  mm: number;
  maxHour: number;
  /** Hours with rain (at least RAIN.wetHourMm). */
  rainy: number[];
  /** Highest chance of rain, %. */
  prob: number;
  tmin: number | null;
  tmax: number | null;
  /** Strongest hourly wind, km/h. */
  wind: number | null;
  /** Highest weather code (95+ is thunderstorms, 96 and 99 with hail). */
  code: number;
  rain: 'dry' | 'chance' | 'some' | 'allday';
}

function statsOf(d: Day, [from, to]: [number, number]): Stats {
  const w = d.hrs.filter((x) => x.h >= from && x.h < to);
  if (!w.length) return dailyStats(d);
  const nums = (pick: (x: Hour) => number | null) => w.map(pick).filter((v): v is number => v != null);
  const rains = nums((x) => x.rain);
  const temps = nums((x) => x.temp);
  const winds = nums((x) => x.wind);
  const rainy = w.filter((x) => (x.rain ?? 0) >= RAIN.wetHourMm).map((x) => x.h);
  const mm = rains.reduce((a, b) => a + b, 0);
  const prob = Math.max(0, ...nums((x) => x.prob));
  const allDay = rainy.length >= RAIN.allDayShare * w.length && mm >= RAIN.allDayMm;
  return {
    n: w.length,
    mm,
    maxHour: Math.max(0, ...rains),
    rainy,
    prob,
    tmin: temps.length ? Math.min(...temps) : null,
    tmax: temps.length ? Math.max(...temps) : null,
    wind: winds.length ? Math.max(...winds) : null,
    code: Math.max(0, ...nums((x) => x.code)),
    rain: allDay ? 'allday' : rainy.length ? 'some' : prob >= RAIN.chancePct ? 'chance' : 'dry',
  };
}

/** For forecasts saved without hour-by-hour weather: the day's totals. */
function dailyStats(d: Day): Stats {
  const mm = d.rain ?? 0;
  const prob = d.rainProb ?? 0;
  return {
    n: 0,
    mm,
    maxHour: mm,
    rainy: [],
    prob,
    tmin: d.tmin,
    tmax: d.tmax,
    wind: d.wind,
    code: d.code ?? 0,
    rain: mm >= 10 ? 'allday' : mm >= RAIN.wetHourMm ? 'some' : prob >= RAIN.chancePct ? 'chance' : 'dry',
  };
}

const rainWords = (s: Stats) =>
  s.rain === 'allday' ? `rain all day (${r0(s.mm)} mm)` : s.rain === 'some' ? `rain ${spansText(s.rainy) || ''}${s.mm >= 1 ? ` (${r0(s.mm)} mm)` : ''}`.trim() : `${s.prob}% chance of rain`;

/** Temperature against a green band, an optional orange band, and an optional red-above limit. */
function tempStrikes(t: number | null, r: Rules, label = ''): Strike[] {
  if (t == null || !r.tempGreen) return [];
  const [gLo, gHi] = r.tempGreen;
  if (t >= gLo && t <= gHi && (r.tempRedAbove == null || t <= r.tempRedAbove)) return [];
  const why = `${label}${r0(t)}°`;
  if (r.tempRedAbove != null && t > r.tempRedAbove) return [{ skip: true, why }];
  if (r.tempOrange) {
    const [oLo, oHi] = r.tempOrange;
    return [{ skip: t < oLo || t > oHi, why }];
  }
  return [{ skip: false, why }];
}

function windStrikes(w: number | null, r: Rules): Strike[] {
  if (w == null) return [];
  const why = `wind ${r0(w)} km/h`;
  if (r.windRedAbove != null && w > r.windRedAbove) return [{ skip: true, why }];
  if (r.windGreen == null || w <= r.windGreen) return [];
  return [{ skip: r.windOrange != null && w > r.windOrange, why }];
}

/** Thunderstorms: orange for everything outdoors, red with hail. */
function stormStrikes(s: Stats): Strike[] {
  if (s.code >= 96) return [{ skip: true, why: 'severe storms' }];
  if (s.code >= 95) return [{ skip: false, why: 'storms' }];
  return [];
}

/** Total of the last `n` days' values (index 0 is yesterday). Null when the forecast has no past days. */
function pastSum(list: (number | null)[], n: number): number | null {
  const v = list.slice(0, n);
  if (!v.length || v.every((x) => x == null)) return null;
  return v.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** Angle between two compass bearings, 0–180. */
export function angDist(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Whether a direction is inside a clockwise range [from, to]. */
export function inRange(dir: number, [from, to]: [number, number]): boolean {
  const d = ((dir % 360) + 360) % 360;
  const a = ((from % 360) + 360) % 360;
  const b = ((to % 360) + 360) % 360;
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** A river's height as an alert line: "Colo River at Upper Colo 0.79 m, steady". */
function riverAlert(r: { name: string; level: number; trend: string | null }): Alert {
  return { kind: 'river', text: `${r.name} ${r.level.toFixed(2)} m${r.trend ? `, ${r.trend}` : ''}` };
}

function strikesFor(category: string, d: Day, r: Rules, alerts: Alert[]): Strike[] {
  const s = statsOf(d, r.hours);
  switch (category) {
    case 'camping': {
      // Night only: the low and the high through the night both count.
      const out: Strike[] = [];
      if (s.rain === 'allday') out.push({ skip: true, why: rainWords(s) });
      else if (s.rain !== 'dry') out.push({ skip: false, why: rainWords(s) });
      out.push(...tempStrikes(s.tmin, r, 'night low '));
      if (s.tmax != null && s.tmax > (r.tempGreen?.[1] ?? 99)) out.push(...tempStrikes(s.tmax, r, 'night '));
      out.push(...windStrikes(s.wind, r), ...stormStrikes(s));
      return out;
    }
    case 'climbing': {
      const out: Strike[] = [];
      // Real rain (an hour of 0.5 mm or more, or two rainy hours) is more than 30 minutes of it: red.
      if (s.maxHour >= RAIN.realRainHourMm || s.rainy.length >= 2) out.push({ skip: true, why: rainWords(s) });
      else if (s.rain !== 'dry') out.push({ skip: false, why: s.rainy.length ? `drizzle ${spansText(s.rainy)}` : rainWords(s) });
      out.push(...tempStrikes(s.tmax, r), ...windStrikes(s.wind, r), ...stormStrikes(s));
      if (r.rock === 'sandstone' && r.sandstoneRainDayBefore != null) {
        const y = d.prevRain[0];
        if (y != null && y >= r.sandstoneRainDayBefore) {
          out.push({ skip: false, why: 'wet sandstone' });
          alerts.push({ kind: 'rain', text: `Wet sandstone: ${r0(y)} mm the day before` });
        }
      }
      return out;
    }
    case 'canyoning': {
      const out: Strike[] = [];
      // Showers or slight drizzle (say when) are orange; more than that (say how much) is red.
      if (s.mm > (r.showersMaxMm ?? 3) || s.rain === 'allday') out.push({ skip: true, why: `${r0(s.mm)} mm rain due` });
      else if (s.rainy.length) out.push({ skip: false, why: `showers ${spansText(s.rainy)}` });
      else if (s.rain === 'chance') out.push({ skip: false, why: `${s.prob}% chance of showers` });
      out.push(...tempStrikes(s.tmax, r), ...stormStrikes(s));
      if (d.riverNote) alerts.push(riverAlert(d.riverNote));
      const before = pastSum(d.prevRain, r.catchmentDays ?? 3);
      if (before != null && before >= (r.catchmentAlertMm ?? 25))
        alerts.push({ kind: 'rain', text: `${r0(before)} mm in the catchment over the ${r.catchmentDays ?? 3} days before: check water levels` });
      return out;
    }
    case 'diving': {
      const out: Strike[] = [];
      const sea = d.sea.filter((x) => x.h >= r.hours[0] && x.h < r.hours[1] && x.swell != null);
      if (sea.length) {
        // Swell from a direction the site is sheltered from counts for less.
        const eff = Math.max(...sea.map((x) => x.swell! * (r.swellFrom && x.dir != null && !inRange(x.dir, r.swellFrom) ? r.shelteredFactor ?? 0.5 : 1)));
        if (eff > (r.swellMax ?? 1)) out.push({ skip: true, why: `swell ${eff.toFixed(1)} m (limit ${r.swellMax} m)` });
      }
      // Wind chop, unless it's blowing offshore.
      const offshore = d.faces != null && d.windDir != null && angDist(d.windDir, d.faces) >= 135;
      if (s.wind != null && s.wind > (r.windGreen ?? 15) && !offshore) out.push({ skip: false, why: `wind chop (${r0(s.wind)} km/h)` });
      const rain48 = pastSum(d.prevRain, 2);
      if (rain48 != null && rain48 >= (r.rain48Red ?? 30)) out.push({ skip: true, why: `${r0(rain48)} mm rain in the last 48 h (murky)` });
      else if (rain48 != null && rain48 >= (r.rain48Orange ?? 10)) out.push({ skip: false, why: `${r0(rain48)} mm rain in the last 48 h` });
      out.push(...stormStrikes(s));
      return out;
    }
    case 'kayaking': {
      // Mainly the river height, against the levels set for this river. Rain and wind count too.
      const out: Strike[] = [];
      const river = d.river;
      if (river && r.levelGreen) {
        const [gLo, gHi] = r.levelGreen;
        const [oLo, oHi] = r.levelOrange ?? r.levelGreen;
        const v = river.level;
        if (v < gLo || v > gHi) out.push({ skip: v < oLo || v > oHi, why: `river ${v < gLo ? 'low' : 'high'} (${v.toFixed(2)} m)` });
      }
      if (river && /minor|moderate|major/i.test(river.flood ?? '')) out.push({ skip: true, why: `river in flood (${river.flood})` });
      if (s.rain === 'allday') out.push({ skip: true, why: rainWords(s) });
      else if (s.rain === 'some' && s.mm >= 2) out.push({ skip: false, why: rainWords(s) });
      out.push(...windStrikes(s.wind, r), ...stormStrikes(s));
      if (d.riverNote) alerts.push(riverAlert(d.riverNote));
      return out;
    }
    default: {
      // Hiking, and anything else.
      const out: Strike[] = [];
      if (s.rain === 'allday') out.push({ skip: true, why: rainWords(s) });
      else if (s.rain !== 'dry') out.push({ skip: false, why: rainWords(s) });
      out.push(...tempStrikes(s.tmax, r), ...windStrikes(s.wind, r), ...stormStrikes(s));
      return out;
    }
  }
}

/** Skiing is just a snow alert: fresh snow on the day is green, snow in the last few days orange, none red. */
function rateSkiing(d: Day, r: Rules): Rated {
  const fresh = d.snow ?? 0;
  if (fresh > (r.freshSnowGreen ?? 2)) return { verdict: 'go', why: [], alerts: [{ kind: 'snow', text: `${r0(fresh)} cm fresh snow` }] };
  const recent = pastSum(d.prevSnow, r.recentDays ?? 5);
  if (recent != null && recent >= (r.recentSnowOrange ?? 2)) return { verdict: 'mar', why: [`${r0(recent)} cm in the last ${r.recentDays ?? 5} days`], alerts: [] };
  return { verdict: 'skip', why: ['no snow'], alerts: [] };
}

export function rateDay(category: string, d: Day): Rated {
  const alerts = [...d.alerts];
  if (category === 'surfing') {
    if (!d.surf) return { verdict: 'na', why: ['no swell data'], alerts };
    return { verdict: d.surf.verdict, why: d.surf.why, alerts };
  }
  if (d.tmax == null && d.wind == null) return { verdict: 'na', why: ['no forecast'], alerts };
  if (category === 'skiing') {
    const r = rateSkiing(d, d.rules);
    return { ...r, alerts: [...alerts, ...r.alerts] };
  }
  const strikes = strikesFor(category, d, d.rules, alerts);
  const skips = strikes.filter((c) => c.skip).map((c) => c.why);
  const mars = strikes.filter((c) => !c.skip).map((c) => c.why);
  return { verdict: skips.length ? 'skip' : mars.length ? 'mar' : 'go', why: [...skips, ...mars], alerts };
}

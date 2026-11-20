import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { Forecast } from './openmeteo';
import { clock, daysOf, tidesOn, todayIso, windRelation, type Tide } from './summary';
import { WEATHER_ICONS, weatherKind, type WeatherKind } from './weather-icons';

/**
 * The hour-by-hour chart on a place card, for one day. It scrolls sideways, an hour per column.
 *
 * - Surf spots and dive sites (Sam, 2026-11-20, "like WillyWeather"): swell as paper bars with their height,
 *   the tide as a line over them with high and low times, swell direction and period underneath, and the
 *   wind along the top (coloured offshore / cross-shore / onshore at a surf beach that knows its facing).
 * - Everything else ("like Apple Weather"): a weather symbol each hour, temperature as a line, rain as bars
 *   with millimetres and the chance of rain, and the wind. Camping runs from midday to 10am the next morning,
 *   so the night is in one view; kayaking on the coast adds the tide.
 * Night hours are shaded (sunrise and sunset worked out here), and today has a line at the current hour.
 * Times are Sydney time, like the forecast.
 */

const HOUR_W = 44;
const SEA_CHART = new Set(['surfing', 'diving']);

interface ChartHour {
  /** Hours from midnight of the chosen day; 24 and up are the next morning. */
  h: number;
  code: number | null;
  temp: number | null;
  rain: number | null;
  prob: number | null;
  wind: number | null;
  gust: number | null;
  dir: number | null;
  swell: number | null;
  period: number | null;
  swellDir: number | null;
  tide: number | null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The hours [from, to) of one day, read straight from the forecast. */
function hoursOf(f: Forecast, date: string, from: number, to: number): ChartHour[] {
  const w = f.hourly;
  const m = f.marine;
  const wi = w?.time?.indexOf(`${date}T00:00`) ?? -1;
  const mi = m?.time?.indexOf(`${date}T00:00`) ?? -1;
  const swellList = m && m.swell_wave_height.some((v) => v != null) ? m.swell_wave_height : m?.wave_height;
  const out: ChartHour[] = [];
  for (let h = from; h < to; h++) {
    const i = wi >= 0 && wi + h < (w?.time.length ?? 0) ? wi + h : -1;
    const j = mi >= 0 && mi + h < (m?.time.length ?? 0) ? mi + h : -1;
    if (i < 0 && j < 0) break;
    out.push({
      h,
      code: i >= 0 ? w!.weather_code[i] : null,
      temp: i >= 0 ? w!.temperature_2m[i] : null,
      rain: i >= 0 ? w!.precipitation[i] : null,
      prob: i >= 0 ? w!.precipitation_probability[i] : null,
      wind: i >= 0 ? w!.wind_speed_10m[i] : null,
      gust: i >= 0 ? w!.wind_gusts_10m?.[i] ?? null : null,
      dir: i >= 0 ? w!.wind_direction_10m[i] : null,
      swell: j >= 0 ? swellList![j] : null,
      period: j >= 0 ? m!.swell_wave_period[j] : null,
      swellDir: j >= 0 ? m!.swell_wave_direction[j] : null,
      tide: j >= 0 ? m!.sea_level_height_msl[j] : null,
    });
  }
  return out;
}

/** Sunrise and sunset in Sydney time (hours from midnight), from the standard NOAA approximation. */
export function sunTimes(date: string, lat: number, lng: number): [number, number] | null {
  const [y, mo, d] = date.split('-').map(Number);
  const start = Date.UTC(y, 0, 1);
  const n = Math.round((Date.UTC(y, mo - 1, d) - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const rad = (lat * Math.PI) / 180;
  const cosHa = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(rad) * Math.cos(decl)) - Math.tan(rad) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = (Math.acos(cosHa) * 180) / Math.PI;
  // Sydney's offset from UTC on that day (10, or 11 in daylight saving).
  const noon = new Date(Date.UTC(y, mo - 1, d, 12));
  const sydHour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(noon));
  const offset = ((sydHour - 12 + 24) % 24) || 10;
  const rise = (720 - 4 * (lng + ha) - eq) / 60 + offset;
  const set = (720 - 4 * (lng - ha) - eq) / 60 + offset;
  return [rise, set];
}

/** The current hour in Sydney, with minutes as a fraction. */
function nowHour(): number {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
}

/** A smooth line through points (Catmull-Rom turned into curves). */
function smooth(pts: [number, number][]): string {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const [p1, p2] = [pts[i], pts[i + 1]];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Runs of hours that have a value, so a line breaks where the forecast has a gap. */
function runs<T>(list: T[], has: (x: T) => boolean): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const x of list) {
    if (has(x)) cur.push(x);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** An arrow at (x, y) blowing away from `from` degrees (a north wind points down), like the map's arrows. */
function arrow(x: number, y: number, from: number, cls: string, size = 7): string {
  return `<g class="${cls}" transform="translate(${x.toFixed(1)} ${y}) rotate(${Math.round(from)})"><path d="M0 ${-size}V${size}M${-size * 0.62} ${size * 0.38}L0 ${size}L${size * 0.62} ${size * 0.38}" /></g>`;
}

function hourLabel(h: number): string {
  const hh = h % 24;
  if (hh === 0) return 'mid';
  if (hh === 12) return 'noon';
  return `${hh % 12}${hh < 12 ? 'am' : 'pm'}`;
}

const NIGHT_KIND: Partial<Record<WeatherKind, WeatherKind>> = { clear: 'moon', partly: 'moonpartly', sunrain: 'moonrain' };

export interface DayChart {
  html: string;
  /** Where to scroll to first, in pixels. */
  scrollTo: number;
}

export function dayChart(item: HitListItem, f: Forecast, date: string): DayChart | null {
  const cat = categoryOf(item.activity).id;
  const camping = cat === 'camping';
  const [from, to] = camping ? [12, 34] : [0, 24];
  const hrs = hoursOf(f, date, from, to);
  if (!hrs.length) return null;
  const hasSea = hrs.some((h) => h.swell != null);
  const sea = SEA_CHART.has(cat) && hasSea;
  const hasTide = hrs.filter((h) => h.tide != null).length > 3;
  const faces = cat === 'surfing' ? item.faces : null;
  const W = hrs.length * HOUR_W;
  const cx = (h: number) => (h - from + 0.5) * HOUR_W;
  /** Where a time of day (fractional hours) falls: an hour's value is drawn at the middle of its column. */
  const px = cx;
  const parts: string[] = [];
  let y = 0;

  // Night shading, behind everything.
  const sun = item.lat != null && item.lng != null ? sunTimes(date, item.lat, item.lng) : null;
  const shade: string[] = [];
  if (sun) {
    const [rise, set] = sun;
    const dark: [number, number][] = [
      [from, rise],
      [set, rise + 24],
      [set + 24, to],
    ];
    for (const [a, b] of dark) {
      const s = Math.max(0, px(a));
      const e = Math.min(W, px(b));
      if (e > s) shade.push(`<rect class="dc-night" x="${s.toFixed(1)}" y="0" width="${(e - s).toFixed(1)}" height="100%" />`);
    }
  }
  const isNight = (h: number) => !!sun && (h + 0.5 < sun[0] || (h + 0.5 > sun[1] && h + 0.5 < sun[0] + 24) || h + 0.5 > sun[1] + 24);

  // Hours along the top. A sea chart also marks the day's best stretch for surfing under them.
  const best = sea ? daysOf(f, [date], cat, item)[0]?.surf?.best ?? null : null;
  parts.push(
    hrs.map((x) => `<text class="dc-hour${x.h % 24 === 0 ? ' dc-hour-day' : ''}" x="${cx(x.h)}" y="12">${hourLabel(x.h)}</text>`).join(''),
  );
  y = 18;
  if (best && cat === 'surfing') {
    const [a, b] = best;
    parts.push(`<rect class="dc-best" x="${((a - from) * HOUR_W + 3).toFixed(1)}" y="${y}" width="${((b - a) * HOUR_W - 6).toFixed(1)}" height="3" rx="1.5" />`);
  }
  y += 6;

  // Wind: arrow and "average–gust" in each column.
  const windRow = (top: number) =>
    hrs
      .map((x) => {
        if (x.wind == null) return '';
        const cls = faces != null && x.dir != null ? `dc-arrow dc-${windRelation(x.dir, faces)}` : 'dc-arrow';
        const w = Math.round(x.wind);
        const g = x.gust != null && Math.round(x.gust) > w ? Math.round(x.gust) : null;
        return `${x.dir != null ? arrow(cx(x.h), top + 9, x.dir, cls) : ''}<text class="dc-val" x="${cx(x.h)}" y="${top + 31}">${w}${g != null ? `<tspan class="dc-gust">–${g}</tspan>` : ''}</text>`;
      })
      .join('');

  if (sea) {
    parts.push(windRow(y));
    y += 40;
    // Swell bars with the tide over them.
    const plotTop = y + 14;
    const plotH = 96;
    const base = plotTop + plotH;
    const maxSwell = Math.max(2, ...hrs.map((x) => x.swell ?? 0)) * 1.1;
    const barW = HOUR_W - 12;
    parts.push(
      `<line class="dc-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />` +
        hrs
          .map((x) => {
            if (x.swell == null) return '';
            const bh = Math.max(2, (x.swell / maxSwell) * plotH);
            return `<rect class="dc-swell" x="${(cx(x.h) - barW / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="3" /><text class="dc-swell-val" x="${cx(x.h)}" y="${(base - bh - 4).toFixed(1)}">${r1(x.swell).toFixed(1)}</text>`;
          })
          .join(''),
    );
    if (hasTide) parts.push(tideLayer(f, hrs, date, from, to, cx, plotTop + 8, plotH * 0.42));
    y = base + 6;
    // Swell direction and period under the bars.
    parts.push(
      hrs
        .map((x) =>
          x.swell == null
            ? ''
            : `${x.swellDir != null ? arrow(cx(x.h), y + 9, x.swellDir, 'dc-arrow dc-swell-arrow') : ''}${x.period != null ? `<text class="dc-val" x="${cx(x.h)}" y="${y + 31}">${Math.round(x.period)}s</text>` : ''}`,
        )
        .join(''),
    );
    y += 38;
  } else {
    // Weather symbol each hour (moon versions at night).
    parts.push(
      hrs
        .map((x) => {
          let k = weatherKind(x.code);
          if (isNight(x.h)) k = NIGHT_KIND[k] ?? k;
          return WEATHER_ICONS[k].replace('<svg class="wx-icon"', `<svg class="wx-icon dc-sky" x="${cx(x.h) - 11}" y="${y}" width="22" height="22"`);
        })
        .join(''),
    );
    y += 28;
    // Temperature line in the upper part, rain bars from the bottom.
    const tempTop = y + 14;
    const tempH = 46;
    const temps = hrs.map((x) => x.temp).filter((t): t is number => t != null);
    const rainTop = tempTop + tempH + 8;
    const rainH = 28;
    const base = rainTop + rainH;
    if (temps.length) {
      const lo = Math.min(...temps);
      const hi = Math.max(...temps);
      const span = Math.max(6, hi - lo);
      const ty = (t: number) => tempTop + tempH - ((t - lo) / span) * tempH - (span > hi - lo ? ((span - (hi - lo)) / span) * tempH * 0.5 : 0);
      // Skiing: a dashed line at freezing when it's in view.
      if (cat === 'skiing' && lo <= 0 && hi >= 0) parts.push(`<line class="dc-zero" x1="0" x2="${W}" y1="${ty(0).toFixed(1)}" y2="${ty(0).toFixed(1)}" /><text class="dc-zero-label" x="4" y="${(ty(0) - 3).toFixed(1)}">0°</text>`);
      for (const run of runs(hrs, (x) => x.temp != null)) parts.push(`<path class="dc-temp" d="${smooth(run.map((x) => [cx(x.h), ty(x.temp!)]))}" />`);
      parts.push(
        hrs
          .map((x) => (x.temp == null ? '' : `<circle class="dc-temp-dot" cx="${cx(x.h)}" cy="${ty(x.temp).toFixed(1)}" r="2.2" /><text class="dc-temp-val" x="${cx(x.h)}" y="${(ty(x.temp) - 7).toFixed(1)}">${Math.round(x.temp)}°</text>`))
          .join(''),
      );
    }
    const maxRain = Math.max(3, ...hrs.map((x) => x.rain ?? 0));
    const barW = HOUR_W - 14;
    parts.push(
      `<line class="dc-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />` +
        hrs
          .map((x) => {
            const mm = x.rain ?? 0;
            if (mm < 0.1) return '';
            const bh = Math.max(2, (Math.min(mm, maxRain) / maxRain) * rainH);
            return `<rect class="dc-rain" x="${(cx(x.h) - barW / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="2" /><text class="dc-rain-val" x="${cx(x.h)}" y="${(base - bh - 3).toFixed(1)}">${mm < 1 ? mm.toFixed(1) : Math.round(mm)}</text>`;
          })
          .join(''),
    );
    y = base + 14;
    // Chance of rain under the bars, only where it's worth noticing.
    parts.push(hrs.map((x) => (x.prob != null && x.prob >= 10 ? `<text class="dc-prob${x.prob >= 50 ? ' dc-prob-hi' : ''}" x="${cx(x.h)}" y="${y}">${x.prob}%</text>` : '')).join(''));
    y += 8;
    if (hasTide && cat === 'kayaking') {
      parts.push(tideLayer(f, hrs, date, from, to, cx, y + 14, 30));
      y += 54;
    }
    parts.push(windRow(y));
    y += 40;
  }

  // Now, on today's chart.
  let scrollTo = ((sea ? 5 : 6) - from) * HOUR_W;
  if (camping) scrollTo = 0;
  const today = todayIso();
  if (date === today) {
    const n = nowHour();
    if (n >= from && n < to - 0.5) {
      const x = px(n);
      parts.push(`<line class="dc-now" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="16" y2="${y}" />`);
      scrollTo = Math.max(0, x - HOUR_W * 1.5);
    }
  }

  const said = sea
    ? `Hour by hour: swell ${r1(Math.min(...hrs.filter((h) => h.swell != null).map((h) => h.swell!)))} to ${r1(Math.max(...hrs.map((h) => h.swell ?? 0)))} metres, wind and tide.`
    : `Hour by hour: weather, temperature, rain and wind.`;
  const key = sea
    ? `Bars are swell in metres with its direction and period below${hasTide ? '; the line is the tide' : ''}. Wind in km/h, average to gust${faces != null ? ': green offshore, orange cross-shore, red onshore' : ''}${best && cat === 'surfing' ? '. The green mark is the best time' : ''}.`
    : `Temperature line, rain bars in mm with the chance of rain below${hasTide && cat === 'kayaking' ? ', the tide' : ''}, and wind in km/h, average to gust.`;
  const html = `<div class="dc"><div class="dc-scroll" data-start="${Math.round(scrollTo)}"><svg class="dc-svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" role="img" aria-label="${esc(said)}">${shade.join('')}${parts.join('')}</svg></div><p class="dc-key">${esc(key)}</p></div>`;
  return { html, scrollTo };
}

/** The tide as a line (with a soft fill under it) and its high and low times. */
function tideLayer(f: Forecast, hrs: ChartHour[], date: string, from: number, to: number, cx: (h: number) => number, top: number, height: number): string {
  const pts = hrs.filter((x) => x.tide != null);
  const lo = Math.min(...pts.map((x) => x.tide!));
  const hi = Math.max(...pts.map((x) => x.tide!));
  const span = Math.max(0.3, hi - lo);
  const ty = (v: number) => top + height - ((v - lo) / span) * height;
  const out: string[] = [];
  for (const run of runs(hrs, (x) => x.tide != null)) {
    const line = smooth(run.map((x) => [cx(x.h), ty(x.tide!)]));
    out.push(`<path class="dc-tide" d="${line}" />`);
  }
  // High and low tide times, from the same turning points as the rest of the app.
  const m = f.marine!;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const tides: Tide[] = [...tidesOn(m, date), ...tidesOn(m, next.toISOString().slice(0, 10)).map((t) => ({ ...t, hour: t.hour + 24 }))].filter((t) => t.hour >= from && t.hour < to);
  const at = (hour: number) => {
    const a = hrs.find((x) => x.h === Math.floor(hour));
    const b = hrs.find((x) => x.h === Math.floor(hour) + 1);
    if (a?.tide == null) return null;
    return b?.tide != null ? a.tide + (b.tide - a.tide) * (hour - Math.floor(hour)) : a.tide;
  };
  for (const t of tides) {
    const v = at(t.hour);
    if (v == null) continue;
    const x = (t.hour - from + 0.5) * HOUR_W;
    const yy = ty(v);
        out.push(
      `<circle class="dc-tide-dot" cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3" /><text class="dc-tide-val" x="${x.toFixed(1)}" y="${(yy - 7).toFixed(1)}">${t.type} ${clock(t.hour)}</text>`,
    );
  }
  return out.join('');
}


/** The day picked on the map's day stepper (or from a Plan pick), so a card opens on that day. */
let picked: string | null = null;
export const setPickedDay = (iso: string) => {
  picked = iso;
};
export const pickedDay = () => picked;

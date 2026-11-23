import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { Forecast } from './openmeteo';
import { clock, dayShort, tidesOn, todayIso, windRelation, daysOf, swellHeights, type Tide } from './summary';
import { WEATHER_ICONS, periodKind } from './weather-icons';

/**
 * The hour-by-hour chart on a place card. One day fills the width of the card, and it scrolls sideways
 * straight on into the following days (Sam, 2026-11-20).
 *
 * - Surf spots and dive sites ("like WillyWeather"): swell as paper bars, the tide as a line over them with
 *   high and low times, swell direction and period underneath.
 * - Everything else ("like Apple Weather"): a weather symbol every three hours (yellow sun, dark blue rain),
 *   temperature as a line, rain as bars, the chance of rain. Kayaking on the coast adds the tide.
 * - All of them: wind as two curves, average and gusts, with arrows along the average line (coloured
 *   offshore / cross-shore / onshore at a surf beach that knows which way it faces).
 * Each day is headed with its name and total rain. Night hours are shaded (sunrise and sunset worked out
 * here), and today has a line at the current hour. Times are Sydney time, like the forecast.
 */

const SEA_CHART = new Set(['surfing', 'diving']);
/** Labels, symbols and arrows go every this many hours, so a day fits one screen. */
const STEP = 3;

interface ChartHour {
  /** Hours from midnight of the first day. */
  t: number;
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

const f1 = (n: number) => n.toFixed(1);

/** Every hour from midnight of `dates[0]` to the end of the last date, read straight from the forecast. */
function hoursOf(f: Forecast, dates: string[]): ChartHour[] {
  const w = f.hourly;
  const m = f.marine;
  const wi = w?.time?.indexOf(`${dates[0]}T00:00`) ?? -1;
  const mi = m?.time?.indexOf(`${dates[0]}T00:00`) ?? -1;
  const swellList = m ? swellHeights(m) : undefined;
  const out: ChartHour[] = [];
  for (let t = 0; t < dates.length * 24; t++) {
    const i = wi >= 0 && wi + t < (w?.time.length ?? 0) ? wi + t : -1;
    const j = mi >= 0 && mi + t < (m?.time.length ?? 0) ? mi + t : -1;
    out.push({
      t,
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
  const n = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
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
  const offset = (sydHour - 12 + 24) % 24 || 10;
  return [(720 - 4 * (lng + ha) - eq) / 60 + offset, (720 - 4 * (lng - ha) - eq) / 60 + offset];
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
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const [p1, p2] = [pts[i], pts[i + 1]];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`;
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
function arrow(x: number, y: number, from: number, cls: string, size = 6): string {
  return `<g class="${cls}" transform="translate(${f1(x)} ${f1(y)}) rotate(${Math.round(from)})"><path d="M0 ${-size}V${size}M${-size * 0.62} ${size * 0.38}L0 ${size}L${size * 0.62} ${size * 0.38}" /></g>`;
}

function hourLabel(h: number): string {
  if (h === 12) return 'noon';
  return `${h % 12}${h < 12 ? 'am' : 'pm'}`;
}

// ---- Coloured weather symbols for the chart: yellow sun, dark blue rain (Sam, 2026-11-20) ----
// Built from the same Phosphor light pieces as weather-icons.ts, so they match the rest of the app.

const dOf = (svg: string) => svg.match(/d="([^"]+)"/)?.[1] ?? '';
const SUN = dOf(WEATHER_ICONS.clear);
const CLOUD = dOf(WEATHER_ICONS.cloud);
/** The cloud's outline filled in, laid under it so the sun behind doesn't show through. */
const CLOUD_FILL = CLOUD.slice(0, CLOUD.indexOf('Z') + 1);

const cloudAt = (tx: number, ty: number, s: number) =>
  `<g transform="translate(${tx} ${ty}) scale(${s})"><path class="dc-sym-mask" d="${CLOUD_FILL}"/><path class="dc-sym-cloud" d="${CLOUD}"/></g>`;
const sunAt = (tx: number, ty: number, s: number) => `<g transform="translate(${tx} ${ty}) scale(${s})"><path class="dc-sym-sun" d="${SUN}"/></g>`;
const RAIN_LINES = `<path class="dc-sym-rain" d="M96,196l-14,34M140,196l-14,34M184,196l-14,34"/>`;

/** A symbol for some hours, drawn into the chart at (x, y), `size` px square. */
function symbol(codes: (number | null)[], night: boolean, x: number, y: number, size: number): string {
  const k = periodKind(codes, false);
  let inner: string;
  if (k === 'clear') inner = night ? `<path class="dc-sym-cloud" d="${moonPath()}"/>` : `<path class="dc-sym-sun" d="${SUN}"/>`;
  else if (k === 'partly') inner = night ? WEATHER_ICONS.moonpartly.replace(/^<svg[^>]*>|<\/svg>$/g, '') : sunAt(-4, -6, 0.64) + cloudAt(44, 36, 0.8);
  else if (k === 'cloud') inner = `<path class="dc-sym-cloud" d="${CLOUD}"/>`;
  else if (k === 'rain') inner = cloudAt(14, -20, 0.88) + RAIN_LINES;
  else if (k === 'sunrain') inner = (night ? '' : sunAt(-4, -18, 0.58)) + cloudAt(38, 0, 0.74) + RAIN_LINES;
  else inner = WEATHER_ICONS[k].replace(/^<svg[^>]*>|<\/svg>$/g, '');
  return `<svg class="dc-sym" x="${f1(x)}" y="${f1(y)}" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}

function moonPath(): string {
  return dOf(WEATHER_ICONS.moon);
}

export interface DayChartOptions {
  /** The days to draw, in order. */
  dates: string[];
  /** Width of one day on screen, px (the card's width). */
  dayWidth: number;
}

export function dayChart(item: HitListItem, f: Forecast, opts: DayChartOptions): string | null {
  const cat = categoryOf(item.activity).id;
  const { dates } = opts;
  const all = hoursOf(f, dates);
  // Drop days at the end with no forecast at all.
  let last = all.length;
  while (last > 0 && all[last - 1].temp == null && all[last - 1].swell == null) last--;
  const days = dates.slice(0, Math.ceil(last / 24));
  if (!days.length) return null;
  const hrs = all.slice(0, days.length * 24);
  const sea = SEA_CHART.has(cat) && hrs.some((h) => h.swell != null);
  const hasTide = hrs.filter((h) => h.tide != null).length > 3;
  const faces = cat === 'surfing' ? item.faces : null;
  const hw = opts.dayWidth / 24;
  const W = Math.round(days.length * opts.dayWidth);
  /** Where a time falls (hours from the first midnight): an hour's value is drawn at the middle of its slot. */
  const px = (t: number) => (t + 0.5) * hw;
  const parts: string[] = [];
  const back: string[] = [];
  const steps = hrs.filter((x) => x.t % STEP === 0); // midnight, 3am, 6am…

  // Day headers: name and total rain, kept in view while you scroll through that day (see card.ts).
  const total = (date: string) => {
    const i = f.daily.time.indexOf(date);
    const mm = i >= 0 ? f.daily.precipitation_sum[i] : null;
    return mm == null ? '' : mm < 0.2 ? 'dry' : `${mm < 10 ? f1(mm) : Math.round(mm)} mm`;
  };
  days.forEach((d, n) => {
    const x0 = n * opts.dayWidth;
    back.push(`<line class="dc-daysep" x1="${f1(x0)}" x2="${f1(x0)}" y1="0" y2="100%" />`);
    parts.push(
      `<text class="dc-dayname" x="${f1(x0 + 8)}" y="13" data-day="${d}">${d === todayIso() ? 'Today' : dayShort(d)}<tspan class="dc-daymm" dx="6">${total(d)}</tspan></text>`,
    );
  });
  // Night shading, behind everything.
  if (item.lat != null && item.lng != null) {
    days.forEach((d, n) => {
      const sun = sunTimes(d, item.lat!, item.lng!);
      if (!sun) return;
      for (const [a, b] of [
        [0, sun[0]],
        [sun[1], 24],
      ]) {
        const s = Math.max(n * opts.dayWidth, px(n * 24 + a) - hw / 2);
        const e = Math.min((n + 1) * opts.dayWidth, px(n * 24 + b) - hw / 2);
        if (e > s) back.unshift(`<rect class="dc-night" x="${f1(s)}" y="0" width="${f1(e - s)}" height="100%" />`);
      }
    });
  }
  const isNight = (t: number) => {
    const d = days[Math.floor(t / 24)];
    const sun = d && item.lat != null ? sunTimes(d, item.lat, item.lng!) : null;
    const h = (t % 24) + 0.5;
    return !!sun && (h < sun[0] || h > sun[1]);
  };

  // Hour labels every three hours (midnight is the day line).
  let y = 18;
  parts.push(
    hrs
      .filter((x) => x.t % STEP === 0 && x.t % 24 !== 0)
      .map((x) => `<text class="dc-hour" x="${f1(px(x.t))}" y="${y + 13}">${hourLabel(x.t % 24)}</text>`)
      .join(''),
  );
  y += 20;

  // The best surfing stretch of each day, as a green mark under the hours.
  if (cat === 'surfing' && sea) {
    days.forEach((d, n) => {
      const best = daysOf(f, [d], cat, item)[0]?.surf?.best;
      if (best) parts.push(`<rect class="dc-best" x="${f1((n * 24 + best[0]) * hw + 1)}" y="${y - 3}" width="${f1((best[1] - best[0]) * hw - 2)}" height="3" rx="1.5" />`);
    });
  }

  // Wind first, at the top: the average and the gusts as two curves, arrows along the average.
  // The scale fits the week's strongest AVERAGE wind with room above (at least 20 km/h), so the average line
  // moves; on the windiest days the gust line flattens at the top (the gust numbers are still printed).
  {
    const top = y + 12;
    const h = 60;
    const base = top + h;
    const maxW = Math.max(20, ...hrs.map((x) => x.wind ?? 0)) * 1.5;
    const wy = (v: number) => base - (Math.min(v, maxW) / maxW) * h;
    parts.push(`<line class="dc-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />`);
    for (const run of runs(hrs, (x) => x.gust != null)) parts.push(`<path class="dc-gust-line" d="${smooth(run.map((x) => [px(x.t), wy(x.gust!)]))}" />`);
    for (const run of runs(hrs, (x) => x.wind != null)) parts.push(`<path class="dc-wind-line" d="${smooth(run.map((x) => [px(x.t), wy(x.wind!)]))}" />`);
    parts.push(
      steps
        .map((x) => {
          if (x.wind == null) return '';
          const cls = faces != null && x.dir != null ? `dc-warrow dc-${windRelation(x.dir, faces)}` : 'dc-warrow';
          const g = x.gust != null && Math.round(x.gust) > Math.round(x.wind) ? `<tspan class="dc-gust">–${Math.round(x.gust)}</tspan>` : '';
          return `${x.dir != null ? `<circle class="dc-warrow-bg" cx="${f1(px(x.t))}" cy="${f1(wy(x.wind))}" r="7.5" />${arrow(px(x.t), wy(x.wind), x.dir, cls, 5)}` : ''}<text class="dc-val" x="${f1(px(x.t))}" y="${base + 14}">${Math.round(x.wind)}${g}</text>`;
        })
        .join(''),
    );
    y = base + 20;
  }


  if (sea) {
    const plotTop = y + 14;
    const plotH = 90;
    const base = plotTop + plotH;
    // The scale fits the week's swell: the top is just above its biggest, and the bottom is raised to the
    // half metre below its smallest (less 0.3 m), so changes show. Heights are printed under the bars.
    const swells = hrs.map((x) => x.swell).filter((v): v is number => v != null);
    const minSwell = Math.max(0, Math.floor((Math.min(...swells) - 0.3) * 2) / 2);
    const maxSwell = Math.max(minSwell + 1, Math.max(...swells) * 1.05);
    const sh = (v: number) => Math.max(2, ((v - minSwell) / (maxSwell - minSwell)) * plotH);
    const barW = Math.max(3, hw - 3);
    parts.push(
      `<line class="dc-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />` +
        hrs.map((x) => (x.swell == null ? '' : `<rect class="dc-swell" x="${f1(px(x.t) - barW / 2)}" y="${f1(base - sh(x.swell))}" width="${f1(barW)}" height="${f1(sh(x.swell))}" rx="1.5" />`)).join(''),
    );
    if (hasTide) parts.push(tideLayer(f, hrs, days, px, plotTop + 8, plotH * 0.55));
    y = base + 6;
    // Swell height, direction and period under the bars, every three hours.
    parts.push(
      steps
        .map((x) =>
          x.swell == null
            ? ''
            : `<text class="dc-swell-val" x="${f1(px(x.t))}" y="${y + 11}">${f1(x.swell)}</text>${x.swellDir != null ? arrow(px(x.t), y + 24, x.swellDir, 'dc-arrow dc-swell-arrow', 5) : ''}${x.period != null ? `<text class="dc-val" x="${f1(px(x.t))}" y="${y + 44}">${Math.round(x.period)}s</text>` : ''}`,
        )
        .join(''),
    );
    y += 50;
  } else {
    // A symbol for each three hours.
    const size = Math.min(24, hw * STEP - 6);
    parts.push(
      steps
        .map((x) => {
          const codes = hrs.slice(x.t - 1, x.t + 2).map((h) => h.code);
          return codes.some((c) => c != null) ? symbol(codes, isNight(x.t), px(x.t) - size / 2, y, size) : '';
        })
        .join(''),
    );
    y += size + 6;
    // Temperature line, with values every three hours.
    const tempTop = y + 14;
    const tempH = 56;
    const temps = hrs.map((x) => x.temp).filter((t): t is number => t != null);
    if (temps.length) {
      const lo = Math.min(...temps);
      const hi = Math.max(...temps);
      const span = Math.max(5, hi - lo);
      const mid = (hi + lo) / 2;
      const ty = (t: number) => tempTop + tempH / 2 - ((t - mid) / span) * tempH;
      if (cat === 'skiing' && lo <= 0 && hi >= 0) parts.push(`<line class="dc-zero" x1="0" x2="${W}" y1="${f1(ty(0))}" y2="${f1(ty(0))}" />`);
      for (const run of runs(hrs, (x) => x.temp != null)) parts.push(`<path class="dc-temp" d="${smooth(run.map((x) => [px(x.t), ty(x.temp!)]))}" />`);
      parts.push(
        steps
          .map((x) => (x.temp == null ? '' : `<circle class="dc-temp-dot" cx="${f1(px(x.t))}" cy="${f1(ty(x.temp))}" r="2.2" /><text class="dc-temp-val" x="${f1(px(x.t))}" y="${f1(ty(x.temp) - 6)}">${Math.round(x.temp)}°</text>`))
          .join(''),
      );
    }
    // Rain bars each hour, chance of rain every three hours.
    const rainTop = tempTop + tempH + 8;
    const rainH = 32;
    const base = rainTop + rainH;
    const maxRain = Math.max(2, ...hrs.map((x) => x.rain ?? 0));
    const barW = Math.max(3, hw - 3);
    parts.push(
      `<line class="dc-base" x1="0" x2="${W}" y1="${base}" y2="${base}" />` +
        hrs
          .map((x) => {
            const mm = x.rain ?? 0;
            if (mm < 0.1) return '';
            const bh = Math.max(2, (Math.min(mm, maxRain) / maxRain) * rainH);
            return `<rect class="dc-rain" x="${f1(px(x.t) - barW / 2)}" y="${f1(base - bh)}" width="${f1(barW)}" height="${f1(bh)}" rx="1.5" />`;
          })
          .join(''),
    );
    y = base + 13;
    parts.push(
      steps
        .map((x) => {
          const probs = hrs.slice(x.t - 1, x.t + 2).map((h) => h.prob ?? 0);
          const p = Math.max(...probs);
          return p >= 10 ? `<text class="dc-prob${p >= 50 ? ' dc-prob-hi' : ''}" x="${f1(px(x.t))}" y="${y}">${p}%</text>` : '';
        })
        .join(''),
    );
    y += 6;
    if (hasTide && cat === 'kayaking') {
      parts.push(tideLayer(f, hrs, days, px, y + 18, 26));
      y += 52;
    }
  }

  // Now, on today.
  const ti = days.indexOf(todayIso());
  if (ti >= 0) {
    const x = px(ti * 24 + nowHour()) - hw / 2;
    parts.push(`<line class="dc-now" x1="${f1(x)}" x2="${f1(x)}" y1="18" y2="${y}" />`);
  }

  const said = sea ? 'Hour by hour: wind, swell, tide and swell period for each day.' : 'Hour by hour: weather, temperature, rain and wind for each day.';
  const key = sea
    ? `Wind on top. Bars are swell in metres (all swells plus wind waves; the scale starts above zero so changes show), with the main swell’s direction and period below${hasTide ? '; the teal line is the tide' : ''}. Wind in km/h: the solid line is the average, the dashed line the gusts${faces != null ? '; arrows green offshore, orange cross-shore, red onshore' : ''}${cat === 'surfing' ? '. The green mark is the best time' : ''}.`
    : `Temperature line, rain bars with the chance of rain${hasTide && cat === 'kayaking' ? ', the tide' : ''}, and wind in km/h: the solid line is the average, the dashed line the gusts. Each day shows its total rain.`;
  return `<div class="dc"><div class="dc-scroll" style="--day-w:${f1(opts.dayWidth)}px"><svg class="dc-svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" role="img" aria-label="${esc(said)}">${back.join('')}${parts.join('')}</svg></div><p class="dc-key">${esc(key)}</p></div>`;
}

/** The tide as a line, with its high and low times. */
function tideLayer(f: Forecast, hrs: ChartHour[], days: string[], px: (t: number) => number, top: number, height: number): string {
  const pts = hrs.filter((x) => x.tide != null);
  if (!pts.length) return '';
  const lo = Math.min(...pts.map((x) => x.tide!));
  const hi = Math.max(...pts.map((x) => x.tide!));
  const span = Math.max(0.3, hi - lo);
  const ty = (v: number) => top + height - ((v - lo) / span) * height;
  const out: string[] = [];
  for (const run of runs(hrs, (x) => x.tide != null)) out.push(`<path class="dc-tide" d="${smooth(run.map((x) => [px(x.t), ty(x.tide!)]))}" />`);
  // High and low tide times, from the same turning points as the rest of the app.
  const tides: Tide[] = days.flatMap((d, n) => tidesOn(f.marine!, d).map((t) => ({ ...t, hour: t.hour + n * 24 })));
  for (const t of tides) {
    const a = hrs[Math.floor(t.hour)];
    const b = hrs[Math.floor(t.hour) + 1];
    if (a?.tide == null) continue;
    const v = b?.tide != null ? a.tide + (b.tide - a.tide) * (t.hour - Math.floor(t.hour)) : a.tide;
    const x = px(t.hour);
    const yy = ty(v);
    const high = t.type === 'High';
    out.push(`<circle class="dc-tide-dot" cx="${f1(x)}" cy="${f1(yy)}" r="2.6" /><text class="dc-tide-val" x="${f1(x)}" y="${f1(yy - 6)}">${high ? 'H' : 'L'} ${clock(t.hour % 24)}</text>`);
  }
  return out.join('');
}

/** The day picked on the map's day stepper (or from a Plan pick), so a card opens on that day. */
let picked: string | null = null;
export const setPickedDay = (iso: string) => {
  picked = iso;
};
export const pickedDay = () => picked;

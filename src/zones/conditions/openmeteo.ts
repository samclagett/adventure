/**
 * Forecasts from Open-Meteo (https://open-meteo.com), free and keyless, called straight from the browser.
 * Weather comes from its forecast API (which blends BOM's ACCESS model with others) and swell, tides and
 * water temperature from its marine API. Many places go in one request, so a whole hit list is a few calls.
 *
 * Swell heights are MODEL total wave height in metres (see swellHeights in summary.ts). They are not the surf face height you'd see on
 * Surfline, so never convert them to feet (lesson from Sam's Daily Surf Report).
 */

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
/** Everything is shown in Sydney time (VIC and TAS share it). */
const TZ = 'Australia/Sydney';
/** Long enough for the "Next 2 weeks" window. */
export const FORECAST_DAYS = 14;
/** The marine forecast's limit. */
export const MARINE_DAYS = 8;
/** Days before today, for rules that look back (rain on sandstone, a dive site's runoff, recent snow). */
export const PAST_DAYS = 5;
/** Places per request, to keep URLs short. */
const BATCH = 50;

export interface Place {
  lat: number;
  lng: number;
}

export interface DailyWeather {
  /** The days, YYYY-MM-DD (Open-Meteo calls this `time`). */
  time: string[];
  weather_code: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
  precipitation_probability_max: (number | null)[];
  wind_speed_10m_max: (number | null)[];
  wind_gusts_10m_max: (number | null)[];
  wind_direction_10m_dominant: (number | null)[];
  snowfall_sum: (number | null)[];
}

export interface HourlyWind {
  time: string[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
}

/** Hour by hour weather, for every place: splits each day into morning, afternoon and night. */
export interface HourlyWeather extends HourlyWind {
  weather_code: (number | null)[];
  temperature_2m: (number | null)[];
  precipitation: (number | null)[];
  precipitation_probability: (number | null)[];
  /** Missing from forecasts saved before 2026-11-20. */
  wind_gusts_10m?: (number | null)[];
}

export interface HourlyMarine {
  time: string[];
  wave_height: (number | null)[];
  swell_wave_height: (number | null)[];
  swell_wave_period: (number | null)[];
  swell_wave_direction: (number | null)[];
  sea_level_height_msl: (number | null)[];
  sea_surface_temperature: (number | null)[];
  /** The parts of the sea, for the surf size estimate (surfsize.ts). Missing from forecasts saved before 2026-11-28. */
  wind_wave_height?: (number | null)[];
  wind_wave_period?: (number | null)[];
  wind_wave_direction?: (number | null)[];
  secondary_swell_wave_height?: (number | null)[];
  secondary_swell_wave_period?: (number | null)[];
  secondary_swell_wave_direction?: (number | null)[];
}

export interface Forecast {
  daily: DailyWeather;
  /** Hour by hour weather (and wind). Missing from forecasts saved before 2026-11-16. */
  hourly?: HourlyWeather;
  /** Older saved forecasts: hourly wind for coastal places only. Replaced by `hourly`. */
  hourlyWind?: HourlyWind;
  /** Only for coastal categories. Missing or all-null when the place is too far from the sea. */
  marine?: HourlyMarine;
}

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'snowfall_sum',
];
const HOURLY_VARS = ['weather_code', 'temperature_2m', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
const MARINE_VARS = [
  'wave_height',
  'swell_wave_height',
  'swell_wave_period',
  'swell_wave_direction',
  'sea_level_height_msl',
  'sea_surface_temperature',
  'wind_wave_height',
  'wind_wave_period',
  'wind_wave_direction',
  'secondary_swell_wave_height',
  'secondary_swell_wave_period',
  'secondary_swell_wave_direction',
];

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** One request for many places. Open-Meteo answers with a list, or a single object for one place. */
async function getMany(base: string, places: Place[], params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const q = new URLSearchParams({
    latitude: places.map((p) => p.lat.toFixed(4)).join(','),
    longitude: places.map((p) => p.lng.toFixed(4)).join(','),
    timezone: TZ,
    forecast_days: String(FORECAST_DAYS),
    ...params,
  });
  const r = await fetch(`${base}?${q}`);
  if (!r.ok) {
    let reason = `${r.status}`;
    try {
      reason = ((await r.json()) as { reason?: string }).reason ?? reason;
    } catch {
      /* not JSON */
    }
    throw new Error(`Open-Meteo: ${reason}`);
  }
  const body = await r.json();
  return Array.isArray(body) ? body : [body];
}

/**
 * Like getMany, but if a whole batch fails (one bad place can sink it), retry place by place,
 * so the rest still get conditions. Failed places come back as null.
 */
async function getAll(base: string, places: Place[], params: Record<string, string>): Promise<(Record<string, unknown> | null)[]> {
  const out: (Record<string, unknown> | null)[] = [];
  for (const batch of chunks(places, BATCH)) {
    try {
      out.push(...(await getMany(base, batch, params)));
    } catch (err) {
      if (batch.length === 1) {
        out.push(null);
        continue;
      }
      const singles = await Promise.all(batch.map((p) => getMany(base, [p], params).then((r) => r[0], () => null)));
      if (singles.every((s) => s == null)) throw err;
      out.push(...singles);
    }
  }
  return out;
}

/**
 * Forecasts for each place, in the same order. `coastal[i]` asks for the marine forecast too.
 * Throws only if nothing at all could be fetched.
 */
export async function fetchForecasts(places: Place[], coastal: boolean[]): Promise<(Forecast | null)[]> {
  const coastIdx = places.map((_, i) => i).filter((i) => coastal[i]);
  const coastPlaces = coastIdx.map((i) => places[i]);
  const [weather, marine] = await Promise.all([
    getAll(WEATHER_URL, places, { daily: DAILY_VARS.join(','), hourly: HOURLY_VARS.join(','), past_days: String(PAST_DAYS) }),
    // Marine data is a bonus: if it fails, weather still shows.
    // The marine API only goes out 8 days (asking for more fails the whole request).
    coastPlaces.length
      ? getAll(MARINE_URL, coastPlaces, { hourly: MARINE_VARS.join(','), forecast_days: String(MARINE_DAYS) }).catch(() => coastPlaces.map(() => null))
      : Promise.resolve([]),
  ]);
  const result: (Forecast | null)[] = weather.map((w) => (w ? { daily: w.daily as DailyWeather, hourly: w.hourly as HourlyWeather } : null));
  coastIdx.forEach((placeIdx, n) => {
    const f = result[placeIdx];
    if (!f) return;
    if (marine[n]) f.marine = marine[n]!.hourly as HourlyMarine;
  });
  return result;
}

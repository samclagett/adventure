import type { Forecast } from '../conditions/openmeteo';
import { swellHeights, todayIso, windRelation } from '../conditions/summary';

/** What the 3D scene shows for one hour at one place. */
export interface SpotHour {
  /** "YYYY-MM-DDTHH:00", Sydney time, as in the forecast. */
  time: string;
  code: number | null;
  temp: number | null;
  /** Rain this hour, mm. */
  rain: number;
  /** Wind, km/h, and the direction it blows FROM (degrees). */
  wind: number;
  gust: number | null;
  windFrom: number;
  /** Total wave height (m), the main swell's period (s) and the direction it comes FROM. Null away from the sea. */
  swell: number | null;
  period: number | null;
  swellFrom: number | null;
  /** 0 clear to 1 overcast, from the weather code. */
  cloud: number;
  fog: boolean;
  storm: boolean;
  /** How messy the sea surface is, 0 glassy to 1 blown out: wind strength, and worse when onshore. */
  chop: number;
  relation: 'offshore' | 'cross-shore' | 'onshore' | null;
}

/** Cloud cover implied by a WMO weather code (Open-Meteo doesn't send cloud cover in our forecast). */
function cloudOf(code: number | null): number {
  if (code == null) return 0.3;
  if (code === 0) return 0;
  if (code === 1) return 0.2;
  if (code === 2) return 0.5;
  if (code === 3) return 0.85;
  if (code === 45 || code === 48) return 1;
  return 0.9;
}

/** The current hour in Sydney as the forecast writes it. */
export function nowKey(now = new Date()): string {
  const h = Number(now.toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Sydney' })) % 24;
  return `${todayIso(now)}T${String(h).padStart(2, '0')}:00`;
}

/** The hours the scene can step through: from now, as far as the forecast goes (a week at most). */
export function hoursOf(f: Forecast): string[] {
  const times = f.hourly?.time ?? [];
  const start = times.indexOf(nowKey());
  if (start < 0) return [];
  return times.slice(start, start + 24 * 7);
}

export function hourAt(f: Forecast, time: string, faces: number | null): SpotHour | null {
  const h = f.hourly;
  if (!h) return null;
  const i = h.time.indexOf(time);
  if (i < 0) return null;
  const code = h.weather_code[i] ?? null;
  const wind = h.wind_speed_10m[i] ?? 0;
  const windFrom = h.wind_direction_10m[i] ?? 0;
  let swell: number | null = null;
  let period: number | null = null;
  let swellFrom: number | null = null;
  const m = f.marine;
  if (m) {
    const j = m.time.indexOf(time);
    if (j >= 0) {
      swell = swellHeights(m)[j] ?? null;
      period = m.swell_wave_period[j] ?? null;
      swellFrom = m.swell_wave_direction[j] ?? null;
    }
  }
  const relation = faces != null ? windRelation(windFrom, faces) : null;
  // Glassy under 8 km/h, blown out from about 35 km/h; onshore makes it messier sooner, offshore grooms it.
  const boost = relation === 'onshore' ? 1.35 : relation === 'offshore' ? 0.6 : 1;
  const chop = Math.max(0, Math.min(1, ((wind - 8) / 27) * boost));
  return {
    time,
    code,
    temp: h.temperature_2m[i] ?? null,
    rain: h.precipitation[i] ?? 0,
    wind,
    gust: h.wind_gusts_10m?.[i] ?? null,
    windFrom,
    swell,
    period,
    swellFrom,
    cloud: cloudOf(code),
    fog: code === 45 || code === 48,
    storm: code != null && code >= 95,
    chop,
    relation,
  };
}

/** Where the sun is, for the scene's light and sky. Degrees: elevation above the horizon, azimuth from north. */
export function sunPosition(time: string, lat: number, lng: number): { elevation: number; azimuth: number } {
  // The forecast hour is Sydney time; turn it into a real instant (AEDT +11 in summer, AEST +10 in winter).
  const [d, hm] = time.split('T');
  const guess = new Date(`${d}T${hm}:00Z`);
  const offset = Number(
    guess.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/)?.[1] ?? 10,
  );
  const ms = guess.getTime() - offset * 3600_000 + 30 * 60_000; // middle of the hour
  const rad = Math.PI / 180;
  const days = ms / 86400_000 + 2440587.5 - 2451545.0;
  const meanLong = (280.46 + 0.9856474 * days) % 360;
  const meanAnom = ((357.528 + 0.9856003 * days) % 360) * rad;
  const eclLong = (meanLong + 1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * rad;
  const obliq = (23.439 - 0.0000004 * days) * rad;
  const ra = Math.atan2(Math.cos(obliq) * Math.sin(eclLong), Math.cos(eclLong));
  const dec = Math.asin(Math.sin(obliq) * Math.sin(eclLong));
  const gmst = (18.697374558 + 24.06570982441908 * days) % 24;
  const ha = (gmst * 15 + lng) * rad - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

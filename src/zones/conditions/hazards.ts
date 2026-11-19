import type { HitListItem } from '../shared/types';
import type { Alert } from './ratings';
import { todayIso } from './summary';

/**
 * Hazards that sit beside a rating as small alert icons and never change its colour (Sam, 2026-11-19):
 * - Fire danger by fire weather district, shown from High up and for total fire bans. NSW: the RFS ratings for
 *   today and tomorrow (https://www.rfs.nsw.gov.au/feeds/fdrToban.xml, read live). VIC (2026-11-20): the CFA's
 *   four-day forecast (fire-vic.json, saved every 3 hours by scripts/conditions/firevic.py, since the CFA feed
 *   can't be read from the browser). Places are matched to a district with public/data/fire-districts.geojson
 *   (built by scripts/map/fire_districts.py).
 * - Park closures and bushfires near a place, on the dates they cover (parks.json, saved every 3 hours by
 *   scripts/conditions/parks.py): NSW National Parks alerts, Parks Victoria closures and VicEmergency bushfires.
 */

const FIRE_URL = 'https://www.rfs.nsw.gov.au/feeds/fdrToban.xml';
const DISTRICTS_URL = `${import.meta.env.BASE_URL}data/fire-districts.geojson`;
const DATA = 'https://raw.githubusercontent.com/samclagett/adventure/conditions-data';
const PARKS_URL = `${DATA}/parks.json`;
const FIRE_VIC_URL = `${DATA}/fire-vic.json`;
/** Ratings that bring up an alert. Moderate (most days in summer) doesn't. */
const SHOW_FIRE = ['HIGH', 'EXTREME', 'CATASTROPHIC'];
/** A park alert within this many km of a place counts for it, unless the alert sets its own `km`. */
const NEAR_KM = 5;

type Ring = [number, number][];
interface District {
  name: string;
  state: string;
  polys: Ring[][];
}
interface Danger {
  today: string;
  tomorrow: string;
  banToday: boolean;
  banTomorrow: boolean;
}
interface ParkAlert {
  type: string;
  title: string;
  where: string;
  park: string;
  link: string;
  start: string | null;
  end: string | null;
  points: [number, number][];
  /** Victorian parks: places this close (km) to the park's centre count. */
  km?: number;
}
interface VicDay {
  date: string;
  ratings: Record<string, string>;
  bans: Record<string, boolean>;
}

let districts: District[] = [];
let danger = new Map<string, Danger>();
let parks: ParkAlert[] = [];
let vic: VicDay[] = [];

/** Ray casting: is the point inside the ring? Coordinates are [lng, lat]. */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function districtAt(lat: number, lng: number): District | null {
  // Dive sites and beaches can sit just off the simplified coastline: try a few nearby points too.
  for (const [dy, dx] of [[0, 0], [0, -0.03], [0.03, 0], [-0.03, 0], [0, -0.08], [0.08, -0.05], [-0.08, -0.05]]) {
    const d = districts.find((x) => x.polys.some((p) => inRing(lng + dx, lat + dy, p[0]) && !p.slice(1).some((h) => inRing(lng + dx, lat + dy, h))));
    if (d) return d;
  }
  return null;
}

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const x = (bLng - aLng) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.hypot(x, y) * 6371;
}

const word = (level: string) => level.charAt(0) + level.slice(1).toLowerCase();

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dates (Sydney) from start to end, up to two weeks ahead. */
function datesBetween(start: string | null, end: string | null): string[] {
  const today = todayIso();
  const sydney = (t: string) => new Date(`${t}Z`).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  const from = start ? sydney(start) : today;
  const to = end ? sydney(end) : addDays(today, 14);
  const out: string[] = [];
  for (let n = 0; n <= 14; n++) {
    const d = addDays(today, n);
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

/** Every place's hazard alerts, by place id. */
export function hazardsFor(items: HitListItem[]): Map<string, Alert[]> {
  const out = new Map<string, Alert[]>();
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  for (const item of items) {
    if (item.lat == null || item.lng == null) continue;
    const list: Alert[] = [];
    const district = districts.length ? districtAt(item.lat, item.lng) : null;
    const days: [string, string, boolean][] = [];
    let link = '';
    if (district?.state === 'VIC') {
      for (const v of vic) days.push([v.date, v.ratings[district.name] ?? '', v.bans[district.name] ?? false]);
      link = 'https://www.cfa.vic.gov.au/warnings-restrictions/total-fire-bans-and-ratings';
    } else if (district) {
      const dz = danger.get(district.name);
      if (dz) days.push([today, dz.today, dz.banToday], [tomorrow, dz.tomorrow, dz.banTomorrow]);
      link = 'https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans';
    }
    for (const [date, level, ban] of days) {
      if (date < today) continue;
      if (SHOW_FIRE.includes(level) || ban)
        list.push({ kind: 'fire', text: `${SHOW_FIRE.includes(level) ? `${word(level)} fire danger` : 'Fire danger'}${ban ? ', total fire ban' : ''} (${district!.name})`, on: [date], link });
    }
    const near = parks.filter((p) => p.points.some(([la, ln]) => km(item.lat!, item.lng!, la, ln) <= (p.km ?? NEAR_KM)));
    for (const p of near.slice(0, 3)) {
      list.push({
        kind: p.type === 'Bushfire' ? 'fire' : 'closure',
        text: `${p.park ? `${p.park}: ` : ''}${p.title}${p.where ? ` (${p.where})` : ''}`,
        on: datesBetween(p.start, p.end),
        link: p.link,
      });
    }
    if (list.length) out.set(item.id, list);
  }
  return out;
}

/** Load the fire districts, the fire danger and the park alerts. Call `done` when they're in. */
export async function loadHazards(done: () => void) {
  const tasks = [
    fetch(DISTRICTS_URL)
      .then((r) => r.json())
      .then((g: { features: { properties: { name: string; state?: string }; geometry: { coordinates: Ring[][] } }[] }) => {
        districts = g.features.map((f) => ({ name: f.properties.name, state: f.properties.state ?? 'NSW', polys: f.geometry.coordinates }));
      }),
    fetch(FIRE_URL)
      .then((r) => r.text())
      .then((xml) => {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const map = new Map<string, Danger>();
        doc.querySelectorAll('District').forEach((d) => {
          const get = (tag: string) => d.querySelector(tag)?.textContent?.trim() ?? '';
          map.set(get('Name'), { today: get('DangerLevelToday').toUpperCase(), tomorrow: get('DangerLevelTomorrow').toUpperCase(), banToday: get('FireBanToday') === 'Yes', banTomorrow: get('FireBanTomorrow') === 'Yes' });
        });
        danger = map;
      }),
    fetch(`${FIRE_VIC_URL}?t=${Math.floor(Date.now() / 300000)}`)
      .then((r) => (r.ok ? r.json() : { days: [] }))
      .then((v: { days: VicDay[] }) => {
        vic = v.days ?? [];
      }),
    fetch(`${PARKS_URL}?t=${Math.floor(Date.now() / 300000)}`)
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((p: { alerts: ParkAlert[] }) => {
        parks = p.alerts ?? [];
      }),
  ];
  // Each source on its own: one failing (offline, moved) shouldn't stop the others.
  await Promise.allSettled(tasks);
  done();
}

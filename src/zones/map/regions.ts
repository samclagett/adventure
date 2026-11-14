import states from './data/australia-states.json';
import type { Region } from './map';

/**
 * Works out which region (NSW, VIC or TAS) a point is in, using the same state outlines the map draws.
 * NSW includes the ACT and Jervis Bay, like the region buttons do.
 */

type Ring = number[][];
interface StateShape {
  region: Region | null;
  polygons: Ring[][];
}

const SHAPES: StateShape[] = (states as { features: { properties: { region: string | null }; geometry: { type: string; coordinates: unknown } | null }[] }).features
  .filter((f) => f.geometry)
  .map((f) => ({
    region: f.properties.region as Region | null,
    polygons: f.geometry!.type === 'Polygon' ? [f.geometry!.coordinates as Ring[]] : (f.geometry!.coordinates as Ring[][]),
  }));

/** Standard ray-casting test: is the point inside this ring? */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  // The first ring is the outline; any others are holes.
  return inRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}

/** How far off the coast (in degrees, about 40 km) a spot can be and still count, e.g. dive sites and islands. */
const COAST_SLACK = 0.4;

const cache = new Map<string, Region | null>();

/** The region a point belongs to, or null if it's in another state or far out to sea. */
export function regionOf(lat: number, lng: number): Region | null {
  const key = `${lat},${lng}`;
  if (cache.has(key)) return cache.get(key)!;
  let found: Region | null | undefined;
  for (const s of SHAPES) {
    if (s.polygons.some((p) => inPolygon(lng, lat, p))) {
      found = s.region;
      break;
    }
  }
  if (found === undefined) {
    // Not inside any outline (the outlines are simplified, so coastal spots can fall just outside).
    // Use the nearest state's outline, if it's close.
    let best = Infinity;
    found = null;
    for (const s of SHAPES) {
      for (const p of s.polygons) {
        for (const [x, y] of p[0]) {
          const d = (x - lng) ** 2 + (y - lat) ** 2;
          if (d < best) {
            best = d;
            found = s.region;
          }
        }
      }
    }
    if (best > COAST_SLACK ** 2) found = null;
  }
  cache.set(key, found);
  return found;
}

/** True if the point should show while `region` is selected. 'AUS' shows everything. */
export function inRegion(lat: number, lng: number, region: Region | 'AUS'): boolean {
  return region === 'AUS' || regionOf(lat, lng) === region;
}

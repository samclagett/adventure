import { regionOf } from '../map';

/**
 * Hit list groups for NSW places, by where they are from Sydney (Sam's ask, 2026-11-17, NSW only for now):
 * North of Sydney, Sydney and surrounds, Mountains and inland, South of Sydney. Other states keep the
 * grouping by category.
 *
 * Rough rules, good enough for a list:
 * - Sydney and surrounds: Palm Beach to Royal National Park, west to Penrith (a box around the city).
 * - Mountains and inland: more than about 45 km in from the coast (Blue Mountains, Wollemi,
 *   Barrington, Kosciuszko, Canberra and everything west).
 * - Otherwise north or south of Sydney along the coast.
 */

export type NswArea = 'north' | 'sydney' | 'inland' | 'south';

export const NSW_AREAS: { id: NswArea; label: string }[] = [
  { id: 'north', label: 'North of Sydney' },
  { id: 'sydney', label: 'Sydney and surrounds' },
  { id: 'inland', label: 'Mountains and inland' },
  { id: 'south', label: 'South of Sydney' },
];

const SYDNEY_LAT = -33.87;

/** Longitude of the NSW coast at a latitude, from Tweed Heads to Cape Howe (south is more negative). */
const COAST: [lat: number, lng: number][] = [
  [-28.2, 153.55], [-29.0, 153.45], [-30.0, 153.2], [-31.0, 153.0], [-32.0, 152.55], [-32.5, 152.5],
  [-33.0, 151.75], [-33.5, 151.45], [-33.9, 151.27], [-34.3, 150.95], [-34.6, 150.88], [-35.0, 150.8],
  [-35.3, 150.5], [-35.7, 150.25], [-36.2, 150.12], [-36.8, 149.95], [-37.6, 149.95],
];

function coastLng(lat: number): number {
  if (lat >= COAST[0][0]) return COAST[0][1];
  for (let i = 1; i < COAST.length; i++) {
    const [la, lo] = COAST[i];
    const [pla, plo] = COAST[i - 1];
    if (lat >= la) return plo + ((lat - pla) / (la - pla)) * (lo - plo);
  }
  return COAST[COAST.length - 1][1];
}

/** About 45 km of longitude at NSW latitudes. */
const INLAND_DEG = 0.45;

/** The NSW group for a place, or null if it isn't in NSW (or the ACT). */
export function nswAreaOf(lat: number, lng: number): NswArea | null {
  if (regionOf(lat, lng) !== 'NSW') return null;
  if (lat <= -33.57 && lat >= -34.15 && lng >= 150.6) return 'sydney';
  if (lng < coastLng(lat) - INLAND_DEG) return 'inland';
  return lat > SYDNEY_LAT ? 'north' : 'south';
}

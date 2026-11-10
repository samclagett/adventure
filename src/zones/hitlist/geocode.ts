/**
 * Place search with OpenStreetMap Nominatim (free, no key).
 * Usage policy: at most one request per second and no autocomplete, so we only search when the user
 * presses Search. https://operations.osmfoundation.org/policies/nominatim/
 */

export interface PlaceMatch {
  name: string;
  /** Longer description, e.g. "Blue Mountains National Park, New South Wales". */
  detail: string;
  lat: number;
  lng: number;
}

// The states the app covers. Nominatim's `state` field uses these full names.
const STATES = ['New South Wales', 'Australian Capital Territory', 'Jervis Bay Territory', 'Victoria', 'Tasmania'];
// A box around NSW, ACT, VIC and TAS (west, north, east, south) so results stay local.
const VIEWBOX = '140.9,-28.1,154.0,-43.8';

export async function searchPlaces(query: string): Promise<PlaceMatch[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'au',
    viewbox: VIEWBOX,
    bounded: '1',
    limit: '10',
    'accept-language': 'en',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error(`Place search failed (${res.status}). Try again in a moment.`);
  const rows = (await res.json()) as {
    lat: string;
    lon: string;
    name?: string;
    display_name: string;
    address?: { state?: string; territory?: string };
  }[];
  return rows
    .filter((r) => STATES.includes(r.address?.state ?? r.address?.territory ?? ''))
    .map((r) => {
      const parts = r.display_name.split(', ');
      const name = r.name || parts[0];
      // Drop the name itself, the postcode and "Australia" to keep the detail line short.
      const detail = parts
        .filter((p, i) => !(i === 0 && p === name) && p !== 'Australia' && !/^\d{4}$/.test(p))
        .slice(-3)
        .join(', ');
      return { name, detail, lat: Number(r.lat), lng: Number(r.lon) };
    });
}

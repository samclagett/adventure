/**
 * Home base: where trips start from. Both people share one login, so home is saved on each phone
 * (Sam's phone says Sydney, the friend's says their Victorian home). The Plan screen can start a
 * single search from somewhere else without changing home.
 */

export interface Base {
  name: string;
  lat: number;
  lng: number;
}

const HOME_KEY = 'adventure.home';

/** Quick picks for setting home or a one-off start. */
export const PRESETS: Base[] = [
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { name: 'Melbourne', lat: -37.8136, lng: 144.9631 },
  { name: 'Canberra', lat: -35.2809, lng: 149.13 },
  { name: 'Wollongong', lat: -34.4278, lng: 150.8931 },
  { name: 'Newcastle', lat: -32.9283, lng: 151.7817 },
  { name: 'Hobart', lat: -42.8821, lng: 147.3272 },
];

export function getHome(): Base | null {
  try {
    const h = JSON.parse(localStorage.getItem(HOME_KEY) ?? 'null') as Base | null;
    return h && typeof h.lat === 'number' ? h : null;
  } catch {
    return null;
  }
}

export function setHome(b: Base) {
  try {
    localStorage.setItem(HOME_KEY, JSON.stringify(b));
  } catch {
    /* private mode: it just won't be remembered */
  }
}

/** Straight-line distance in km. Driving is usually 1.3 to 1.5 times this; real travel times come later. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function distanceText(km: number): string {
  if (km < 10) return `${km.toFixed(0)} km`;
  return `${Math.round(km / 5) * 5} km`;
}

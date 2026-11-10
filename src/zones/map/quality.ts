/**
 * Quality setting. "light" keeps phones fast (flat shaded map, no 3D terrain);
 * "full" turns on 3D terrain, sky and sharper rendering.
 */
export type Quality = 'light' | 'full';

const KEY = 'adventure.quality';

/** Phones and small tablets default to light; desktops default to full. */
function defaultQuality(): Quality {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.screen.width, window.screen.height) < 820;
  return coarse && small ? 'light' : 'full';
}

export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'full') return saved;
  } catch {
    // Storage can be blocked (private browsing); fall back to the default.
  }
  return defaultQuality();
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // Ignore: the choice just won't be remembered.
  }
}

const RELIEF_KEY = 'adventure.relief';
export const RELIEF_MIN = 1;
export const RELIEF_MAX = 4;
/** Default height exaggeration: Australia's mountains are old and low, so 2.5x makes them read clearly. */
export const RELIEF_DEFAULT = 2.5;

export function getRelief(): number {
  try {
    const n = Number(localStorage.getItem(RELIEF_KEY));
    if (n >= RELIEF_MIN && n <= RELIEF_MAX) return n;
  } catch {
    // Storage blocked; use the default.
  }
  return RELIEF_DEFAULT;
}

export function saveRelief(r: number) {
  try {
    localStorage.setItem(RELIEF_KEY, String(r));
  } catch {
    // Ignore.
  }
}

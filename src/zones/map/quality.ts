/**
 * Quality setting. "full" (the default everywhere, since iPhones handle it well) turns on 3D terrain,
 * sky and sharper rendering; "light" is a fast flat map for older phones.
 */
import type { Look } from './style';

export type Quality = 'light' | 'full';

// v2: the default changed to 3D (Nov 2026), so earlier saved choices are ignored once.
const KEY = 'adventure.quality.v2';

function defaultQuality(): Quality {
  return 'full';
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

// v2: the default changed from 5x to near real height (Nov 2026).
const RELIEF_KEY = 'adventure.relief.v2';
export const RELIEF_MIN = 1;
export const RELIEF_MAX = 5;
/** Default height: a touch above real, so ranges read without looking spiky. The slider adds drama. */
export const RELIEF_DEFAULT = 1.5;

export function getRelief(): number {
  try {
    const n = Number(localStorage.getItem(RELIEF_KEY));
    if (n >= RELIEF_MIN && n <= RELIEF_MAX) return n;
  } catch {
    // Storage blocked; use the default.
  }
  return RELIEF_DEFAULT;
}

// The map look (style.ts LOOKS): "classic" until Sam picks, then the default can change here.
const LOOK_KEY = 'adventure.look.v1';
export const LOOK_DEFAULT: Look = 'classic';

export function getLook(): Look {
  try {
    const v = localStorage.getItem(LOOK_KEY);
    if (v === 'classic' || v === 'crisp') return v;
  } catch {
    // Storage blocked; use the default.
  }
  return LOOK_DEFAULT;
}

export function saveLook(l: Look) {
  try {
    localStorage.setItem(LOOK_KEY, l);
  } catch {
    // Ignore.
  }
}

export function saveRelief(r: number) {
  try {
    localStorage.setItem(RELIEF_KEY, String(r));
  } catch {
    // Ignore.
  }
}

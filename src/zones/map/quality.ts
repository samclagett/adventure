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

/**
 * Pulls coordinates out of a pasted Google Maps link, or plain "lat, lng" text.
 *
 * Short share links (maps.app.goo.gl/...) can't be expanded inside a browser app, because
 * Google blocks that for other websites. The user has to open the link first and copy the full one.
 */

export type LinkResult =
  | { ok: true; lat: number; lng: number; name?: string }
  | { ok: false; message: string };

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

// Most precise first: !3d!4d is the place itself, @ is only where the map was looking.
const PATTERNS = [
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(`[?&](?:q|query|ll|destination|daddr|center)=${NUM},\\s*${NUM}`),
  new RegExp(`/place/${NUM},\\s*${NUM}`),
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(`^${NUM}\\s*,\\s*${NUM}$`),
];

export const SHORT_LINK_HELP =
  'Short links (maps.app.goo.gl) can’t be read here. Open the link in Safari, wait for the map, then copy the full address from the address bar and paste that. Or long-press the spot in Google Maps and paste the numbers it shows.';

export function parseLocationText(input: string): LinkResult {
  const text = input.trim();
  if (!text) return { ok: false, message: 'Paste a Google Maps link first.' };
  if (/maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs/i.test(text)) return { ok: false, message: SHORT_LINK_HELP };

  let decoded = text;
  try {
    decoded = decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    // Badly encoded link; search the raw text instead.
  }

  for (const re of PATTERNS) {
    const m = decoded.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const place = decoded.match(/\/place\/([^/@]+)/)?.[1]?.trim();
    const name = place && !/^-?\d/.test(place) ? place : undefined;
    return { ok: true, lat, lng, name };
  }
  return { ok: false, message: 'Couldn’t find coordinates in that. Paste the full Google Maps link, or numbers like -33.86, 151.21.' };
}

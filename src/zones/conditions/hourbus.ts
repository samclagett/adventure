/**
 * Which hour a place is showing, shared between the day chart's slider (card.ts) and the 3D spot view
 * (zones/spot), so dragging the slider moves the 3D scene to that hour and stepping the scene moves the slider.
 * Times are "YYYY-MM-DDTHH:00" in Sydney time, as in the forecast.
 */

export type HourSource = 'chart' | 'spot';
type Listener = (itemId: string, time: string, from: HourSource) => void;

const listeners = new Set<Listener>();
const last = new Map<string, string>();

/** Say that a place is now showing this hour. Every other listener hears it. */
export function setHour(itemId: string, time: string, from: HourSource) {
  if (last.get(itemId) === time) return;
  last.set(itemId, time);
  for (const fn of listeners) fn(itemId, time, from);
}

/** The hour last picked for a place, if any. */
export const lastHour = (itemId: string) => last.get(itemId) ?? null;

/** Listen for hour changes. Returns a function that stops listening. */
export function onHour(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

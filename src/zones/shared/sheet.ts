/**
 * Bottom sheets you can drag, like Apple Maps and AllTrails.
 *
 * A sheet rests at one of three heights ("snaps"): peek (just the top of a place card), half and full.
 * Drag the grab bar, or anything marked `data-drag`, up or down; let go and it settles on the nearest
 * snap (a quick flick moves one snap that way). Dragging below the lowest snap closes the sheet. Tapping
 * the grab bar steps up one snap, or back down from the top.
 *
 * The zone that owns the sheet puts `<div class="sheet-grab"></div>` first in its markup each time it
 * draws it, then calls `open(...)` to pick the starting height.
 */

export type Snap = 'peek' | 'half' | 'full';

export interface DragSheet {
  /**
   * Set the sheet's height. `snaps` are the heights allowed while it's open; `peek` is the peek height in pixels.
   * `top` is how much screen stays clear above the sheet at its full height (default 56 px: the status bar and a strip of map).
   */
  open(start: Snap, snaps: Snap[], peek?: number, top?: number): void;
  /** The snap the sheet is resting on. */
  snap(): Snap;
}

const FLICK = 0.5; // px per ms
const CLOSE_PAST = 70; // px dragged below the lowest snap

export function makeDraggable(sheet: HTMLElement, onClose: () => void, onSettle?: (snap: Snap) => void): DragSheet {
  let snaps: Snap[] = ['half', 'full'];
  let current: Snap = 'half';
  let peekPx = 200;
  let topPx = 56;

  /** Room between the tab bar and the top of the screen. */
  function room(): number {
    const parent = sheet.offsetParent as HTMLElement | null;
    const bottom = parseFloat(getComputedStyle(sheet).bottom) || 0;
    return (parent?.clientHeight ?? window.innerHeight) - bottom;
  }

  function heightOf(s: Snap): number {
    const r = room();
    const full = r - topPx;
    if (s === 'full') return full;
    if (s === 'half') return Math.min(full, Math.round(r * 0.55));
    return Math.min(full, peekPx);
  }

  function setHeight(px: number, animate: boolean) {
    sheet.classList.toggle('sheet-anim', animate);
    sheet.style.height = `${Math.max(0, Math.round(px))}px`;
  }

  function settle(s: Snap) {
    current = s;
    setHeight(heightOf(s), true);
    onSettle?.(s);
  }

  // ---- Dragging ----
  let startY = 0;
  let startH = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;
  let moved = false;
  let dragging = false;

  sheet.addEventListener('pointerdown', (e) => {
    const handle = (e.target as HTMLElement).closest('.sheet-grab, [data-drag]');
    if (!handle || (e.target as HTMLElement).closest('button:not(.sheet-grab), a, input, textarea')) return;
    dragging = true;
    moved = false;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    startH = sheet.getBoundingClientRect().height;
    speed = 0;
    sheet.setPointerCapture(e.pointerId);
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < 6) return;
    moved = true;
    const dt = Math.max(1, e.timeStamp - lastT);
    speed = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    setHeight(Math.min(heightOf('full'), startH - dy), false);
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    const heights = snaps.map(heightOf);
    if (!moved) {
      // A tap on the grab bar: up one snap, or back down from the top.
      const i = snaps.indexOf(current);
      settle(snaps[i < snaps.length - 1 ? i + 1 : Math.max(0, i - 1)]);
      return;
    }
    const h = sheet.getBoundingClientRect().height;
    if (h < heights[0] - CLOSE_PAST || (speed > FLICK && h < heights[0])) {
      sheet.style.height = '';
      onClose();
      return;
    }
    let i: number;
    if (speed > FLICK) i = Math.max(0, heights.filter((x) => x < h).length - 1);
    else if (speed < -FLICK) i = Math.min(heights.length - 1, heights.filter((x) => x <= h).length);
    else i = heights.reduce((best, x, n) => (Math.abs(x - h) < Math.abs(heights[best] - h) ? n : best), 0);
    settle(snaps[i]);
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);

  // Keep the height right when the phone turns or the window changes size.
  window.addEventListener('resize', () => {
    if (!sheet.hidden && sheet.style.height) setHeight(heightOf(current), false);
  });

  return {
    open(start, allowed, peek, top) {
      snaps = allowed;
      if (peek) peekPx = peek;
      topPx = top ?? 56;
      current = start;
      setHeight(heightOf(start), !sheet.hidden && !!sheet.style.height);
      onSettle?.(start);
    },
    snap: () => current,
  };
}

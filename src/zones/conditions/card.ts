import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { ConditionsData } from './data';
import { WINDOWS, daysFor, daysOf, rowsFor, rateDay, type WindowId } from './summary';

/** The day-by-day Conditions section on each pin card. */

const WINDOW_KEY = 'adventure.conditions.window';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function mountCardSection(hl: HitListApi, data: ConditionsData, visible: () => HitListItem[]) {
  let windowId: WindowId = 'week';
  try {
    const saved = localStorage.getItem(WINDOW_KEY) as WindowId | null;
    if (saved && WINDOWS.some((w) => w.id === saved)) windowId = saved;
  } catch {
    /* private mode */
  }
  let refill: (() => void) | null = null;
  data.onChange(() => refill?.());

  hl.addCardSection((item, el) => {
    if (item.lat == null || item.lng == null) return;
    el.className = 'cd-card';
    const cat = categoryOf(item.activity).id;
    const fill = () => {
      if (!el.isConnected) {
        if (refill === fill) refill = null;
        return;
      }
      const f = data.get(item);
      if (!f) {
        el.innerHTML = `<h3>Conditions</h3><p class="cd-muted">${data.loading ? 'Getting the forecast…' : esc(data.error) || 'No forecast yet.'}</p>`;
        return;
      }
      const days = daysOf(f, daysFor(windowId), cat, item.faces);
      const rows = rowsFor(cat, days);
      const water = days.map((d) => d.water).filter((w): w is number => w != null);
      const notes: string[] = [];
      if (cat === 'surfing') {
        notes.push('Swell is model open-ocean swell in metres, not Surfline’s face height in feet.');
        if (item.faces == null) notes.push('Set which way the beach faces (Edit) to see onshore and offshore wind.');
        if (!f.marine) notes.push('No marine forecast for this spot.');
      }
      el.innerHTML = `<h3>Conditions</h3>
        <div class="cd-windows">${WINDOWS.map((w) => `<button type="button" data-win="${w.id}" class="${w.id === windowId ? 'on' : ''}">${w.label}</button>`).join('')}</div>
        ${water.length ? `<p class="cd-muted">Water about ${Math.round(water.reduce((a, b) => a + b, 0) / water.length)}°</p>` : ''}
        ${rows.length ? `<div class="cd-days">${rows
          .map((r, n) => {
            const rated = rateDay(cat, days[n]);
            const why = rated.verdict !== 'go' && rated.why.length && !r.verdict ? `<small>${esc(rated.why.join(', '))}</small>` : '';
            return `<div class="cd-day cd-v-${rated.verdict}">${r.cells
              .filter(Boolean)
              .map((c, i) => `<span class="${i === 0 ? 'cd-day-name' : r.verdict && i === 1 ? 'cd-verdict' : ''}">${esc(c)}</span>`)
              .join('')}${r.extra ? `<small>${esc(r.extra)}</small>` : ''}${why}</div>`;
          })
          .join('')}</div>` : '<p class="cd-muted">No forecast for these days yet.</p>'}
        ${notes.map((n) => `<p class="cd-muted">${esc(n)}</p>`).join('')}`;
      el.querySelectorAll<HTMLButtonElement>('[data-win]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          windowId = b.dataset.win as WindowId;
          try {
            localStorage.setItem(WINDOW_KEY, windowId);
          } catch {
            /* private mode */
          }
          fill();
        }),
      );
    };
    refill = fill;
    fill();
    if (!data.get(item)) data.ensure([item, ...visible().filter((v) => v.id !== item.id)]);
  });
}

import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { ConditionsData } from './data';
import { WINDOWS, daysFor, daysOf, rowsFor, rateDay, compass, dayShort, todayIso, VERDICT_WORD, type Period, type Verdict, type WindowId } from './summary';
import { getHome } from './home';
import { ensureDrives, onDriveChange, travelText } from './drive';
import { WEATHER_ICONS, KIND_WORD, windArrow } from './weather-icons';

/**
 * Conditions on each place card: a short summary at the top (best of the next four days, a day strip and
 * the distance from home), and the day-by-day section further down.
 */

const WINDOW_KEY = 'adventure.conditions.window';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** One part of a day: label, weather symbol, temperature, rain if any, and wind. */
function periodHtml(p: Period): string {
  const wet = (p.rain ?? 0) >= 0.2 || (p.rainProb ?? 0) >= 30;
  const rain = wet
    ? `<span class="cd-p-rain">${[(p.rain ?? 0) >= 0.5 ? `${Math.round(p.rain!)} mm` : '', p.rainProb != null ? `${p.rainProb}%` : ''].filter(Boolean).join(' ')}</span>`
    : '';
  const wind = p.wind != null ? `<span class="cd-p-wind">${p.windDir != null ? windArrow(p.windDir, 'wx-a-wind') : ''}${Math.round(p.wind)} km/h</span>` : '';
  const said = [
    p.label === 'Night' ? 'Night' : p.label,
    KIND_WORD[p.kind],
    p.temp != null ? `${p.id === 'night' ? 'low' : 'high'} ${Math.round(p.temp)} degrees` : '',
    wet ? `${p.rainProb ?? 0}% chance of rain` : '',
    p.wind != null ? `wind ${p.windDir != null ? compass(p.windDir) + ' ' : ''}${Math.round(p.wind)} km/h` : '',
  ].filter(Boolean).join(', ');
  return `<span class="cd-p cd-p-${p.id}" role="img" aria-label="${esc(said)}" title="${esc(said)}"><span class="cd-p-label">${p.label}</span>${WEATHER_ICONS[p.kind]}${p.temp != null ? `<b>${Math.round(p.temp)}°</b>` : '<b></b>'}<span class="cd-p-meta">${wind}${rain}</span></span>`;
}

/** The summary at the top of a place card, shown even when the card is pulled down. */
function summaryHtml(item: HitListItem, data: ConditionsData): string {
  const home = getHome();
  const dist = home && item.lat != null ? `${travelText(home, { lat: item.lat, lng: item.lng! })} from ${home.name}` : '';
  const f = data.get(item);
  if (!f) return `<div class="cd-sum"><span class="cd-muted">${data.loading ? 'Getting the forecast…' : 'No forecast yet'}</span></div>${dist ? `<small class="cd-sum-dist">${esc(dist)}</small>` : ''}`;
  const cat = categoryOf(item.activity).id;
  const dates = daysFor('5days').slice(0, 4);
  const verdicts: Verdict[] = daysOf(f, dates, cat, item.faces).map((d) => rateDay(cat, d).verdict);
  const name = (iso: string) => (iso === todayIso() ? 'today' : dayShort(iso));
  const firstGo = verdicts.indexOf('go');
  const firstMar = verdicts.indexOf('mar');
  const pill =
    firstGo >= 0
      ? `<span class="cd-pill cd-v-go">Go ${name(dates[firstGo])}</span>`
      : firstMar >= 0
        ? `<span class="cd-pill cd-v-mar">${VERDICT_WORD.mar} ${name(dates[firstMar])}</span>`
        : `<span class="cd-pill cd-v-skip">Not in the next 4 days</span>`;
  const strip = dates.map((d, n) => `<span class="cd-v-${verdicts[n]}" title="${dayShort(d)}: ${VERDICT_WORD[verdicts[n]]}">${dayShort(d)}</span>`).join('');
  return `<div class="cd-sum">${pill}<span class="cd-sum-days">${strip}</span></div>${dist ? `<small class="cd-sum-dist">${esc(dist)}</small>` : ''}`;
}

export function mountCardSection(hl: HitListApi, data: ConditionsData, visible: () => HitListItem[]) {
  let refillSummary: (() => void) | null = null;
  data.onChange(() => refillSummary?.());
  onDriveChange(() => refillSummary?.());
  hl.addCardSummary((item, el) => {
    if (item.lat == null || item.lng == null) return;
    const fill = () => {
      if (!el.isConnected) return;
      el.innerHTML = summaryHtml(item, data);
    };
    refillSummary = fill;
    fill();
    const home = getHome();
    if (home) void ensureDrives(home, [item]);
  });

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
              .join('')}${days[n].periods.length ? `<span class="cd-periods">${days[n].periods.map(periodHtml).join('')}</span>` : ''}${r.extra ? `<small>${esc(r.extra)}</small>` : ''}${why}</div>`;
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

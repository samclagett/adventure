import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { ConditionsData } from './data';
import { WINDOWS, daysFor, daysOf, rowsFor, rateDay, compass, dayShort, todayIso, windArrowClass, windRange, VERDICT_WORD, type Period, type Verdict, type WindowId } from './summary';
import { getHome } from './home';
import { ensureDrives, onDriveChange, travelText } from './drive';
import { WEATHER_ICONS, KIND_WORD, windArrow } from './weather-icons';
import { openMatrix, TABLE_ICON } from './matrix';
import { alertIcons, alertLines } from './alerts';
import type { Alert } from './ratings';
import { snowHtml, onSnowChange } from './snow';
import { dayChart, pickedDay } from './daychart';
import { MARINE_DAYS } from './openmeteo';

/**
 * Conditions on each place card: a short summary at the top (best of the next four days, a day strip and
 * the distance from home), and the day-by-day section further down.
 */

const WINDOW_KEY = 'adventure.conditions.window';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** One part of a day: label, weather symbol, temperature, rain if any, and wind (coloured at surf spots). */
function periodHtml(p: Period, cat: string, faces: number | null): string {
  const wet = (p.rain ?? 0) >= 0.2 || (p.rainProb ?? 0) >= 30;
  const rain = wet
    ? `<span class="cd-p-rain">${[(p.rain ?? 0) >= 0.5 ? `${Math.round(p.rain!)} mm` : '', p.rainProb != null ? `${p.rainProb}%` : ''].filter(Boolean).join(' ')}</span>`
    : '';
  const wind = p.wind != null ? `<span class="cd-p-wind">${p.windDir != null ? windArrow(p.windDir, windArrowClass(cat, faces, p.windDir)) : ''}${windRange(p)} km/h</span>` : '';
  const said = [
    p.label === 'Night' ? 'Night' : p.label,
    KIND_WORD[p.kind],
    p.temp != null ? `${p.id === 'night' ? 'low' : 'high'} ${Math.round(p.temp)} degrees` : '',
    wet ? `${p.rainProb ?? 0}% chance of rain` : '',
    p.wind != null ? `wind ${p.windDir != null ? compass(p.windDir) + ' ' : ''}${Math.round(p.wind)} km/h${p.gust != null ? `, gusts to ${Math.round(p.gust)}` : ''}` : '',
  ].filter(Boolean).join(', ');
  return `<span class="cd-p cd-p-${p.id}" role="img" aria-label="${esc(said)}" title="${esc(said)}"><span class="cd-p-label">${p.label}</span>${WEATHER_ICONS[p.kind]}${p.temp != null ? `<b>${Math.round(p.temp)}°</b>` : '<b></b>'}<span class="cd-p-meta">${wind}${rain}</span></span>`;
}

/** The days in the summary strip and the hour-by-hour chart: a week (the marine forecast goes out eight days). */
const STRIP_DAYS = Math.min(7, MARINE_DAYS);
const stripDates = () => daysFor('2weeks').slice(0, STRIP_DAYS);

/**
 * The summary at the top of a place card, shown even when the card is pulled down: the best day, a strip of
 * days (tap one to chart it) and the hour-by-hour chart for the chosen day (daychart.ts).
 */
function summaryHtml(item: HitListItem, data: ConditionsData, chosen: string, dayWidth: number): string {
  const home = getHome();
  const dist = home && item.lat != null ? `${travelText(home, { lat: item.lat, lng: item.lng! })} from ${home.name}` : '';
  const f = data.get(item);
  if (!f) return `<div class="cd-sum"><span class="cd-muted">${data.loading ? 'Getting the forecast…' : 'No forecast yet'}</span></div>${dist ? `<small class="cd-sum-dist">${esc(dist)}</small>` : ''}`;
  const cat = categoryOf(item.activity).id;
  const dates = stripDates();
  const rated = daysOf(f, dates, cat, item).map((d) => ({ date: d.date, ...rateDay(cat, d) }));
  const verdictOn = (iso: string): Verdict => rated.find((r) => r.date === iso)?.verdict ?? 'na';
  // Alerts over the next four days, one of each kind (they don't change the rating colour).
  const alerts: Alert[] = [];
  for (const r of rated.slice(0, 4)) for (const a of r.alerts) if (!alerts.some((b) => b.kind === a.kind)) alerts.push(a);
  const name = (iso: string) => (iso === todayIso() ? 'today' : dayShort(iso));
  const next4 = dates.slice(0, 4);
  const firstGo = next4.find((d) => verdictOn(d) === 'go');
  const firstMar = next4.find((d) => verdictOn(d) === 'mar');
  const pill = firstGo
    ? `<span class="cd-pill cd-v-go">Go ${name(firstGo)}</span>`
    : firstMar
      ? `<span class="cd-pill cd-v-mar">${VERDICT_WORD.mar} ${name(firstMar)}</span>`
      : `<span class="cd-pill cd-v-skip">Not in the next 4 days</span>`;
  const strip = dates
    .map((d) => {
      const v = verdictOn(d);
      return `<button type="button" data-day="${d}" class="cd-v-${v}${d === chosen ? ' on' : ''}" aria-pressed="${d === chosen}" aria-label="${dayShort(d)}: ${VERDICT_WORD[v]}. Show hour by hour">${dayShort(d)}</button>`;
    })
    .join('');
  const table = `<button type="button" class="cd-table-btn" data-act="matrix" aria-label="Morning and afternoon conditions table">${TABLE_ICON}<span>AM / PM</span></button>`;
  const chart = dayChart(item, f, { dates, dayWidth });
  return `<div class="cd-sum">${pill}${table}</div><div class="cd-sum-days" style="grid-template-columns:repeat(${dates.length},1fr)">${strip}</div>${chart ?? ''}${alertLines(alerts)}${cat === 'skiing' ? snowHtml(item) : ''}${dist ? `<small class="cd-sum-dist">${esc(dist)}</small>` : ''}`;
}

export function mountCardSection(hl: HitListApi, data: ConditionsData, visible: () => HitListItem[]) {
  let refillSummary: (() => void) | null = null;
  data.onChange(() => refillSummary?.());
  onDriveChange(() => refillSummary?.());
  onSnowChange(() => refillSummary?.());
  hl.addCardSummary((item, el) => {
    if (item.lat == null || item.lng == null) return;
    // The card opens on the day picked on the map (or today). The chart scrolls through the week; the strip
    // follows it, and a tap on the strip scrolls the chart to that day.
    const dates = stripDates();
    const p = pickedDay();
    let chosen = p && dates.includes(p) ? p : dates[0];
    const mark = () =>
      el.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((b) => {
        b.classList.toggle('on', b.dataset.day === chosen);
        b.setAttribute('aria-pressed', String(b.dataset.day === chosen));
      });
    const fill = () => {
      if (!el.isConnected) return;
      const dayWidth = Math.max(280, el.clientWidth - 2);
      el.innerHTML = summaryHtml(item, data, chosen, dayWidth);
      const scroller = el.querySelector<HTMLElement>('.dc-scroll');
      if (scroller) {
        scroller.scrollLeft = Math.max(0, dates.indexOf(chosen)) * dayWidth;
        let ticking = false;
        scroller.addEventListener('scroll', () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            const n = Math.min(dates.length - 1, Math.floor((scroller.scrollLeft + dayWidth * 0.5) / dayWidth));
            if (dates[n] !== chosen) {
              chosen = dates[n];
              mark();
            }
          });
        });
      }
      el.querySelector('[data-act="matrix"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = data.get(item);
        if (f) openMatrix(item, f);
      });
      el.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          chosen = b.dataset.day!;
          mark();
          el.querySelector('.dc-scroll')?.scrollTo({ left: dates.indexOf(chosen) * dayWidth, behavior: 'smooth' });
        }),
      );
    };
    refillSummary = fill;
    fill();
    const home = getHome();
    if (home) void ensureDrives(home, [item]);
  });

  let windowId: WindowId = '5days';
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
      const days = daysOf(f, daysFor(windowId), cat, item);
      const rows = rowsFor(cat, days);
      const water = days.map((d) => d.water).filter((w): w is number => w != null);
      const notes: string[] = [];
      if (cat === 'surfing') {
        notes.push('Swell is model wave height in metres (all swells plus wind waves, like WillyWeather), not Surfline’s face height in feet.');
        if (item.faces == null) notes.push('Set which way the beach faces (Edit) to see onshore and offshore wind.');
        if (!f.marine) notes.push('No marine forecast for this spot.');
      }
      el.innerHTML = `<div class="cd-card-head"><h3>Conditions</h3><button type="button" class="cd-table-btn" data-act="matrix">${TABLE_ICON}<span>AM / PM table</span></button></div>
        <div class="cd-windows">${WINDOWS.map((w) => `<button type="button" data-win="${w.id}" class="${w.id === windowId ? 'on' : ''}">${w.label}</button>`).join('')}</div>
        ${water.length ? `<p class="cd-muted">Water about ${Math.round(water.reduce((a, b) => a + b, 0) / water.length)}°</p>` : ''}
        ${rows.length ? `<div class="cd-days">${rows
          .map((r, n) => {
            const rated = rateDay(cat, days[n]);
            const why = rated.verdict !== 'go' && rated.why.length ? `<small>${esc(rated.why.join(', '))}</small>` : '';
            return `<div class="cd-day cd-v-${rated.verdict}">${r.cells
              .filter(Boolean)
              .map((c, i) => `<span class="${i === 0 ? 'cd-day-name' : r.verdict && i === 1 ? 'cd-verdict' : ''}">${esc(c)}</span>`)
              .join('')}${alertIcons(rated.alerts)}${days[n].periods.length ? `<span class="cd-periods">${days[n].periods.map((p) => periodHtml(p, cat, item.faces)).join('')}</span>` : ''}${r.extra ? `<small>${esc(r.extra)}</small>` : ''}${why}</div>`;
          })
          .join('')}</div>` : '<p class="cd-muted">No forecast for these days yet.</p>'}
        ${notes.map((n) => `<p class="cd-muted">${esc(n)}</p>`).join('')}`;
      el.querySelector('[data-act="matrix"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openMatrix(item, f);
      });
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

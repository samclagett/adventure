import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { ConditionsData } from './data';
import { WINDOWS, daysFor, daysOf, rowsFor, rateDay, rateParts, compass, dayShort, todayIso, windArrowClass, windRange, VERDICT_WORD, type Period, type Verdict, type WindowId } from './summary';
import { getHome } from './home';
import { ensureDrives, onDriveChange, travelText } from './drive';
import { WEATHER_ICONS, KIND_WORD, windArrow } from './weather-icons';
import { openMatrix, TABLE_ICON } from './matrix';
import { alertIcons, alertLines } from './alerts';
import type { Alert } from './ratings';
import { snowHtml, onSnowChange } from './snow';
import { dayChart, pickedDay, chartHours, readoutHtml, offshoreText } from './daychart';
import { onHour, setHour } from './hourbus';
import { MARINE_DAYS } from './openmeteo';
import { surfLineHtml, refreshSurfLine, wireSurfReport, loadReports } from './surfreport';
import { onSurfChange } from './surfsize';

/**
 * Conditions on each place card: a short summary at the top (best of the next four days, a day strip and
 * the distance from home), and the day-by-day section further down.
 */

const WINDOW_KEY = 'adventure.conditions.window';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** One part of a day: label, weather symbol, temperature, rain if any, and wind (coloured at surf spots). */
function periodHtml(p: Period, cat: string, faces: number | null, verdict: Verdict | null = null): string {
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
  const v = verdict ? ` cd-v-${verdict}` : '';
  const word = verdict ? `<i class="cd-p-v">${VERDICT_WORD[verdict]}</i>` : '';
  return `<span class="cd-p cd-p-${p.id}${v}" role="img" aria-label="${esc(said + (verdict ? `. ${VERDICT_WORD[verdict]}` : ''))}" title="${esc(said)}"><span class="cd-p-label">${p.label}${word}</span>${WEATHER_ICONS[p.kind]}${p.temp != null ? `<b>${Math.round(p.temp)}°</b>` : '<b></b>'}<span class="cd-p-meta">${wind}${rain}</span></span>`;
}

/** The rating colour of one part of a day (AM, PM or Night), to colour that part's box. */
function partVerdict(cat: string, d: Parameters<typeof rateParts>[1], id: Period['id']): Verdict | null {
  const parts = rateParts(cat, d);
  return (parts.find((x) => x.id === id) ?? (parts.length === 1 ? parts[0] : null))?.rated.verdict ?? null;
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
  const days = daysOf(f, dates, cat, item);
  const rated = days.map((d) => ({ date: d.date, ...rateDay(cat, d), parts: rateParts(cat, d) }));
  // Each day is coloured in two halves, AM and PM (Sam, 2026-11-28). Camping (the night) and skiing stay whole.
  const partsOn = (iso: string) => rated.find((r) => r.date === iso)?.parts ?? [];
  const halves = (iso: string): [Verdict, Verdict] => {
    const p = partsOn(iso);
    if (!p.length) return ['na', 'na'];
    return [p[0].rated.verdict, (p[1] ?? p[0]).rated.verdict];
  };
  // Alerts over the next four days, one of each kind (they don't change the rating colour).
  const alerts: Alert[] = [];
  for (const r of rated.slice(0, 4)) for (const a of r.alerts) if (!alerts.some((b) => b.kind === a.kind)) alerts.push(a);
  const name = (iso: string) => (iso === todayIso() ? 'today' : dayShort(iso));
  const next4 = dates.slice(0, 4);
  /** "today", "Sat AM" or "Sat PM": the first day (and part of it, when only one is) with this rating. */
  const firstWith = (v: Verdict): string | null => {
    for (const d of next4) {
      const p = partsOn(d);
      const hits = p.filter((x) => x.rated.verdict === v);
      if (hits.length) return hits.length === p.length || p.length === 1 ? name(d) : `${name(d)} ${hits[0].label}`;
    }
    return null;
  };
  const firstGo = firstWith('go');
  const firstMar = firstGo ? null : firstWith('mar');
  const pill = firstGo
    ? `<span class="cd-pill cd-v-go">Go ${firstGo}</span>`
    : firstMar
      ? `<span class="cd-pill cd-v-mar">${VERDICT_WORD.mar} ${firstMar}</span>`
      : `<span class="cd-pill cd-v-skip">Not in the next 4 days</span>`;
  const strip = dates
    .map((d) => {
      const [am, pm] = halves(d);
      const said = am === pm ? VERDICT_WORD[am] : `morning ${VERDICT_WORD[am]}, afternoon ${VERDICT_WORD[pm]}`;
      return `<button type="button" data-day="${d}" class="cd-h cd-am-${am} cd-pm-${pm}${d === chosen ? ' on' : ''}" aria-pressed="${d === chosen}" aria-label="${dayShort(d)}: ${said}. Show hour by hour">${dayShort(d)}</button>`;
    })
    .join('');
  const off = cat === 'surfing' && item.faces != null ? `<p class="cd-offshore${offshoreText(f, chosen, item.faces).startsWith('No') ? ' none' : ''}" data-offshore>${esc(offshoreText(f, chosen, item.faces))}</p>` : '';
  const table = `<button type="button" class="cd-table-btn" data-act="matrix" aria-label="Morning and afternoon conditions table">${TABLE_ICON}<span>AM / PM</span></button>`;
  const chart = dayChart(item, f, { dates, dayWidth });
  return `<div class="cd-sum">${pill}${table}</div><div class="cd-sum-days" style="grid-template-columns:repeat(${dates.length},1fr)">${strip}</div>${cat === 'surfing' ? surfLineHtml(item, f, chosen) : ''}${off}${chart ?? ''}${alertLines(alerts)}${cat === 'skiing' ? snowHtml(item) : ''}${dist ? `<small class="cd-sum-dist">${esc(dist)}</small>` : ''}`;
}

export function mountCardSection(hl: HitListApi, data: ConditionsData, visible: () => HitListItem[]) {
  let refillSummary: (() => void) | null = null;
  data.onChange(() => refillSummary?.());
  onDriveChange(() => refillSummary?.());
  onSnowChange(() => refillSummary?.());
  onSurfChange(() => refillSummary?.());
  void loadReports();
  hl.addCardSummary((item, el) => {
    if (item.lat == null || item.lng == null) return;
    // Surf spots: the estimated surf line and its "What did you see?" report (surfreport.ts).
    if (categoryOf(item.activity).id === 'surfing') wireSurfReport(el, item, () => data.get(item));
    // The card opens on the day picked on the map (or today). The chart scrolls through the week; the strip
    // follows it, and a tap on the strip scrolls the chart to that day.
    const dates = stripDates();
    const p = pickedDay();
    let chosen = p && dates.includes(p) ? p : dates[0];
    const mark = () => {
      el.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((b) => {
        b.classList.toggle('on', b.dataset.day === chosen);
        b.setAttribute('aria-pressed', String(b.dataset.day === chosen));
      });
      refreshSurfLine(el, item, data.get(item), chosen);
      const off = el.querySelector<HTMLElement>('[data-offshore]');
      const f = data.get(item);
      if (off && f && item.faces != null) {
        off.textContent = offshoreText(f, chosen, item.faces);
        off.classList.toggle('none', off.textContent.startsWith('No'));
      }
    };
    // The slider on the chart: an hour, counted from the first midnight. It stays put on screen while the chart
    // scrolls under it, follows a drag along the track under the chart or a tap on the chart, and tells the
    // 3D view (hourbus.ts) which hour to show. The 3D view's own ‹ › steps move it too.
    let cursorT: number | null = null;
    let stopListening: (() => void) | null = null;
    const fill = () => {
      stopListening?.();
      stopListening = null;
      if (!el.isConnected) return;
      const dayWidth = Math.max(280, el.clientWidth - 2);
      el.innerHTML = summaryHtml(item, data, chosen, dayWidth);
      const scroller = el.querySelector<HTMLElement>('.dc-scroll');
      const f = data.get(item);
      if (scroller && f) {
        const hw = dayWidth / 24;
        const hrs = chartHours(f, dates);
        const last = Math.max(0, Math.min(hrs.length, Math.round(scroller.scrollWidth / hw)) - 1);
        const cursor = el.querySelector<HTMLElement>('.dc-cursor')!;
        const track = el.querySelector<HTMLElement>('.dc-track')!;
        const knob = el.querySelector<HTMLElement>('.dc-knob')!;
        const readout = el.querySelector<HTMLElement>('.dc-readout')!;
        const timeOf = (t: number) => `${dates[Math.floor(t / 24)]}T${String(t % 24).padStart(2, '0')}:00`;
        const dayIdx = Math.max(0, dates.indexOf(chosen));
        if (cursorT == null) {
          // Today: now. Another day: early morning at the coast, mid-morning elsewhere.
          const nowH = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
          cursorT = dayIdx * 24 + (chosen === todayIso() ? nowH : categoryOf(item.activity).id === 'surfing' ? 7 : 10);
        }
        scroller.scrollLeft = dayIdx * dayWidth;
        let screenX = (cursorT + 0.5) * hw - scroller.scrollLeft;
        if (screenX < 0 || screenX > scroller.clientWidth) screenX = scroller.clientWidth / 3;
        let shown = -1;
        const place = () => {
          const t = Math.max(0, Math.min(last, Math.floor((scroller.scrollLeft + screenX) / hw)));
          const x = scroller.offsetLeft + scroller.clientLeft + (t + 0.5) * hw - scroller.scrollLeft;
          if (t !== shown) readout.innerHTML = readoutHtml(item, f, hrs, dates, t);
          cursor.style.transform = `translateX(${x.toFixed(1)}px)`;
          cursor.style.top = `${scroller.offsetTop}px`;
          cursor.style.height = `${scroller.offsetHeight}px`;
          knob.style.transform = `translateX(${x.toFixed(1)}px)`;
          if (t === shown) return;
          shown = t;
          cursorT = t;
          track.setAttribute('aria-valuetext', readout.textContent ?? '');
          const day = dates[Math.floor(t / 24)];
          if (day && day !== chosen) {
            chosen = day;
            mark();
          }
          setHour(item.id, timeOf(t), 'chart');
        };
        let ticking = false;
        scroller.addEventListener('scroll', () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            place();
          });
        });
        // Tap the chart to move the slider there.
        scroller.addEventListener('click', (e) => {
          screenX = e.clientX - scroller.getBoundingClientRect().left - scroller.clientLeft;
          place();
        });
        // Drag along the track. Near either end the chart scrolls on, so the slider can go through the week.
        let edge = 0;
        let edgeLoop = 0;
        const nudge = () => {
          edgeLoop = 0;
          if (!edge) return;
          scroller.scrollLeft += edge * 6;
          place();
          edgeLoop = requestAnimationFrame(nudge);
        };
        const moveTo = (clientX: number) => {
          const w = scroller.clientWidth;
          screenX = Math.max(1, Math.min(w - 1, clientX - scroller.getBoundingClientRect().left - scroller.clientLeft));
          edge = screenX < 24 ? -1 : screenX > w - 24 ? 1 : 0;
          if (edge && !edgeLoop) edgeLoop = requestAnimationFrame(nudge);
          place();
        };
        track.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          track.setPointerCapture(e.pointerId);
          track.classList.add('dragging');
          moveTo(e.clientX);
        });
        track.addEventListener('pointermove', (e) => {
          if (track.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
        });
        const end = (e: PointerEvent) => {
          edge = 0;
          track.classList.remove('dragging');
          if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        };
        track.addEventListener('pointerup', end);
        track.addEventListener('pointercancel', end);
        track.addEventListener('click', (e) => e.stopPropagation());
        track.addEventListener('keydown', (e) => {
          const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
          if (!step) return;
          e.preventDefault();
          showT(Math.max(0, Math.min(last, (cursorT ?? 0) + step)));
        });
        /** Put the slider on hour `t`, scrolling the chart if that hour is off screen. */
        const showT = (t: number) => {
          const w = scroller.clientWidth;
          const x = (t + 0.5) * hw - scroller.scrollLeft;
          if (x < hw || x > w - hw) {
            scroller.scrollLeft = (t + 0.5) * hw - w / 3;
            screenX = (t + 0.5) * hw - scroller.scrollLeft;
          } else screenX = x;
          place();
        };
        stopListening = onHour((id, time, from) => {
          if (from !== 'spot' || id !== item.id) return;
          if (!el.isConnected) {
            stopListening?.();
            return;
          }
          const t = hrs.findIndex((_h, i) => timeOf(i) === time);
          if (t >= 0) showT(t);
        });
        place();
      }
      el.querySelector('[data-act="matrix"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
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
        notes.push('Surf is an estimate of the sets’ face in body terms, worked out from the swell parts, their period and direction, and the way the beach faces, then corrected by your “What did you see?” reports.');
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
              .join('')}${alertIcons(rated.alerts)}${days[n].periods.length ? `<span class="cd-periods">${days[n].periods.map((p) => periodHtml(p, cat, item.faces, partVerdict(cat, days[n], p.id))).join('')}</span>` : ''}${r.extra ? `<small>${esc(r.extra)}</small>` : ''}${why}</div>`;
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

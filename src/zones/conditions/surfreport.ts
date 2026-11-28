import { supabase } from '../shared/supabase';
import type { HitListItem } from '../shared/types';
import type { Forecast } from './openmeteo';
import { daysOf, dayShort, clock, todayIso, surfAmPm } from './summary';
import { getHome } from './home';
import {
  BANDS,
  bandById,
  correctionFor,
  inputAt,
  reportsFor,
  setReports,
  surfAt,
  windByTime,
  type Surface,
  type SurfReport,
} from './surfsize';
import './surfreport.css';

/**
 * The surf line on a surf spot's card ("Surf AM waist to chest · PM chest to head, choppy") and the
 * "What did you see?" report: one tap on a body size, saved in Supabase `surf_reports` with the forecast
 * for that hour, so the estimate learns each spot (surfsize.ts).
 */

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const table = () => supabase!.from('surf_reports');

let loading: Promise<void> | null = null;

/** Load every report once (two people's reports stay small). */
export function loadReports(force = false): Promise<void> {
  if (!supabase) return Promise.resolve();
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await table().select('*').order('seen_at', { ascending: false }).limit(2000);
    if (!error && data) setReports(data as SurfReport[]);
  })();
  return loading;
}

// ---- The line on the card ----

function learnedText(item: HitListItem): string {
  const n = correctionFor(item).n;
  return n ? `Estimate, learned from ${n} report${n === 1 ? '' : 's'} here` : 'Estimate from the swell, not yet checked here';
}

/** Estimated surf for the chosen day, with the report button. Empty when there's no swell forecast. */
export function surfLineHtml(item: HitListItem, f: Forecast, date: string): string {
  const day = daysOf(f, [date], 'surfing', item)[0];
  const text = day ? surfAmPm(day) : '';
  if (!text) return '';
  return `<div class="sr-line" data-surf-day="${date}"><div class="sr-text"><b>Surf</b> ${esc(text)}<small>${esc(learnedText(item))}</small></div><button type="button" class="sr-btn" data-act="surf-report">What did you see?</button></div>`;
}

/** Redraw the line for a newly chosen day, without redrawing the chart. */
export function refreshSurfLine(el: HTMLElement, item: HitListItem, f: Forecast | null, date: string) {
  const line = el.querySelector('.sr-line');
  if (!line || !f) return;
  const html = surfLineHtml(item, f, date);
  if (html) line.outerHTML = html;
}

/** Wire the report button once per card (the card's insides are redrawn often, so this listens on the card). */
export function wireSurfReport(el: HTMLElement, item: HitListItem, forecast: () => Forecast | null) {
  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-act="surf-report"]');
    if (!btn) return;
    e.stopPropagation();
    openReport(item, forecast());
  });
}

// ---- The report pop-up ----

const SURFACES: Surface[] = ['clean', 'bumpy', 'choppy'];

/** Today's hours from 5am up to now, for "when did you look?". */
function hoursToday(): number[] {
  const now = Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).format(new Date()));
  const out: number[] = [];
  for (let h = Math.min(5, now); h <= now; h++) out.push(h);
  return out;
}

/** Sydney time "YYYY-MM-DDTHH:00" to a real instant. Sydney is +11 in summer, +10 in winter. */
function sydneyInstant(date: string, hour: number): string {
  for (const off of ['+11:00', '+10:00']) {
    const d = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00${off}`);
    const h = Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).format(d));
    if (h === hour) return d.toISOString();
  }
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+10:00`).toISOString();
}

function sydneyDateHour(iso: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23', timeZone: 'Australia/Sydney' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function historyHtml(item: HitListItem): string {
  const list = reportsFor(item.id).slice(0, 6);
  if (!list.length) return '<p class="cd-muted">No reports here yet. Each one makes this spot’s estimate closer.</p>';
  return `<ul class="sr-history">${list
    .map((r) => {
      const { date, hour } = sydneyDateHour(r.seen_at);
      const seen = bandById(r.band)?.label ?? r.band;
      const app = r.estimate != null ? BANDS.find((b) => r.estimate! < b.hi)?.label.toLowerCase() : null;
      return `<li><b>${esc(dayShort(date))} ${esc(clock(hour))}</b> ${esc(seen.toLowerCase())}${r.surface ? `, ${esc(r.surface)}` : ''}${
        r.who ? ` <span class="sr-who">(${esc(r.who)})</span>` : ''
      }${app ? `<small>App said ${esc(app)}</small>` : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}</li>`;
    })
    .join('')}</ul>`;
}

function openReport(item: HitListItem, f: Forecast | null) {
  document.querySelector('.mx-pop')?.remove();
  const today = todayIso();
  const hours = hoursToday();
  let hour = hours[hours.length - 1];
  let band: string | null = null;
  let surface: Surface | null = null;

  const marine = f?.marine ?? null;
  const winds = windByTime(f?.hourly ?? f?.hourlyWind);
  const indexAt = (h: number) => (marine ? marine.time.indexOf(`${today}T${String(h).padStart(2, '0')}:00`) : -1);
  const estimateAt = (h: number) => {
    const i = indexAt(h);
    return marine && i >= 0 ? surfAt(marine, i, item, winds) : null;
  };

  const pop = document.createElement('div');
  pop.className = 'mx-pop';
  const draw = () => {
    const est = estimateAt(hour);
    pop.innerHTML = `<div class="mx-box sr-box" role="dialog" aria-modal="true" aria-label="Report the surf at ${esc(item.name)}">
      <div class="mx-head"><h3>What did you see?</h3><button type="button" class="mx-close" aria-label="Close">×</button></div>
      <div class="sr-body">
        <p class="cd-muted">${esc(item.name)}. Call the sets, not the average wave.</p>
        <label class="sr-when">When <select data-f="hour">${hours.map((h) => `<option value="${h}"${h === hour ? ' selected' : ''}>${clock(h)} today</option>`).join('')}</select></label>
        ${est ? `<p class="cd-muted">The app estimated ${esc(est.label.toLowerCase())}${est.surface ? `, ${est.surface}` : ''} then.</p>` : ''}
        <div class="sr-bands">${BANDS.map((b) => `<button type="button" data-band="${b.id}" class="${b.id === band ? 'on' : ''}" aria-pressed="${b.id === band}">${b.label}</button>`).join('')}</div>
        <div class="sr-surface">${SURFACES.map((s) => `<button type="button" data-surface="${s}" class="${s === surface ? 'on' : ''}" aria-pressed="${s === surface}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}</div>
        <input class="sr-note" data-f="note" type="text" maxlength="200" placeholder="Note (optional)" />
        <button type="button" class="sr-save" data-act="save" ${band ? '' : 'disabled'}>Save report</button>
        <p class="sr-msg cd-muted" aria-live="polite"></p>
        <h4>Past reports here</h4>
        ${historyHtml(item)}
      </div>
    </div>`;
    wire();
  };

  let note = '';
  const wire = () => {
    const noteEl = pop.querySelector<HTMLInputElement>('[data-f="note"]')!;
    noteEl.value = note;
    noteEl.addEventListener('input', () => (note = noteEl.value));
    pop.querySelector('.mx-close')!.addEventListener('click', close);
    pop.querySelector<HTMLSelectElement>('[data-f="hour"]')!.addEventListener('change', (e) => {
      hour = Number((e.target as HTMLSelectElement).value);
      draw();
    });
    pop.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((b) =>
      b.addEventListener('click', () => {
        band = b.dataset.band!;
        draw();
      }),
    );
    pop.querySelectorAll<HTMLButtonElement>('[data-surface]').forEach((b) =>
      b.addEventListener('click', () => {
        surface = surface === b.dataset.surface ? null : (b.dataset.surface as Surface);
        draw();
      }),
    );
    pop.querySelector<HTMLButtonElement>('[data-act="save"]')!.addEventListener('click', () => void save());
  };

  const save = async () => {
    const msg = pop.querySelector('.sr-msg')!;
    if (!band) return;
    if (!supabase) {
      msg.textContent = "Can't save: the database isn't set up.";
      return;
    }
    const i = indexAt(hour);
    const est = estimateAt(hour);
    const swellFrom = Array.isArray(item.settings?.swellFrom) ? (item.settings!.swellFrom as [number, number]) : null;
    const row = {
      place_id: item.id,
      place_name: item.name,
      seen_at: sydneyInstant(today, hour),
      band,
      surface,
      note: note.trim() || null,
      who: getHome()?.name ?? null,
      forecast: marine && i >= 0 ? { input: inputAt(marine, i, winds.get(marine.time[i])), faces: item.faces, swellFrom } : null,
      estimate: est ? Math.round(est.face * 100) / 100 : null,
    };
    msg.textContent = 'Saving…';
    const { error } = await table().insert(row);
    if (error) {
      msg.textContent = `Couldn't save: ${error.message}`;
      return;
    }
    await loadReports(true);
    band = null;
    surface = null;
    note = '';
    draw();
    pop.querySelector('.sr-msg')!.textContent = 'Saved. Thanks, the estimate here has been updated.';
  };

  const close = () => {
    pop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  pop.addEventListener('click', (e) => e.target === pop && close());
  document.addEventListener('keydown', onKey);
  draw();
  document.body.append(pop);
}

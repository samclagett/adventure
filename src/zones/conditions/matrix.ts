import type { HitListItem } from '../shared/types';
import { categoryOf } from '../hitlist/categories';
import type { Forecast } from './openmeteo';
import { COASTAL } from './data';
import { daysFor, daysOf, rateDay, dayShort, compass, seaFor, windRelation, windArrowClass, VERDICT_WORD, type Day, type Period, type Tide } from './summary';
import { WEATHER_ICONS, KIND_WORD, windArrow } from './weather-icons';

/**
 * The conditions table: a small pop-up from a place card's weather summary. One column for each part of
 * the day (AM and PM, plus Night for camping) over the next five days, and a row for each thing that
 * matters there: weather, temperature, rain, wind, and for the coast swell, swell period and tides.
 * The first column stays put while the days scroll sideways.
 */

const DAYS = 5;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "6:40a", "12:05p" */
function clock(hour: number): string {
  const h24 = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  const h = h24 % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, '0')}${h24 < 12 ? 'a' : 'p'}`;
}

const tideText = (t: Tide[]) => t.map((x) => `${x.type === 'High' ? 'H' : 'L'} ${clock(x.hour)}`).join('<br>');

interface Row {
  label: string;
  cell: (day: Day, p: Period) => string;
}

export function matrixHtml(item: HitListItem, f: Forecast): string {
  const cat = categoryOf(item.activity).id;
  const days = daysOf(f, daysFor('5days').slice(0, DAYS), cat, item).filter((d) => d.periods.length);
  if (!days.length) return '<p class="cd-muted">No hour-by-hour forecast for this place yet.</p>';
  const coastal = COASTAL.has(cat) && !!f.marine;

  const rows: Row[] = [
    { label: 'Weather', cell: (_d, p) => `<span title="${esc(KIND_WORD[p.kind])}">${WEATHER_ICONS[p.kind]}</span>` },
    { label: 'Temp', cell: (_d, p) => (p.temp != null ? `${Math.round(p.temp)}°` : '–') },
    {
      label: 'Rain',
      cell: (_d, p) => {
        const mm = (p.rain ?? 0) >= 0.5 ? `${Math.round(p.rain!)} mm` : '';
        const pc = p.rainProb != null ? `${p.rainProb}%` : '';
        return [mm, pc].filter(Boolean).join('<br>') || '–';
      },
    },
    {
      label: 'Wind',
      cell: (_d, p) => (p.wind != null ? `<span class="mx-wind">${p.windDir != null ? windArrow(p.windDir, windArrowClass(cat, item.faces, p.windDir)) : ''}${Math.round(p.wind)}</span><small>${p.windDir != null ? compass(p.windDir) : ''}</small>` : '–'),
    },
  ];
  if (cat === 'surfing' && item.faces != null) {
    rows.push({
      label: 'Wind at beach',
      cell: (_d, p) => {
        if (p.windDir == null) return '–';
        const rel = windRelation(p.windDir, item.faces!);
        return `<span class="mx-rel mx-${rel}">${rel === 'cross-shore' ? 'cross' : rel === 'offshore' ? 'off' : 'on'}</span>`;
      },
    });
  }
  if (coastal) {
    const sea = new Map<string, ReturnType<typeof seaFor>>();
    const seaOf = (d: Day, p: Period) => {
      const key = d.date + p.id;
      if (!sea.has(key)) sea.set(key, seaFor(f, d.date, p.id));
      return sea.get(key)!;
    };
    rows.push(
      {
        label: 'Swell',
        cell: (d, p) => {
          const s = seaOf(d, p);
          return s?.swell != null ? `<span class="mx-swell">${s.swellDir != null ? windArrow(s.swellDir, 'wx-a-swell') : ''}${s.swell.toFixed(1)} m</span><small>${s.swellDir != null ? compass(s.swellDir) : ''}</small>` : '–';
        },
      },
      { label: 'Period', cell: (d, p) => (seaOf(d, p)?.swellPeriod != null ? `${Math.round(seaOf(d, p)!.swellPeriod!)} s` : '–') },
      { label: 'Tide', cell: (d, p) => tideText(seaOf(d, p)?.tides ?? []) || '–' },
    );
  }

  const head = days
    .map((d) => {
      const v = rateDay(cat, d).verdict;
      return `<th colspan="${d.periods.length}" class="mx-day cd-v-${v}" scope="colgroup">${dayShort(d.date)}<small>${VERDICT_WORD[v]}</small></th>`;
    })
    .join('');
  const sub = days.map((d) => d.periods.map((p, n) => `<th class="mx-part${n === 0 ? ' mx-first' : ''}" scope="col">${p.label}</th>`).join('')).join('');
  const body = rows
    .map(
      (r) =>
        `<tr><th scope="row">${r.label}</th>${days.map((d) => d.periods.map((p, n) => `<td class="${n === 0 ? 'mx-first' : ''}">${r.cell(d, p)}</td>`).join('')).join('')}</tr>`,
    )
    .join('');
  return `<div class="mx-scroll"><table class="mx-table"><thead><tr><th class="mx-corner"></th>${head}</tr><tr><th class="mx-corner"></th>${sub}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="cd-muted mx-foot">${days[0].periods.some((p) => p.id === 'night') ? 'Night is 9pm to 6am' : 'AM is 6 to 11am, PM is midday to 8pm'}. Wind in km/h, arrows point the way it blows${cat === 'surfing' && item.faces != null ? ': green offshore, orange cross-shore, red onshore at this beach' : ''}.${coastal ? ' Swell is model open-ocean swell, its highest in that part of the day.' : ''}</p>`;
}

/** Open the table as a pop-up over the app. Tap outside, the close button or Escape to close it. */
export function openMatrix(item: HitListItem, f: Forecast) {
  document.querySelector('.mx-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'mx-pop';
  pop.innerHTML = `<div class="mx-box" role="dialog" aria-modal="true" aria-label="Conditions table for ${esc(item.name)}">
      <div class="mx-head"><h3>${esc(item.name)}</h3><button type="button" class="mx-close" aria-label="Close">×</button></div>
      ${matrixHtml(item, f)}
    </div>`;
  const close = () => {
    pop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  pop.addEventListener('click', (e) => e.target === pop && close());
  pop.querySelector('.mx-close')!.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(pop);
}

/** Small table icon for the button that opens it (Phosphor light "table", MIT). */
export const TABLE_ICON = `<svg class="hl-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,50H32a6,6,0,0,0-6,6V192a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A6,6,0,0,0,224,50ZM38,110H82v36H38Zm56,0H218v36H94ZM218,62V98H38V62ZM38,192V158H82v36H40A2,2,0,0,1,38,192Zm178,2H94V158H218v34A2,2,0,0,1,216,194Z"/></svg>`;

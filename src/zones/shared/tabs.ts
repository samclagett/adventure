/**
 * The bottom tab bar: Plan, Map, Hit list and Camps, the way most outdoor apps work.
 *
 * Each zone listens with `onTab` and opens or closes its own screen; anything can switch tabs with
 * `showTab` (for example, tapping a place in the Plan list switches to Map). The bar is drawn by
 * `mountTabBar` in main.ts. Icons are Phosphor light (MIT, https://phosphoricons.com), the same set as
 * the weather symbols. The selected tab is paper and ink, like everything selected.
 */

export type Tab = 'plan' | 'map' | 'list' | 'camps';

const icon = (d: string) => `<svg class="tab-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

const TABS: { id: Tab; label: string; icon: string }[] = [
  {
    id: 'plan',
    label: 'Plan',
    icon: icon('M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218ZM173.32,74.63l-64,32a6,6,0,0,0-2.69,2.69l-32,64A6,6,0,0,0,80,182a6.06,6.06,0,0,0,2.68-.63l64-32a6,6,0,0,0,2.69-2.69l32-64a6,6,0,0,0-8.05-8.05Zm-33.79,64.9L93.42,162.58l23-46.11,46.11-23Z'),
  },
  {
    id: 'map',
    label: 'Map',
    icon: icon('M227.69,51.27a6,6,0,0,0-5.15-1.09L160.7,65.64l-62-31a6,6,0,0,0-4.14-.45l-64,16A6,6,0,0,0,26,56V200a6,6,0,0,0,7.46,5.82L95.3,190.36l62,31a6,6,0,0,0,4.14.45l64-16A6,6,0,0,0,230,200V56A6,6,0,0,0,227.69,51.27ZM102,49.71l52,26V206.29l-52-26Zm-64,11,52-13V179.32l-52,13ZM218,195.32l-52,13V76.68l52-13Z'),
  },
  {
    id: 'list',
    label: 'Hit list',
    icon: icon('M82,64a6,6,0,0,1,6-6H216a6,6,0,0,1,0,12H88A6,6,0,0,1,82,64Zm134,58H88a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12Zm0,64H88a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12ZM44,54A10,10,0,1,0,54,64,10,10,0,0,0,44,54Zm0,128a10,10,0,1,0,10,10A10,10,0,0,0,44,182Zm0-64a10,10,0,1,0,10,10A10,10,0,0,0,44,118Z'),
  },
  {
    id: 'camps',
    label: 'Camps',
    icon: icon('M253.48,189.56l-64-144A6,6,0,0,0,184,42H72a6,6,0,0,0-5.45,3.51l0,.05,0,.09v0L2.52,189.56A6,6,0,0,0,8,198H248a6,6,0,0,0,5.48-8.44ZM66,76.27V186H17.23ZM78,186V76.27L126.77,186Zm61.9,0L81.23,54H180.1l58.67,132Z'),
  },
];

let current: Tab = 'map';
const listeners: ((tab: Tab) => void)[] = [];
let bar: HTMLElement | null = null;

export function currentTab(): Tab {
  return current;
}

/** Switch to a tab. Every zone's listener runs, so each can open or close its own screen. */
export function showTab(tab: Tab) {
  current = tab;
  bar?.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.body.dataset.tab = tab;
  listeners.forEach((cb) => cb(tab));
}

export function onTab(cb: (tab: Tab) => void) {
  listeners.push(cb);
}

/** A small badge on a tab (a number, or '' for a dot). `null` removes it. */
export function setTabBadge(tab: Tab, text: string | null, label = '') {
  const slot = bar?.querySelector<HTMLElement>(`[data-tab="${tab}"] .tab-badge`);
  if (!slot) return;
  slot.hidden = text == null;
  slot.textContent = text ?? '';
  slot.classList.toggle('tab-dot', text === '');
  slot.title = label;
}

export function mountTabBar(parent: HTMLElement) {
  bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('aria-label', 'Main');
  bar.innerHTML = TABS.map(
    (t) => `<button type="button" data-tab="${t.id}"><span class="tab-pill">${t.icon}<span class="tab-badge" hidden></span></span><span class="tab-label">${t.label}</span></button>`,
  ).join('');
  parent.append(bar);
  bar.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as Tab)));
  showTab(current);
}

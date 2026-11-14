import type { AdventureMap, Region } from './map';
import { getQuality, getRelief, saveQuality, saveRelief, RELIEF_MAX, RELIEF_MIN, type Quality } from './quality';

const MOUNTAIN_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M120-240q-25 0-36-22t4-42l160-213q6-8 14.5-12t17.5-4q9 0 17.5 4t14.5 12l148 197h300L560-586l-68 90q-12 16-28 16.5t-28-8.5q-12-9-16-24.5t8-31.5l100-133q6-8 14.5-12t17.5-4q9 0 17.5 4t14.5 12l280 373q15 20 4 42t-36 22H120Zm340-80h300-312 68.5H460Zm-260 0h160l-80-107-80 107Zm0 0h160-160Z"/></svg>';

/**
 * The region picker and light/full quality toggle (bottom bar), and the mountain height button
 * (top right) that opens the height-exaggeration slider.
 */
export function mountControls(parent: HTMLElement, adv: AdventureMap) {
  const bar = document.createElement('div');
  bar.className = 'map-controls';
  bar.innerHTML = `
    <div class="segmented" role="group" aria-label="Region">
      <button data-region="AUS" class="active" aria-label="Australia">AUS</button>
      <button data-region="NSW">NSW</button>
      <button data-region="VIC">VIC</button>
      <button data-region="TAS">TAS</button>
    </div>
    <button class="quality" aria-label="Graphics quality"></button>
  `;
  parent.appendChild(bar);

  const relief = document.createElement('details');
  relief.className = 'relief-control';
  relief.innerHTML = `
    <summary aria-label="Mountain height">${MOUNTAIN_ICON}</summary>
    <label class="relief-pop">
      <span>Mountain height</span>
      <input type="range" min="${RELIEF_MIN}" max="${RELIEF_MAX}" step="0.5" aria-label="Mountain height" />
      <output></output>
    </label>
  `;
  parent.appendChild(relief);
  // Close the slider when tapping anywhere else.
  document.addEventListener('pointerdown', (e) => {
    if (relief.open && !relief.contains(e.target as Node)) relief.open = false;
  });
  const slider = relief.querySelector<HTMLInputElement>('input')!;
  const out = relief.querySelector('output')!;
  slider.value = String(getRelief());
  out.textContent = `${slider.value}×`;
  slider.addEventListener('input', () => {
    const r = Number(slider.value);
    out.textContent = `${r}×`;
    adv.setRelief(r);
    saveRelief(r);
  });

  const regionButtons = bar.querySelectorAll<HTMLButtonElement>('[data-region]');
  regionButtons.forEach((btn) =>
    btn.addEventListener('click', () => adv.flyToRegion(btn.dataset.region as Region | 'AUS')),
  );
  adv.onRegionChange((region) => {
    regionButtons.forEach((b) => b.classList.toggle('active', b.dataset.region === region));
  });

  const qualityBtn = bar.querySelector<HTMLButtonElement>('.quality')!;
  let quality: Quality = getQuality();
  const render = () => {
    qualityBtn.textContent = quality === 'full' ? '3D' : 'Light';
    qualityBtn.title = quality === 'full' ? '3D terrain on. Tap for faster light mode.' : 'Fast mode. Tap for 3D terrain.';
  };
  render();
  qualityBtn.addEventListener('click', () => {
    quality = quality === 'full' ? 'light' : 'full';
    saveQuality(quality);
    adv.setQuality(quality);
    render();
  });
}

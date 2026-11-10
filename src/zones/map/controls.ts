import type { AdventureMap, Region } from './map';
import { getQuality, getRelief, saveQuality, saveRelief, RELIEF_MAX, RELIEF_MIN, type Quality } from './quality';

/** The region picker, the light/full quality toggle and the height-exaggeration slider. */
export function mountControls(parent: HTMLElement, adv: AdventureMap) {
  const bar = document.createElement('div');
  bar.className = 'map-controls';
  bar.innerHTML = `
    <div class="segmented" role="group" aria-label="Region">
      <button data-region="AUS" class="active">Australia</button>
      <button data-region="NSW">NSW</button>
      <button data-region="VIC">VIC</button>
      <button data-region="TAS">TAS</button>
    </div>
    <button class="quality" aria-label="Graphics quality"></button>
  `;
  parent.appendChild(bar);

  const relief = document.createElement('label');
  relief.className = 'relief-control';
  relief.innerHTML = `
    <span>⛰</span>
    <input type="range" min="${RELIEF_MIN}" max="${RELIEF_MAX}" step="0.5" aria-label="Mountain height" />
    <output></output>
  `;
  parent.appendChild(relief);
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
    qualityBtn.textContent = quality === 'full' ? '✦ Full' : '◇ Light';
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

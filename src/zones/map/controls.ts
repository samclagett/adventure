import type { AdventureMap, Region } from './map';
import { getQuality, saveQuality, type Quality } from './quality';

/** The region picker (Australia / NSW / VIC) and the light/full quality toggle. */
export function mountControls(parent: HTMLElement, adv: AdventureMap) {
  const bar = document.createElement('div');
  bar.className = 'map-controls';
  bar.innerHTML = `
    <div class="segmented" role="group" aria-label="Region">
      <button data-region="AUS" class="active">Australia</button>
      <button data-region="NSW">NSW</button>
      <button data-region="VIC">VIC</button>
    </div>
    <button class="quality" aria-label="Graphics quality"></button>
  `;
  parent.appendChild(bar);

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

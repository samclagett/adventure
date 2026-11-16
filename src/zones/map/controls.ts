import type { AdventureMap, Region } from './map';
import { getQuality, getRelief, saveQuality, saveRelief, RELIEF_MAX, RELIEF_MIN, type Quality } from './quality';

/**
 * The region picker (bottom bar), plus the map settings that live in the account menu:
 * mountain height and the 3D on/off switch. Keeping those two off the map leaves it calmer.
 */
export function mountControls(parent: HTMLElement, adv: AdventureMap, settings: HTMLElement | null) {
  const bar = document.createElement('div');
  bar.className = 'map-controls';
  bar.innerHTML = `
    <div class="segmented" role="group" aria-label="Region">
      <button data-region="AUS" class="active" aria-label="Australia">AUS</button>
      <button data-region="NSW">NSW</button>
      <button data-region="VIC">VIC</button>
      <button data-region="TAS">TAS</button>
    </div>
  `;
  parent.appendChild(bar);

  const regionButtons = bar.querySelectorAll<HTMLButtonElement>('[data-region]');
  regionButtons.forEach((btn) =>
    btn.addEventListener('click', () => adv.flyToRegion(btn.dataset.region as Region | 'AUS')),
  );
  adv.onRegionChange((region) => {
    regionButtons.forEach((b) => b.classList.toggle('active', b.dataset.region === region));
  });

  // The compass only shows while the map is turned away from north; tap it to face north again.
  const map = adv.map;
  const showCompass = () => map.getContainer().classList.toggle('map-rotated', Math.abs(map.getBearing()) > 1);
  map.on('rotate', showCompass);
  showCompass();

  if (!settings) return;
  let quality: Quality = getQuality();
  settings.innerHTML = `
    <label class="setting">
      <span>3D terrain<small>Turn off if the map feels slow</small></span>
      <input type="checkbox" class="switch" data-setting="3d" ${quality === 'full' ? 'checked' : ''} />
    </label>
    <label class="setting setting-range">
      <span>Mountain height <output></output></span>
      <input type="range" min="${RELIEF_MIN}" max="${RELIEF_MAX}" step="0.25" data-setting="relief" />
    </label>
  `;
  const slider = settings.querySelector<HTMLInputElement>('[data-setting="relief"]')!;
  const out = settings.querySelector('output')!;
  const label = (r: number) => (r === 1 ? 'real' : `${r}×`);
  slider.value = String(getRelief());
  out.textContent = label(Number(slider.value));
  slider.addEventListener('input', () => {
    const r = Number(slider.value);
    out.textContent = label(r);
    adv.setRelief(r);
    saveRelief(r);
  });
  const toggle = settings.querySelector<HTMLInputElement>('[data-setting="3d"]')!;
  toggle.addEventListener('change', () => {
    quality = toggle.checked ? 'full' : 'light';
    saveQuality(quality);
    adv.setQuality(quality);
  });
}

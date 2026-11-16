import { createMap } from './map';
import { mountControls } from './controls';
import { getQuality } from './quality';

export type { AdventureMap, Region } from './map';
export { inRegion, regionOf } from './regions';

/**
 * Creates the 3D map inside `container`, with its region bar. `settings` is where the map's
 * settings (3D on/off, mountain height) are drawn: the Settings part of the account menu.
 */
export function mountMap(container: HTMLElement, settings: HTMLElement | null = null) {
  const adv = createMap(container, getQuality());
  mountControls(container, adv, settings);
  return adv;
}

import { createMap } from './map';
import { mountControls } from './controls';
import { getQuality } from './quality';

export type { AdventureMap, Region } from './map';
export { inRegion, regionOf } from './regions';

/** Creates the 3D map inside `container`, with its region and quality controls. */
export function mountMap(container: HTMLElement) {
  const adv = createMap(container, getQuality());
  mountControls(container, adv);
  return adv;
}

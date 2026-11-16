import './conditions.css';
import type { AdventureMap } from '../map';
import type { HitListApi } from '../hitlist';
import type { HitListItem } from '../shared/types';
import { supabase } from '../shared/supabase';
import { ConditionsData } from './data';
import { mountPlanner } from './planner';
import { mountLayer } from './layer';
import { mountCardSection } from './card';
import { showTab } from '../shared/tabs';
import { getHome } from './home';
import { ensureDrives } from './drive';

/**
 * Conditions, in three parts:
 * - planner.ts: the opening screen. Pick an activity and when, get places ranked by conditions, tap one to fly there.
 * - layer.ts: Explore mode's live weather layer. Weather, temperature, wind and swell beside each pin, for a chosen day.
 * - card.ts: a day-by-day forecast on each pin card.
 * Forecasts come from Open-Meteo (openmeteo.ts), are kept and cached by data.ts, and rated by summary.ts.
 */
export function mountConditions(parent: HTMLElement, adv: AdventureMap, hl: HitListApi) {
  const data = new ConditionsData();
  let all: HitListItem[] = [];
  let visible: HitListItem[] = [];

  const layer = mountLayer(parent, adv, hl, data);
  const planner = mountPlanner(parent, adv, data, (item, date) => {
    if (date) layer.showDay(date);
    hl.openItem(item.id);
  });
  mountCardSection(hl, data, () => visible);

  hl.onItemsChange((items) => {
    all = items;
    planner.setItems(all);
    // Fetch for every place up front, so the planner and the layer are ready together.
    if (all.length) data.ensure(all);
    // Drive times from home for every place, once per phone (saved), so the Plan list and cards have them.
    const home = getHome();
    if (home && all.length) void ensureDrives(home, all);
  });
  hl.onVisibleChange((items) => {
    visible = items;
    layer.setItems(visible);
  });

  // Open on the Plan tab once signed in (the hit list loads then). Signed out, the map shows as before.
  supabase?.auth.getSession().then(({ data: s }) => {
    if (s.session) showTab('plan');
  });
}

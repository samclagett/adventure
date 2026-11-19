/**
 * The numbers behind every rating: green (Go), orange (Marginal) and red (Skip), per activity.
 *
 * These are Sam's defaults from the change notes of 2026-11-19, and will keep being refined. Change a number
 * here and every screen follows (map tags, place cards, the Plan list). The logic that uses them is ratings.ts.
 *
 * Any place can override any of these with its own settings, saved as JSON in the hit list's `settings`
 * column, for example a dive site's swell limit and the swell directions that reach it:
 *   {"swellMax": 1.2, "swellFrom": [45, 150]}
 * or a surf beach that only works on a south swell: {"swellFrom": [150, 210]}.
 * Directions are compass degrees the swell comes FROM, as a clockwise range [from, to].
 */

export interface Rules {
  /** Hours of the day that count, [from, to): 6 to 19 means 6am up to 7pm. Past 24 is the next morning (camping). */
  hours: [number, number];

  // Temperature, °C (the warmest hour of the window, or for camping the night's low and high).
  /** Green between these. */
  tempGreen?: [number, number];
  /** Orange between these; outside is red. Leave out for "never red on temperature" (only orange). */
  tempOrange?: [number, number];
  /** Red above this (hiking: 35°). */
  tempRedAbove?: number;

  // Wind, km/h (the strongest hourly average in the window).
  /** Green up to this. */
  windGreen?: number;
  /** Orange up to this; above is red. */
  windOrange?: number;
  /** Red above this, when there's no orange band (hiking: only extreme wind matters). */
  windRedAbove?: number;

  // Surf.
  /** Swell height (m) that's green, and orange; outside orange is red. */
  swellGreen?: [number, number];
  swellOrange?: [number, number];
  /** Onshore wind: green up to, orange up to; above is red. */
  onshoreGreen?: number;
  onshoreOrange?: number;
  /** Cross-shore wind: green up to, orange up to; above is red. */
  crossGreen?: number;
  crossOrange?: number;
  /** Swell period (s) under this makes it orange at best. */
  periodOrangeBelow?: number;
  /** Swell directions that reach the spot, [from, to] clockwise. Unset = any direction. */
  swellFrom?: [number, number] | null;

  // Snorkelling and diving.
  /** Swell over this (m) is red. Each site sets its own. */
  swellMax?: number;
  /** Swell from outside `swellFrom` counts as this fraction of its size (the site is sheltered from it). */
  shelteredFactor?: number;
  /** Rain over the 2 days before (mm): orange from, red from (runoff, bad visibility). */
  rain48Orange?: number;
  rain48Red?: number;

  // Climbing.
  /** Rock type: "sandstone" gets the wet-rock check below. */
  rock?: string;
  /** Sandstone: this much rain (mm) the day before makes it orange, with an alert. */
  sandstoneRainDayBefore?: number;

  // Skiing (just a snow alert).
  /** Fresh snow forecast for the day, cm, for green. */
  freshSnowGreen?: number;
  /** Snow over the last `recentDays` days, cm, for orange. */
  recentSnowOrange?: number;
  recentDays?: number;
  /** Ski resorts: base and top elevation (m), for snow depth. */
  base?: number;
  top?: number;

  // Canyoning.
  /** Most rain in the window (mm) that still counts as "showers or slight drizzle" (orange). More is red. */
  showersMaxMm?: number;
  /** Rain over the catchment in the days before (mm) that brings up an alert (not a red). */
  catchmentAlertMm?: number;
  catchmentDays?: number;
}

/** How rain is read from the hourly forecast, for every activity. */
export const RAIN = {
  /** An hour with at least this much (mm) counts as a rainy hour. Less is a trace. */
  wetHourMm: 0.2,
  /** An hour with this much or more (mm) is real rain, not drizzle (for climbing: "more than 30 minutes"). */
  realRainHourMm: 0.5,
  /** A dry-looking hour with this chance of rain (%) or more counts as "might shower". */
  chancePct: 40,
  /** "Rain all day": at least this share of the hours are rainy, and at least `allDayMm` falls. */
  allDayShare: 0.6,
  allDayMm: 5,
};

export const RULES: Record<string, Rules> = {
  hiking: {
    hours: [6, 19],
    tempGreen: [12, 30],
    tempRedAbove: 35,
    windRedAbove: 60,
  },
  camping: {
    // Night-time only: 9pm to 6am.
    hours: [21, 30],
    tempGreen: [8, 22],
    tempOrange: [5, 25],
    windGreen: 20,
    windOrange: 40,
  },
  surfing: {
    // Never before 6am or after 7pm.
    hours: [6, 19],
    swellGreen: [1.2, 2.2],
    swellOrange: [0.8, 2.6],
    onshoreGreen: 10,
    onshoreOrange: 25,
    crossGreen: 10,
    crossOrange: 35,
    periodOrangeBelow: 8,
    swellFrom: null,
  },
  climbing: {
    hours: [6, 19],
    tempGreen: [12, 25],
    tempOrange: [8, 28],
    windGreen: 25,
    windOrange: 40,
    sandstoneRainDayBefore: 10,
  },
  skiing: {
    hours: [6, 19],
    freshSnowGreen: 2,
    recentSnowOrange: 2,
    recentDays: 5,
  },
  diving: {
    hours: [7, 17],
    swellMax: 1.0,
    swellFrom: null,
    shelteredFactor: 0.5,
    windGreen: 15,
    rain48Orange: 10,
    rain48Red: 30,
  },
  canyoning: {
    // Wind doesn't matter.
    hours: [9, 17],
    tempGreen: [24, 99],
    tempOrange: [18, 99],
    showersMaxMm: 3,
    catchmentAlertMm: 25,
    catchmentDays: 3,
  },
  kayaking: {
    // Rated on river level once the river gauges are in; until then, rain and wind.
    hours: [7, 17],
    windGreen: 20,
    windOrange: 30,
  },
};

/** Anything not listed above (Other) is rated like a hike. */
export const DEFAULT_RULES = RULES.hiking;

/** Settings saved on a place (hit_list.settings): any of the numbers above. */
export type Settings = Partial<Rules> | null;

/** An activity's rules with a place's own settings on top. */
export function rulesFor(category: string, settings: Settings | undefined): Rules {
  return { ...(RULES[category] ?? DEFAULT_RULES), ...(settings ?? {}) };
}

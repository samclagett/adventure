import { ICONS } from './icons';

/**
 * Adventure categories. The `id` is what gets saved in the hit_list table's `activity` column,
 * so don't rename an id once items use it (labels, icons and colours can change freely).
 * `color` is a muted accent, used sparingly (pin ring, list row edge).
 */
export interface Category {
  id: string;
  label: string;
  /** SVG markup from icons.ts. */
  icon: string;
  color: string;
  /** Set for activities that live in a sub-list, opened from "Other" (2026-11-17). */
  group?: 'other';
}

export const CATEGORIES: Category[] = [
  { id: 'hiking', label: 'Hiking', icon: ICONS.hiking, color: '#c98b5a' },
  { id: 'camping', label: 'Camping', icon: ICONS.camping, color: '#8fa66b' },
  { id: 'surfing', label: 'Surfing', icon: ICONS.surfing, color: '#5b9bb5' },
  { id: 'climbing', label: 'Climbing', icon: ICONS.climbing, color: '#a08aa8' },
  { id: 'skiing', label: 'Skiing', icon: ICONS.skiing, color: '#a9c1cf' },
  { id: 'diving', label: 'Snorkelling & diving', icon: ICONS.diving, color: '#4f8c8a' },
  { id: 'canyoning', label: 'Canyoning', icon: ICONS.canyoning, color: '#b08f6a' },
  { id: 'other', label: 'Other', icon: ICONS.other, color: '#9aa1a6' },
  // The "Other" sub-list. More activities go here later. Kayaking kept its id, so saved places still work.
  { id: 'kayaking', label: 'Kayaking & canoeing', icon: ICONS.kayaking, color: '#c47a6a', group: 'other' },
];

/** The main list: everything not in a sub-list, ending with Other. */
export const MAIN_CATEGORIES = CATEGORIES.filter((c) => !c.group);
/** Activities in Other's sub-list. */
export const OTHER_CATEGORIES = CATEGORIES.filter((c) => c.group === 'other');
/** Every category in display order for flat lists (edit form, list headings): sub-list activities sit just before plain Other. */
export const FLAT_CATEGORIES = [...MAIN_CATEGORIES.filter((c) => c.id !== 'other'), ...OTHER_CATEGORIES, ...MAIN_CATEGORIES.filter((c) => c.id === 'other')];

/** Old ids that were merged into another category. Removed ones (beaches, mtb) fall back to Other. */
const ALIASES: Record<string, string> = { snorkelling: 'diving' };

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Unknown or empty values fall back to "Other", so old or odd rows still show up. */
export function categoryOf(id: string | null | undefined): Category {
  const key = ALIASES[id ?? ''] ?? id ?? '';
  return BY_ID.get(key) ?? BY_ID.get('other')!;
}

/** The main-list category an activity sits under: itself, or Other for sub-list activities like kayaking. */
export function mainOf(id: string | null | undefined): Category {
  const c = categoryOf(id);
  return c.group ? BY_ID.get(c.group)! : c;
}

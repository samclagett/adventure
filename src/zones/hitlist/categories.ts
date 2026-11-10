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
}

export const CATEGORIES: Category[] = [
  { id: 'hiking', label: 'Hiking', icon: ICONS.hiking, color: '#c98b5a' },
  { id: 'camping', label: 'Camping', icon: ICONS.camping, color: '#8fa66b' },
  { id: 'surfing', label: 'Surfing', icon: ICONS.surfing, color: '#5b9bb5' },
  { id: 'climbing', label: 'Climbing', icon: ICONS.climbing, color: '#a08aa8' },
  { id: 'skiing', label: 'Skiing', icon: ICONS.skiing, color: '#a9c1cf' },
  { id: 'diving', label: 'Snorkelling & diving', icon: ICONS.diving, color: '#4f8c8a' },
  { id: 'kayaking', label: 'Kayaking / canoeing', icon: ICONS.kayaking, color: '#c47a6a' },
  { id: 'other', label: 'Other', icon: ICONS.other, color: '#9aa1a6' },
];

/** Old ids that were merged into another category. Removed ones (beaches, mtb) fall back to Other. */
const ALIASES: Record<string, string> = { snorkelling: 'diving' };

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Unknown or empty values fall back to "Other", so old or odd rows still show up. */
export function categoryOf(id: string | null | undefined): Category {
  const key = ALIASES[id ?? ''] ?? id ?? '';
  return BY_ID.get(key) ?? BY_ID.get('other')!;
}

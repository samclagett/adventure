/**
 * Adventure categories. The `id` is what gets saved in the hit_list table's `activity` column,
 * so don't rename an id once items use it (labels, emoji and colours can change freely).
 */
export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { id: 'hiking', label: 'Hiking', emoji: '🥾', color: '#e07a3f' },
  { id: 'camping', label: 'Camping', emoji: '⛺', color: '#6dbb4a' },
  { id: 'beaches', label: 'Beaches', emoji: '🏖️', color: '#e9c46a' },
  { id: 'surfing', label: 'Surfing', emoji: '🏄', color: '#2d9cdb' },
  { id: 'climbing', label: 'Climbing', emoji: '🧗', color: '#b07cc6' },
  { id: 'skiing', label: 'Skiing', emoji: '⛷️', color: '#9cc9f5' },
  { id: 'snorkelling', label: 'Snorkelling', emoji: '🐠', color: '#2ec4b6' },
  { id: 'diving', label: 'Diving', emoji: '🤿', color: '#4c63d2' },
  { id: 'kayaking', label: 'Kayaking / canoeing', emoji: '🛶', color: '#ef6461' },
  { id: 'mtb', label: 'Mountain biking', emoji: '🚵', color: '#a1785c' },
  { id: 'other', label: 'Other', emoji: '⭐', color: '#9aa5ad' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Unknown or empty values fall back to "Other", so old or odd rows still show up. */
export function categoryOf(id: string | null | undefined): Category {
  return BY_ID.get(id ?? '') ?? BY_ID.get('other')!;
}

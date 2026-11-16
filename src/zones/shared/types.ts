/** One adventure on the hit list. Mirrors the `hit_list` table in supabase/schema.sql. */
export interface HitListItem {
  id: string;
  name: string;
  /** The original messy text it was pasted as. */
  raw_text: string | null;
  /** Category id from src/zones/hitlist/categories.ts, e.g. 'hiking'. */
  activity: string | null;
  /** Null while the item is in the "to locate" queue. */
  lat: number | null;
  lng: number | null;
  notes: string | null;
  link: string | null;
  /** Compass bearing (degrees) a beach faces out to sea, used for onshore/offshore wind. Null = not set. */
  faces: number | null;
  created_at: string;
  updated_at: string;
}

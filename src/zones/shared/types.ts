/** One adventure on the hit list. Mirrors the `hit_list` table in supabase/schema.sql. */
export interface HitListItem {
  id: string;
  name: string;
  /** The original messy text it was pasted as. */
  raw_text: string | null;
  activity: string | null;
  /** Null while the item is in the "to locate" queue. */
  lat: number | null;
  lng: number | null;
  notes: string | null;
  link: string | null;
  created_at: string;
  updated_at: string;
}

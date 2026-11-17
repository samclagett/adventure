import { supabase } from '../shared/supabase';

/**
 * The Done list: each time you've been somewhere, with a date, an optional note and an optional photo.
 * Saved in Supabase `done_trips` (see supabase/schema.sql); photos go in the private `done-photos`
 * storage bucket, shrunk on the phone first so they upload quickly and stay well inside the free tier.
 * A visit keeps its own copy of the place's name and category, so it stays here if the place is deleted.
 */

export interface DoneTrip {
  id: string;
  item_id: string | null;
  name: string;
  activity: string | null;
  /** YYYY-MM-DD */
  done_on: string;
  note: string | null;
  photo_path: string | null;
  created_at: string;
}

const BUCKET = 'done-photos';
/** Longest side of a saved photo, in pixels. */
const PHOTO_MAX = 1600;

function db() {
  if (!supabase) throw new Error("Supabase isn't configured yet.");
  return supabase.from('done_trips');
}

export async function loadDone(): Promise<DoneTrip[]> {
  const { data, error } = await db().select('*').order('done_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data as DoneTrip[];
}

export async function addDone(fields: Pick<DoneTrip, 'item_id' | 'name' | 'activity' | 'done_on' | 'note'>, photo: File | null): Promise<DoneTrip> {
  let photo_path: string | null = null;
  if (photo) {
    const blob = await shrink(photo);
    photo_path = `${fields.done_on}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase!.storage.from(BUCKET).upload(photo_path, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
  }
  const { data, error } = await db().insert({ ...fields, photo_path }).select().single();
  if (error) throw error;
  return data as DoneTrip;
}

export async function deleteDone(trip: DoneTrip): Promise<void> {
  const { error } = await db().delete().eq('id', trip.id);
  if (error) throw error;
  if (trip.photo_path) await supabase!.storage.from(BUCKET).remove([trip.photo_path]);
}

// ---- Photos ----

/** Signed links to photos (the bucket is private), kept for most of their hour. */
const urls = new Map<string, { url: string; until: number }>();

/** Links for these photos, by path. Asks Supabase once for all the ones it doesn't have yet. */
export async function photoUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => !((urls.get(p)?.until ?? 0) > now));
  if (need.length && supabase) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(need, 3600);
    data?.forEach((d) => {
      if (d.signedUrl && d.path) urls.set(d.path, { url: d.signedUrl, until: now + 50 * 60 * 1000 });
    });
  }
  return new Map(paths.filter((p) => urls.has(p)).map((p) => [p, urls.get(p)!.url]));
}

/** Resize to at most PHOTO_MAX on the long side and save as JPEG. iPhone HEIC photos decode fine in Safari. */
async function shrink(file: File): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That photo couldn’t be read. Try a different one.'));
    el.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('That photo couldn’t be saved.'))), 'image/jpeg', 0.82),
  );
}

// ---- Dates ----

/** Today in Sydney, YYYY-MM-DD (the date input's format). */
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

/** "12 Oct 2026" */
export function doneDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

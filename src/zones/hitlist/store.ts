import { supabase } from '../shared/supabase';
import type { HitListItem } from '../shared/types';

/** The fields a user fills in. `activity` holds the category id (see categories.ts). */
export type ItemFields = Pick<HitListItem, 'name' | 'activity' | 'lat' | 'lng' | 'notes' | 'link'>;

function db() {
  if (!supabase) throw new Error("Supabase isn't configured yet.");
  return supabase.from('hit_list');
}

export async function loadItems(): Promise<HitListItem[]> {
  const { data, error } = await db().select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data as HitListItem[];
}

export async function addItem(fields: ItemFields): Promise<HitListItem> {
  const { data, error } = await db().insert(fields).select().single();
  if (error) throw error;
  return data as HitListItem;
}

export async function updateItem(id: string, fields: ItemFields): Promise<HitListItem> {
  const { data, error } = await db().update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data as HitListItem;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await db().delete().eq('id', id);
  if (error) throw error;
}

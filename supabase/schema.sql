-- Adventure app schema. Paste into the Supabase SQL Editor and run.
-- Safe to re-run: it only creates things that don't exist yet.

create table if not exists public.hit_list (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  raw_text    text,             -- the original messy pasted line
  activity    text,             -- e.g. hiking, surfing, camping
  lat         double precision, -- null = still in the "to locate" queue
  lng         double precision,
  notes       text,
  link        text,             -- AllTrails, park page, etc.
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hit_list_touch on public.hit_list;
create trigger hit_list_touch before update on public.hit_list
  for each row execute function public.touch_updated_at();

-- Only signed-in users (the shared login) can read or change anything.
alter table public.hit_list enable row level security;

drop policy if exists "signed in can do everything" on public.hit_list;
create policy "signed in can do everything" on public.hit_list
  for all to authenticated using (true) with check (true);

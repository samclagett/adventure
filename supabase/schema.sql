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
  faces       smallint check (faces between 0 and 359), -- which way a surf beach faces (degrees), for onshore/offshore
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

-- Added 2026-11-16 (conditions). For databases made before then.
alter table public.hit_list add column if not exists faces smallint check (faces between 0 and 359);

drop trigger if exists hit_list_touch on public.hit_list;
create trigger hit_list_touch before update on public.hit_list
  for each row execute function public.touch_updated_at();

-- Only signed-in users (the shared login) can read or change anything.
alter table public.hit_list enable row level security;

drop policy if exists "signed in can do everything" on public.hit_list;
create policy "signed in can do everything" on public.hit_list
  for all to authenticated using (true) with check (true);

-- Campsite checker (scripts/campsites/check.py) reads only the NSW National Parks campground links
-- of camping items, using the public anon key. Nothing else in hit_list is exposed.
create or replace function public.campsite_links()
returns table (link text)
language sql stable security definer set search_path = public
as $$
  select distinct h.link from public.hit_list h
  where h.activity = 'camping'
    and h.link like 'https://www.nationalparks.nsw.gov.au/camping-and-accommodation/campgrounds/%';
$$;
revoke all on function public.campsite_links() from public;
grant execute on function public.campsite_links() to anon, authenticated;

-- Conditions refresh job (scripts/conditions/fetch.py) reads one rounded point per 0.25° grid square that has
-- hit list places, and whether any are coastal, using the public anon key. No names, notes or links.
-- The grid must match `areaId` in src/zones/conditions/data.ts.
create or replace function public.conditions_areas()
returns table (area text, lat double precision, lng double precision, coastal boolean)
language sql stable security definer set search_path = public
as $$
  with p as (
    select floor(h.lat / 0.25)::int as gy, floor(h.lng / 0.25)::int as gx,
           round(h.lat::numeric, 3)::float8 as lat, round(h.lng::numeric, 3)::float8 as lng,
           h.activity in ('surfing', 'diving', 'kayaking') as coastal
    from public.hit_list h
    where h.lat is not null and h.lng is not null
  )
  select gy || '_' || gx,
         (array_agg(lat order by coastal desc, lat, lng))[1],
         (array_agg(lng order by coastal desc, lat, lng))[1],
         bool_or(coastal)
  from p group by gy, gx;
$$;
revoke all on function public.conditions_areas() from public;
grant execute on function public.conditions_areas() to anon, authenticated;

-- Done list (added 2026-11-16, Round 3): each time you've been somewhere, with a date, a note and an optional photo.
-- Keeps its own copy of the name and category, so a visit stays on the Done list if the place is deleted.
create table if not exists public.done_trips (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references public.hit_list(id) on delete set null,
  name        text not null,
  activity    text,
  done_on     date not null default current_date,
  note        text,
  photo_path  text,             -- path in the private `done-photos` storage bucket
  created_at  timestamptz not null default now()
);
alter table public.done_trips enable row level security;
drop policy if exists "signed in can do everything" on public.done_trips;
create policy "signed in can do everything" on public.done_trips
  for all to authenticated using (true) with check (true);

-- Photos for the Done list: a private bucket, readable and writable by the shared login only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('done-photos', 'done-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
drop policy if exists "done photos: signed in" on storage.objects;
create policy "done photos: signed in" on storage.objects
  for all to authenticated using (bucket_id = 'done-photos') with check (bucket_id = 'done-photos');

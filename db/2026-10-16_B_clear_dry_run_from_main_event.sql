-- =====================================================================
-- Event day, after the dry run and BEFORE the guests: a clean start.
-- Run once in the Supabase SQL Editor.
--
-- Takes the dry run's orders out of the main event, so service starts empty:
-- every dish ordered, every KOT, every pick-up, every cover seated (with its
-- guest note / VIP) and every SOS of the main event. KOT numbers start again
-- at 001. Set-up is NOT touched: kitchens, printers, barkers, captains, menu,
-- VIP guests, courses all stay. Tablets and kitchen screens stay signed in.
--
-- Everything removed is copied first into dryrun_backup_* tables, so it can
-- be looked at or put back.
-- =====================================================================
do $$
declare
  v_main uuid;
  n      int;
begin
  select count(*) into n from events where maestro and date = '2026-10-16' and name not ilike '%dry run%';
  if n <> 1 then
    raise exception 'Expected exactly one main Maestro event dated 16 Oct, found %. Nothing changed.', n;
  end if;
  select id into v_main from events where maestro and date = '2026-10-16' and name not ilike '%dry run%';

  -- copies first
  create table if not exists dryrun_backup_kots       as select * from kots       where false;
  create table if not exists dryrun_backup_ms_items   as select * from ms_items   where false;
  create table if not exists dryrun_backup_ms_firings as select * from ms_firings where false;
  create table if not exists dryrun_backup_ms_covers  as select * from ms_covers  where false;
  alter table dryrun_backup_kots       enable row level security;
  alter table dryrun_backup_ms_items   enable row level security;
  alter table dryrun_backup_ms_firings enable row level security;
  alter table dryrun_backup_ms_covers  enable row level security;
  insert into dryrun_backup_kots       select * from kots       where event_id = v_main;
  insert into dryrun_backup_ms_items   select * from ms_items   where event_id = v_main;
  insert into dryrun_backup_ms_firings select * from ms_firings where event_id = v_main;
  insert into dryrun_backup_ms_covers  select * from ms_covers  where event_id = v_main;

  -- the dry run out of the main event
  delete from ms_items   where event_id = v_main;
  delete from kots       where event_id = v_main;
  delete from ms_firings where event_id = v_main;
  delete from ms_covers  where event_id = v_main;
  if to_regclass('public.sos_requests') is not null then
    execute 'delete from sos_requests where event_id = $1' using v_main;
  end if;

  -- KOT numbers from 001 again (Barker A and Barker B)
  update kitchens set kot_seq = 0, kot_seq_b = 0 where event_id = v_main;
end $$;

-- Check: all zero, and the set-up still there
select e.name,
       (select count(*) from kots k where k.event_id = e.id)       as kots,
       (select count(*) from ms_items i where i.event_id = e.id)   as dishes_ordered,
       (select count(*) from ms_covers c where c.event_id = e.id)  as covers_seated,
       (select count(*) from kitchens k where k.event_id = e.id and k.is_active) as kitchens_on,
       (select count(*) from captains c where c.event_id = e.id and c.is_active) as captains,
       (select count(*) from barkers b where b.event_id = e.id and b.is_active)  as barkers,
       (select count(*) from dryrun_backup_kots b where b.event_id = e.id)       as kots_kept_in_backup
  from events e where e.maestro and e.date = '2026-10-16' and e.name not ilike '%dry run%';

-- =====================================================================
-- A fresh start: every order of Dry Run 2 and the main event taken out
-- (dishes ordered, KOTs, pick-ups, covers seated with their guest note / VIP,
-- SOS calls); KOT numbers start again at 001 (Barker A and B).
-- NOT touched: kitchens, printers, menu, VIP guests and their menus, captains,
-- barkers, courses. Tablets and kitchen screens stay signed in.
-- Everything removed is copied first into ss_clear_backup_* tables.
-- =====================================================================
create table if not exists ss_clear_backup_kots       as select * from kots       where false;
create table if not exists ss_clear_backup_ms_items   as select * from ms_items   where false;
create table if not exists ss_clear_backup_ms_firings as select * from ms_firings where false;
create table if not exists ss_clear_backup_ms_covers  as select * from ms_covers  where false;
alter table ss_clear_backup_kots       enable row level security;
alter table ss_clear_backup_ms_items   enable row level security;
alter table ss_clear_backup_ms_firings enable row level security;
alter table ss_clear_backup_ms_covers  enable row level security;

do $$
declare
  v_events uuid[];
begin
  select array_agg(id) into v_events from events
   where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%');
  if v_events is null then raise exception 'No event found. Nothing changed.'; end if;

  insert into ss_clear_backup_kots       select * from kots       where event_id = any(v_events);
  insert into ss_clear_backup_ms_items   select * from ms_items   where event_id = any(v_events);
  insert into ss_clear_backup_ms_firings select * from ms_firings where event_id = any(v_events);
  insert into ss_clear_backup_ms_covers  select * from ms_covers  where event_id = any(v_events);

  delete from ms_items   where event_id = any(v_events);
  delete from kots       where event_id = any(v_events);
  delete from ms_firings where event_id = any(v_events);
  delete from ms_covers  where event_id = any(v_events);
  if to_regclass('public.sos_requests') is not null then
    execute 'delete from sos_requests where event_id = any($1)' using v_events;
  end if;

  -- KOT numbers from 001 again
  update kitchens set kot_seq = 0, kot_seq_b = 0 where event_id = any(v_events);
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): all zero
select e.name as event,
       (select count(*) from kots k where k.event_id = e.id)       as kots,
       (select count(*) from ms_items i where i.event_id = e.id)   as dishes_ordered,
       (select count(*) from ms_covers c where c.event_id = e.id)  as covers_seated,
       (select max(kot_seq) from kitchens k where k.event_id = e.id) as last_kot_no
  from events e
 where e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by e.name;

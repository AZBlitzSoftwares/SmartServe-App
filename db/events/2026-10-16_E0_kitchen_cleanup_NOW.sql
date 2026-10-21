-- =====================================================================
-- NOW (before the dry run): only the event's six kitchens, in Dry Run 2 and
-- the main event. No date, no login of the six kitchens, no device changes.
-- Safe to run twice. Nothing is deleted (a copy of every kitchen changed is
-- kept in ss_cleanup_backup).
--
--   Amuse Bouche (1 barker), Aqua Italian (2), Hutong Oriental (2),
--   INDDEE Indian (2), Hot & Cold Beverages (1), Desserts by Brix (1)
--   = 9 KOT printers (one per kitchen + Barker B in Aqua, Hutong, INDDEE)
--
-- Every other kitchen (Arabic, Gujarati Thali, Tea & Coffee …) is switched
-- off, its printers are taken off it (it leaves the Print Hub's list) and its
-- barker logins are switched off. The switch-over to the main event is done
-- later, after the dry run (2026-10-16_E_after_dry_run_TONIGHT.sql).
-- =====================================================================
create table if not exists ss_cleanup_backup (
  id       uuid primary key,
  data     jsonb not null,
  saved_at timestamptz not null default now()
);
alter table ss_cleanup_backup enable row level security;

do $$
declare
  v_events uuid[];
  n        int;
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  if n <> 1 then raise exception 'Expected exactly one main Maestro event (16 or 17 Oct, not a dry run), found %. Nothing changed.', n; end if;
  select array_agg(id) into v_events from events
   where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%');

  -- a copy of the kitchens that change
  insert into ss_cleanup_backup (id, data)
  select k.id, to_jsonb(k) from kitchens k
   where k.event_id = any(v_events)
     and not (k.name ilike 'amuse%' or k.name ilike 'aqua%' or k.name ilike 'hutong%' or k.name ilike 'inddee%'
              or k.name ilike '%beverage%' or k.name ilike '%brix%')
  on conflict (id) do nothing;

  -- their barker logins off
  update barkers set is_active = false
   where is_active and kitchen_id in (
     select id from kitchens
      where event_id = any(v_events)
        and not (name ilike 'amuse%' or name ilike 'aqua%' or name ilike 'hutong%' or name ilike 'inddee%'
                 or name ilike '%beverage%' or name ilike '%brix%'));

  -- the kitchens off, without printers
  update kitchens set is_active = false, is_default = false, printer_ip = null, backup_printer_ip = null
   where event_id = any(v_events)
     and not (name ilike 'amuse%' or name ilike 'aqua%' or name ilike 'hutong%' or name ilike 'inddee%'
              or name ilike '%beverage%' or name ilike '%brix%');
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'kitchens' and column_name = 'printer_ip_b') then
    execute 'update kitchens set printer_ip_b = null
              where event_id = any($1) and not is_active
                and not (name ilike ''amuse%'' or name ilike ''aqua%'' or name ilike ''hutong%'' or name ilike ''inddee%''
                         or name ilike ''%beverage%'' or name ilike ''%brix%'')' using v_events;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): each event, its kitchens on, their printers
select e.name as event, k.name as kitchen, k.is_active as on, k.barkers,
       coalesce(nullif(btrim(coalesce(k.printer_ip, '')), ''), '-') as printer_a,
       coalesce(nullif(btrim(coalesce(to_jsonb(k) ->> 'printer_ip_b', '')), ''), '-') as printer_b
  from kitchens k join events e on e.id = k.event_id
 where e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by e.name, k.is_active desc, k.sort_order;

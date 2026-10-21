-- =====================================================================
-- AFTER THE DRY RUN: everyone on the main event, final kitchens and printers.
-- Use this INSTEAD of 2026-10-16_D1_switch_EVENT_TONIGHT.sql (it does the same
-- switch-over and more). Run once in the Supabase SQL Editor; safe to run twice.
-- Nothing is deleted.
--
-- 1. Kitchens, in Dry Run 2 and the main event: only these six stay on
--      Amuse Bouche (1 barker), Aqua Italian (2), Hutong Oriental (2),
--      INDDEE Indian (2), Hot & Cold Beverages (1), Desserts by Brix (1)
--    = 9 KOT printers (one per kitchen + Barker B in Aqua, Hutong, INDDEE).
--    Every other kitchen (Arabic, Gujarati Thali, Tea & Coffee …) is switched
--    off, with its barker logins.
-- 2. The main event takes the printers set and tested in Dry Run 2 today
--    (Barker A, Barker B, backup), by kitchen name. A main-event printer is
--    replaced only where Dry Run 2 has one.
-- 3. The dry runs move to 14 Oct and their captain, barker and supervisor
--    logins are switched off: every tablet and kitchen screen still on a dry
--    run signs out by itself within a minute; signing in again (same name and
--    PIN) finds the main event. The Print Hub switches to it by itself.
-- 4. The main event is dated tonight, 16 Oct.
-- =====================================================================
do $$
declare
  v_main uuid;
  v_dry  uuid;
  n      int;
  c      text;
  keep   text := '(name ilike ''amuse%'' or name ilike ''aqua%'' or name ilike ''hutong%'' or name ilike ''inddee%''
                   or name ilike ''%beverage%'' or name ilike ''%brix%'')';
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  if n <> 1 then raise exception 'Expected exactly one main Maestro event (16 or 17 Oct, not a dry run), found %. Nothing changed.', n; end if;
  select id into v_main from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  select id into v_dry from events where maestro and name ilike '%dry run 2%' order by date desc, created_at desc limit 1;

  -- 1. only the six kitchens stay on (both events); the others off, with their barker logins
  execute 'update barkers set is_active = false
            where is_active and kitchen_id in (select id from kitchens where event_id = any($1) and not ' || keep || ')'
    using array[v_main, v_dry];
  execute 'update kitchens set is_active = false, is_default = false
            where event_id = any($1) and is_active and not ' || keep
    using array[v_main, v_dry];

  -- 2. the main event takes Dry Run 2's printers (where Dry Run 2 has one), by kitchen name
  if v_dry is not null then
    update kitchens m set printer_ip = d.printer_ip, printer_port = d.printer_port
      from kitchens d
     where m.event_id = v_main and d.event_id = v_dry
       and lower(btrim(m.name)) = lower(btrim(d.name))
       and nullif(btrim(coalesce(d.printer_ip, '')), '') is not null;
    update kitchens m set backup_printer_ip = d.backup_printer_ip
      from kitchens d
     where m.event_id = v_main and d.event_id = v_dry
       and lower(btrim(m.name)) = lower(btrim(d.name))
       and nullif(btrim(coalesce(d.backup_printer_ip, '')), '') is not null;
    -- columns that a database may not have: copied only where they exist
    foreach c in array array['printer_ip_b', 'printer_port_b', 'printer_mac', 'backup_printer_mac'] loop
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'kitchens' and column_name = c) then
        execute format('update kitchens m set %1$I = d.%1$I from kitchens d
                         where m.event_id = $1 and d.event_id = $2
                           and lower(btrim(m.name)) = lower(btrim(d.name))
                           and nullif(btrim(coalesce(d.%1$I::text, '''')), '''') is not null', c)
          using v_main, v_dry;
      end if;
    end loop;
  end if;

  -- 3. the dry runs off: dated 14 Oct, their logins switched off
  update captains    set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update barkers     set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update supervisors set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update events set date = '2026-10-14' where maestro and name ilike '%dry run%' and date <> '2026-10-14';

  -- 4. the event is tonight
  update events set date = '2026-10-16' where id = v_main;
end $$;

notify pgrst, 'reload schema';

-- What is on today (only the main event should be listed)
select name, date from events where maestro and date >= '2026-10-14' order by date, name;

-- The main event tonight (the result the SQL Editor shows): 6 kitchens on, 9 printers
select k.name as kitchen, k.barkers,
       coalesce(nullif(btrim(coalesce(k.printer_ip, '')), ''), '— NOT SET —') as printer_a,
       case when k.barkers >= 2 then coalesce(nullif(btrim(coalesce(to_jsonb(k) ->> 'printer_ip_b', '')), ''), '— NOT SET —') else '' end as printer_b,
       coalesce((select string_agg(b.side || ' ' || b.name || ' ' || b.pin, ', ' order by b.side)
                   from barkers b where b.kitchen_id = k.id and b.is_active), '-') as barker_logins
  from kitchens k join events e on e.id = k.event_id
 where e.maestro and e.name not ilike '%dry run%' and e.date = '2026-10-16' and k.is_active
 order by k.sort_order, k.name;

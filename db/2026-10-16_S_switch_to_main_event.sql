-- =====================================================================
-- SWITCH TO THE MAIN EVENT (after the dry run). One paste, one Run.
-- Use this INSTEAD of 2026-10-16_E_after_dry_run_TONIGHT.sql (it does the same,
-- and first copies the dry run's logins). Safe to run twice. Nothing is deleted.
--
-- 1. The main event gets Dry Run 2's captain and barker logins exactly as they
--    were in the dry run (names, PIN, table, covers, kitchen, side A/B).
-- 2. Only the six kitchens stay on: Amuse Bouche, Aqua Italian, Hutong Oriental,
--    INDDEE Indian, Hot & Cold Beverages, Desserts by Brix (9 KOT printers).
-- 3. The main event takes the printers set and tested in Dry Run 2 (A, B, backup).
-- 4. Every dry run is moved to 14 Oct and its captain, barker, manager, desk and
--    screen logins are switched off: every tablet and kitchen screen still on a
--    dry run signs out by itself within a minute; signing in again with the same
--    name and PIN finds only the main event (no "Which event?").
-- 5. The main event is dated tonight, 16 Oct.
-- Admin logins are not touched.
-- =====================================================================
do $$
declare
  v_main  uuid;
  v_dry   uuid;
  n       int;
  c       record;
  b       record;
  v_id    uuid;
  v_kit   uuid;
  v_used  uuid[];
  col     text;
  keep    text := '(name ilike ''amuse%'' or name ilike ''aqua%'' or name ilike ''hutong%'' or name ilike ''inddee%''
                    or name ilike ''%beverage%'' or name ilike ''%brix%'')';
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  if n <> 1 then raise exception 'Expected exactly one main Maestro event (16 or 17 Oct, not a dry run), found %. Nothing changed.', n; end if;
  select id into v_main from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  select id into v_dry from events where maestro and name ilike '%dry run 2%' order by date desc, created_at desc limit 1;

  -- 1. the dry run's logins to the main event (skipped when already switched: dry run logins off)
  if v_dry is not null and exists (select 1 from captains where event_id = v_dry and is_active) then
    v_used := '{}';
    for c in select * from captains where event_id = v_dry and is_active order by table_number nulls last, cover_from nulls last, created_at loop
      v_id := null;
      select id into v_id from captains
       where event_id = v_main and not (id = any(v_used)) and lower(btrim(name)) = lower(btrim(c.name))
       order by (coalesce(table_number, 0) = coalesce(c.table_number, 0)) desc, is_active desc, created_at limit 1;
      if v_id is null then
        insert into captains (event_id, name, pin, mobile, table_number, cover_from, cover_to, is_active)
        values (v_main, c.name, c.pin, c.mobile, c.table_number, c.cover_from, c.cover_to, true)
        returning id into v_id;
      else
        update captains set name = c.name, pin = c.pin, mobile = c.mobile, table_number = c.table_number,
                            cover_from = c.cover_from, cover_to = c.cover_to, is_active = true
         where id = v_id;
      end if;
      v_used := v_used || v_id;
    end loop;
    update captains set is_active = false where event_id = v_main and is_active and not (id = any(v_used));

    v_used := '{}';
    for b in select br.*, k.name as kitchen_name from barkers br join kitchens k on k.id = br.kitchen_id
              where br.event_id = v_dry and br.is_active order by k.sort_order, br.side, br.created_at loop
      v_kit := null;
      select id into v_kit from kitchens where event_id = v_main and lower(btrim(name)) = lower(btrim(b.kitchen_name))
       order by is_active desc, created_at limit 1;
      continue when v_kit is null;
      v_id := null;
      select id into v_id from barkers
       where event_id = v_main and not (id = any(v_used)) and lower(btrim(name)) = lower(btrim(b.name))
       order by (kitchen_id = v_kit) desc, is_active desc, created_at limit 1;
      if v_id is null then
        insert into barkers (event_id, kitchen_id, side, name, pin, is_active)
        values (v_main, v_kit, b.side, b.name, b.pin, true)
        returning id into v_id;
      else
        update barkers set kitchen_id = v_kit, side = b.side, pin = b.pin, is_active = true where id = v_id;
      end if;
      v_used := v_used || v_id;
    end loop;
    update barkers set is_active = false where event_id = v_main and is_active and not (id = any(v_used));
  end if;

  -- 2. only the six kitchens stay on (both events); the others off, with their barker logins
  execute 'update barkers set is_active = false
            where is_active and kitchen_id in (select id from kitchens where event_id = any($1) and not ' || keep || ')'
    using array[v_main, v_dry];
  execute 'update kitchens set is_active = false, is_default = false
            where event_id = any($1) and is_active and not ' || keep
    using array[v_main, v_dry];

  -- 3. the main event takes Dry Run 2's printers (where Dry Run 2 has one), by kitchen name
  if v_dry is not null then
    update kitchens m set printer_ip = d.printer_ip, printer_port = d.printer_port
      from kitchens d
     where m.event_id = v_main and d.event_id = v_dry and lower(btrim(m.name)) = lower(btrim(d.name))
       and nullif(btrim(coalesce(d.printer_ip, '')), '') is not null;
    update kitchens m set backup_printer_ip = d.backup_printer_ip
      from kitchens d
     where m.event_id = v_main and d.event_id = v_dry and lower(btrim(m.name)) = lower(btrim(d.name))
       and nullif(btrim(coalesce(d.backup_printer_ip, '')), '') is not null;
    foreach col in array array['printer_ip_b', 'printer_port_b', 'printer_mac', 'backup_printer_mac'] loop
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'kitchens' and column_name = col) then
        execute format('update kitchens m set %1$I = d.%1$I from kitchens d
                         where m.event_id = $1 and d.event_id = $2
                           and lower(btrim(m.name)) = lower(btrim(d.name))
                           and nullif(btrim(coalesce(d.%1$I::text, '''')), '''') is not null', col)
          using v_main, v_dry;
      end if;
    end loop;
  end if;

  -- 4. the dry runs off: dated 14 Oct, all their logins switched off
  update captains    set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update barkers     set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update supervisors set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update events set date = '2026-10-14' where maestro and name ilike '%dry run%' and date <> '2026-10-14';

  -- 5. the event is tonight
  update events set date = '2026-10-16' where id = v_main;
end $$;

notify pgrst, 'reload schema';

-- Check (the one result the SQL Editor shows). Every row should say OK.
with main as (
  select id, name from events where maestro and name not ilike '%dry run%' and date = '2026-10-16'
)
select step, item, detail, ok from (
  -- events staff can sign in to tonight: only the main event
  select 1 as s, 'Event tonight' as step, e.name as item, e.date::text as detail,
         case when e.name ilike '%dry run%' then 'NO - dry run still dated tonight' else 'OK' end as ok
    from events e where e.date in ('2026-10-16', '2026-10-17')
  union all
  -- the six kitchens and their printers
  select 2, 'Kitchen', k.name,
         'A ' || coalesce(nullif(btrim(coalesce(k.printer_ip, '')), ''), 'NOT SET')
           || case when k.barkers >= 2 then '  ·  B ' || coalesce(nullif(btrim(coalesce(to_jsonb(k) ->> 'printer_ip_b', '')), ''), 'NOT SET') else '' end,
         case when nullif(btrim(coalesce(k.printer_ip, '')), '') is null
                or (k.barkers >= 2 and nullif(btrim(coalesce(to_jsonb(k) ->> 'printer_ip_b', '')), '') is null)
              then 'NO - printer missing' else 'OK' end
    from kitchens k join main m on m.id = k.event_id where k.is_active
  union all
  -- logins on the main event
  select 3, 'Logins', 'Captains', count(*)::text || ' on', case when count(*) > 0 then 'OK' else 'NO - none' end
    from captains c join main m on m.id = c.event_id where c.is_active
  union all
  select 3, 'Logins', 'Barkers', count(*)::text || ' on', case when count(*) > 0 then 'OK' else 'NO - none' end
    from barkers b join main m on m.id = b.event_id join kitchens k on k.id = b.kitchen_id where b.is_active and k.is_active
  union all
  select 3, 'Logins', 'Managers / desk / screens',
         coalesce(string_agg(coalesce(s.name, '?'), ', ' order by s.name), 'none'), 'OK'
    from supervisors s join main m on m.id = s.event_id where s.is_active
  union all
  -- nothing left on a dry run
  select 4, 'Dry run logins still on', 'captains, barkers, managers',
         ((select count(*) from captains where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
        + (select count(*) from barkers where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
        + (select count(*) from supervisors where is_active and event_id in (select id from events where maestro and name ilike '%dry run%')))::text,
         case when (select count(*) from captains where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
                 + (select count(*) from barkers where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
                 + (select count(*) from supervisors where is_active and event_id in (select id from events where maestro and name ilike '%dry run%')) = 0
              then 'OK' else 'NO' end
) x
order by s, step, item;

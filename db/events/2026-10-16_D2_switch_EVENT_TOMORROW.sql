-- =====================================================================
-- SWITCH-OVER, after today's dry run (on Dry Run 2): everyone on the main event.
-- EVENT TOMORROW (17 Oct): the main event RMA32 stays on 17 Oct.
-- Run once in the Supabase SQL Editor (safe to run twice). Nothing is deleted.
--
-- 1. The main event takes Dry Run 2's printers (Barker A and Barker B), by
--    kitchen name, where it has none yet (a printer already set stays).
-- 2. The dry runs move to 14 Oct and their captain, barker and supervisor
--    logins are switched off: every tablet and kitchen screen still on a dry
--    run signs out by itself within a minute; signing in then finds the main
--    event. The Print Hub (auto) switches to the main event by itself.
-- =====================================================================
do $$
declare
  v_main uuid;
  n      int;
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  if n <> 1 then raise exception 'Expected exactly one main Maestro event (16 or 17 Oct, not a dry run), found %. Nothing changed.', n; end if;
  select id into v_main from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');

  update kitchens m set printer_ip = d.printer_ip, printer_port = d.printer_port
    from kitchens d join events de on de.id = d.event_id
   where m.event_id = v_main and de.maestro and de.name ilike '%dry run 2%'
     and lower(btrim(m.name)) = lower(btrim(d.name))
     and nullif(btrim(coalesce(m.printer_ip, '')), '') is null
     and nullif(btrim(coalesce(d.printer_ip, '')), '') is not null;
  update kitchens m set printer_ip_b = d.printer_ip_b, printer_port_b = d.printer_port_b
    from kitchens d join events de on de.id = d.event_id
   where m.event_id = v_main and de.maestro and de.name ilike '%dry run 2%'
     and lower(btrim(m.name)) = lower(btrim(d.name))
     and nullif(btrim(coalesce(m.printer_ip_b, '')), '') is null
     and nullif(btrim(coalesce(d.printer_ip_b, '')), '') is not null;

  update captains    set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update barkers     set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update supervisors set is_active = false where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update events set date = '2026-10-14' where maestro and name ilike '%dry run%' and date <> '2026-10-14';
end $$;

-- The main event's date, and what is on today
select name, date from events where maestro and date >= '2026-10-14' order by date, name;

-- The main event's kitchens, printers and logins
select k.name as kitchen, k.is_active as on, k.barkers,
       coalesce(k.printer_ip, '— not set —') as printer_a, coalesce(k.printer_ip_b, '-') as printer_b,
       (select string_agg(b.side || ' ' || b.name, ', ' order by b.side) from barkers b where b.kitchen_id = k.id and b.is_active) as barker_logins
  from kitchens k join events e on e.id = k.event_id
 where e.maestro and e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')
 order by k.is_active desc, k.sort_order;

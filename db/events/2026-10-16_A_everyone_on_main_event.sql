-- =====================================================================
-- Event day, morning: everyone on the main event only.
-- Run once in the Supabase SQL Editor (safe to run twice). Nothing is deleted.
--
-- 1. The dry-run events move to 14 Oct (they show as Completed, keep their
--    reports) and their captain and barker logins are switched off. Every
--    tablet or kitchen screen still signed in to a dry run is signed out by
--    itself within a minute and lands on the sign-in screen; signing in then
--    finds only today's event, the main one. The dry runs' supervisor and
--    big-screen logins are switched off too, so the same PINs open the main event.
-- 2. The main event gets the printers of Dry Run 2 where it has none yet
--    (same kitchen name; a printer already set is never changed).
-- 3. A check of the main event: kitchens, printers, barkers, logins.
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

  -- 2. printers from Dry Run 2 (before it is moved), by kitchen name, only where the main event has none
  update kitchens m set printer_ip = d.printer_ip, printer_port = d.printer_port
    from kitchens d join events de on de.id = d.event_id
   where m.event_id = v_main and de.maestro and de.name ilike '%dry run 2%'
     and lower(btrim(m.name)) = lower(btrim(d.name))
     and nullif(btrim(coalesce(m.printer_ip, '')), '') is null
     and nullif(btrim(coalesce(d.printer_ip, '')), '') is not null;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'kitchens' and column_name = 'printer_ip_b') then
    execute $q$
      update kitchens m set printer_ip_b = d.printer_ip_b, printer_port_b = d.printer_port_b
        from kitchens d join events de on de.id = d.event_id
       where m.event_id = $1 and de.maestro and de.name ilike '%dry run 2%'
         and lower(btrim(m.name)) = lower(btrim(d.name))
         and nullif(btrim(coalesce(m.printer_ip_b, '')), '') is null
         and nullif(btrim(coalesce(d.printer_ip_b, '')), '') is not null
    $q$ using v_main;
  end if;

  -- 1. dry runs off: dated 14 Oct, logins switched off (devices signed out within a minute)
  update captains set is_active = false
   where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update barkers set is_active = false
   where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  -- the dry runs' supervisor and big-screen logins too: the same PINs then open the main event
  update supervisors set is_active = false
   where event_id in (select id from events where maestro and name ilike '%dry run%') and is_active;
  update events set date = '2026-10-14' where maestro and name ilike '%dry run%' and date <> '2026-10-14';
end $$;

-- 3. Today's events (only the main event should be listed)
select name, date, (select count(*) from captains c where c.event_id = e.id and c.is_active) as captains_on,
       (select count(*) from barkers b where b.event_id = e.id and b.is_active) as barkers_on
  from events e where date = '2026-10-16' order by name;

-- The main event's kitchens and printers
select k.name as kitchen, k.is_active as on, k.barkers,
       coalesce(k.printer_ip, '— not set —') as printer_a,
       coalesce(to_jsonb(k) ->> 'printer_ip_b', '-') as printer_b,
       (select string_agg(b.side || ' ' || b.name || ' ' || b.pin, ', ' order by b.side) from barkers b where b.kitchen_id = k.id and b.is_active) as barker_logins
  from kitchens k join events e on e.id = k.event_id
 where e.maestro and e.date = '2026-10-16' and e.name not ilike '%dry run%'
 order by k.is_active desc, k.sort_order;

-- =====================================================================
-- The main event gets the same captain and barker logins as Dry Run 2.
-- Run AFTER the captains and barkers are set in Dry Run 2, and BEFORE the
-- switch-over (2026-10-16_E_after_dry_run_TONIGHT.sql switches the dry run's
-- logins off). Safe to run twice; run it again after any later change in
-- Dry Run 2. Nothing is deleted. Dry Run 2 itself is not changed.
--
-- Captains: name, PIN, mobile, table and covers, as in Dry Run 2 (a main-event
--   captain with the same name is updated; a new name is added). A main-event
--   captain who is not in Dry Run 2 is switched off.
-- Barkers: name, PIN, kitchen (by kitchen name) and side A/B, as in Dry Run 2.
--   A main-event barker who is not in Dry Run 2 is switched off.
-- Supervisor, desk and big-screen logins are not touched.
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
  v_used  uuid[] := '{}';
  v_skip  text := '';
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  if n <> 1 then raise exception 'Expected exactly one main Maestro event (16 or 17 Oct, not a dry run), found %. Nothing changed.', n; end if;
  select id into v_main from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  select id into v_dry from events where maestro and name ilike '%dry run 2%' order by date desc, created_at desc limit 1;
  if v_dry is null then raise exception 'Dry Run 2 not found. Nothing changed.'; end if;
  if not exists (select 1 from captains where event_id = v_dry and is_active) then
    raise exception 'Dry Run 2 has no captain logins switched on (was the switch-over already run?). Nothing changed.';
  end if;

  -- ---- Captains -------------------------------------------------------------
  for c in select * from captains where event_id = v_dry and is_active order by table_number nulls last, cover_from nulls last, created_at loop
    v_id := null;
    select id into v_id from captains
     where event_id = v_main and not (id = any(v_used))
       and lower(btrim(name)) = lower(btrim(c.name))
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
  -- main-event captains not in Dry Run 2: off
  update captains set is_active = false where event_id = v_main and is_active and not (id = any(v_used));

  -- ---- Barkers (kitchen by name) ---------------------------------------------
  v_used := '{}';
  for b in select br.*, k.name as kitchen_name from barkers br join kitchens k on k.id = br.kitchen_id
            where br.event_id = v_dry and br.is_active order by k.sort_order, br.side, br.created_at loop
    v_kit := null;
    select id into v_kit from kitchens where event_id = v_main and lower(btrim(name)) = lower(btrim(b.kitchen_name))
     order by is_active desc, created_at limit 1;
    if v_kit is null then
      v_skip := v_skip || b.name || ' (' || b.kitchen_name || ') ';
      continue;
    end if;
    v_id := null;
    select id into v_id from barkers
     where event_id = v_main and not (id = any(v_used))
       and lower(btrim(name)) = lower(btrim(b.name))
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
  -- main-event barkers not in Dry Run 2: off
  update barkers set is_active = false where event_id = v_main and is_active and not (id = any(v_used));

  if v_skip <> '' then
    raise notice 'Not copied (no kitchen of that name in the main event): %', v_skip;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): the main event's logins next to Dry Run 2's.
-- same_as_dry_run should be true on every row.
with m as (
  select 'Captain' as login, c.name, c.pin, 'T' || coalesce(c.table_number::text, '?')
           || coalesce(' C' || c.cover_from || '-C' || c.cover_to, '') as place
    from captains c join events e on e.id = c.event_id
   where c.is_active and e.maestro and e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')
  union all
  select 'Barker', br.name, br.pin, k.name || ' · ' || br.side
    from barkers br join kitchens k on k.id = br.kitchen_id join events e on e.id = br.event_id
   where br.is_active and e.maestro and e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')
), d as (
  select 'Captain' as login, c.name, c.pin, 'T' || coalesce(c.table_number::text, '?')
           || coalesce(' C' || c.cover_from || '-C' || c.cover_to, '') as place
    from captains c
   where c.is_active and c.event_id = (select id from events where maestro and name ilike '%dry run 2%' order by date desc, created_at desc limit 1)
  union all
  select 'Barker', br.name, br.pin, k.name || ' · ' || br.side
    from barkers br join kitchens k on k.id = br.kitchen_id
   where br.is_active and br.event_id = (select id from events where maestro and name ilike '%dry run 2%' order by date desc, created_at desc limit 1)
)
select coalesce(m.login, d.login) as login, coalesce(m.name, d.name) as name, coalesce(m.pin, d.pin) as pin,
       coalesce(m.place, d.place) as place,
       (m.name is not null and d.name is not null) as same_as_dry_run
  from m full join d on d.login = m.login and lower(d.name) = lower(m.name) and d.pin = m.pin and d.place = m.place
 order by 1, 4, 2;

-- =====================================================================
-- Barker names, in Dry Run 2 AND the main event. Each barker keeps the PIN
-- of that kitchen and side (a missing login is added with the usual PIN:
-- Amuse 6101, Aqua 6201/6202, Hutong 6301/6302, INDDEE 6401/6402, Brix 6501,
-- Beverages 6701). Other logins of these six kitchens are switched off, so
-- each kitchen side has exactly one barker. Safe to run twice. Nothing deleted.
-- =====================================================================
do $$
declare
  e       record;
  r       record;
  v_k     uuid;
  v_id    uuid;
  v_kits  uuid[];
  v_keep  uuid[];
begin
  for e in select id, name from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    v_kits := '{}'; v_keep := '{}';
    for r in select * from (values
      ('amuse%',     'A', 'Maxwell', '6101'),
      ('aqua%',      'A', 'Rahul',   '6201'),
      ('aqua%',      'B', 'Raju',    '6202'),
      ('hutong%',    'A', 'Kanu',    '6301'),
      ('hutong%',    'B', 'Shekhar', '6302'),
      ('inddee%',    'A', 'Kamlesh', '6401'),
      ('inddee%',    'B', 'Pradeep', '6402'),
      ('%brix%',     'A', 'Brijesh', '6501'),
      ('%beverage%', 'A', 'Ritesh',  '6701')
    ) as x(pat, side, new_name, pin) loop
      v_k := null;
      select id into v_k from kitchens where event_id = e.id and name ilike r.pat order by is_active desc, created_at limit 1;
      if v_k is null then raise notice 'Event "%": no kitchen like %', e.name, r.pat; continue; end if;
      v_kits := v_kits || v_k;
      v_id := null;
      select id into v_id from barkers
       where event_id = e.id and kitchen_id = v_k and upper(coalesce(side, 'A')) = r.side and not (id = any(v_keep))
       order by (lower(btrim(name)) = lower(r.new_name)) desc, is_active desc,
                (pin = r.pin) desc, created_at
       limit 1;
      if v_id is null then
        insert into barkers (event_id, kitchen_id, side, name, pin, is_active)
        values (e.id, v_k, r.side, r.new_name, r.pin, true) returning id into v_id;
      else
        update barkers set name = r.new_name, side = r.side, is_active = true,
                           pin = coalesce(nullif(btrim(coalesce(pin, '')), ''), r.pin)
         where id = v_id;
      end if;
      v_keep := v_keep || v_id;
    end loop;
    -- one login per kitchen side: any other login of these kitchens off
    update barkers set is_active = false
     where event_id = e.id and is_active and kitchen_id = any(v_kits) and not (id = any(v_keep));
    -- logins of kitchens that are switched off (Gujarati Thali, Arabic, Tea & Coffee ...) off too
    update barkers set is_active = false
     where event_id = e.id and is_active and kitchen_id in (select id from kitchens where event_id = e.id and not is_active);
  end loop;
end $$;

-- Check (the result the SQL Editor shows): both events, the barkers with their PINs
select e.name as event, k.name as kitchen, b.side, b.name as barker, b.pin
  from barkers b join kitchens k on k.id = b.kitchen_id join events e on e.id = b.event_id
 where b.is_active and k.is_active
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by e.name, k.sort_order, b.side;

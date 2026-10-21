-- Captain names, barker names and PIN 1610 for all, in Dry Run 2 and the main event
do $$
declare
  e      record;
  r      record;
  v_id   uuid;
  v_miss text := '';
begin
  for e in select id, name from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    for r in select * from (values
      (1, 1, 'Khurshid'),
      (1, 2, 'Akshay'),
      (2, 1, 'Sohan'),
      (2, 2, 'Rizwan'),
      (3, 1, 'Sufail'),
      (3, 2, 'Vikas'),
      (4, 1, 'Ayub'),
      (4, 2, 'Mateen'),
      (5, 1, 'Delton'),
      (5, 2, 'Jinu'),
      (6, 1, 'Bharav'),
      (6, 2, 'Irfan'),
      (7, 1, 'Inayat'),
      (7, 2, 'Nishkarsh'),
      (8, 1, 'Rajesh'),
      (8, 2, 'Prince'),
      (9, 1, 'Muthu'),
      (9, 2, 'Sarfaraz'),
      (10, 1, 'Patwal'),
      (10, 2, 'Ryan'),
      (11, 1, 'Ansel'),
      (11, 2, 'Shivaji'),
      (12, 1, 'Pandey'),
      (12, 2, 'Janak')
    ) as x(tbl, slot, new_name) loop
      -- the captain: by the old name (T1-1, "T1 - 1" ...), else already renamed, else by covers
      v_id := null;
      select id into v_id from captains
       where event_id = e.id and table_number = r.tbl
         and (lower(regexp_replace(name, '\s', '', 'g')) = 't' || r.tbl || '-' || r.slot
              or lower(btrim(name)) = lower(r.new_name))
       order by is_active desc, (lower(btrim(name)) = lower(r.new_name)) desc, created_at limit 1;
      if v_id is null then
        select id into v_id from captains
         where event_id = e.id and table_number = r.tbl and is_active
           and coalesce(cover_from, 0) = case when r.slot = 1 then 1 else 5 end
         order by created_at limit 1;
      end if;
      if v_id is null then
        v_miss := v_miss || e.name || ' T' || r.tbl || '-' || r.slot || '; ';
        continue;
      end if;
      -- the new name is free (another, old login with that name gets " (old)")
      update captains set name = name || ' (old)'
       where event_id = e.id and id <> v_id and lower(btrim(name)) = lower(r.new_name);
      update captains
         set name = r.new_name, is_active = true,
             cover_from = case when r.slot = 1 then 1 else 5 end,
             cover_to   = case when r.slot = 1 then 4 else 8 end
       where id = v_id;
    end loop;
  end loop;
  if v_miss <> '' then raise notice 'Captain not found (add in Captains): %', v_miss; end if;
end $$;

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

update captains set pin = '1610'
 where is_active and event_id in (select id from events
   where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%'));
update barkers set pin = '1610'
 where is_active and event_id in (select id from events
   where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%'));

select e.name as event, 'Captain' as login, 'T' || c.table_number as place, c.name, c.pin
  from captains c join events e on e.id = c.event_id
 where c.is_active and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
union all
select e.name, 'Barker', k.name || ' ' || b.side, b.name, b.pin
  from barkers b join kitchens k on k.id = b.kitchen_id join events e on e.id = b.event_id
 where b.is_active and k.is_active and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by 1, 2, 3;

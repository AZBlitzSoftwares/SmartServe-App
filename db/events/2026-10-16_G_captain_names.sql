-- =====================================================================
-- Captain names for tables 1-12, in Dry Run 2 AND the main event.
-- Each captain keeps their PIN and table: they sign in with the new name and
-- the same PIN. Captain 1 of a table: covers C1-C4 (+ 1A); captain 2: C5-C8
-- (+ 2A); either opens the other's covers with "All covers".
-- Tables 13-15 are not changed. Safe to run twice. Nothing is deleted.
-- =====================================================================
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

-- Check (the result the SQL Editor shows): both events, tables 1-12, with PINs
select e.name as event, c.table_number as tbl, c.name as captain, c.pin,
       'C' || c.cover_from || '-C' || c.cover_to || case when c.cover_from = 1 then ' + 1A' else ' + 2A' end as covers
  from captains c join events e on e.id = c.event_id
 where c.is_active and c.table_number between 1 and 12
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by e.name, c.table_number, c.cover_from;

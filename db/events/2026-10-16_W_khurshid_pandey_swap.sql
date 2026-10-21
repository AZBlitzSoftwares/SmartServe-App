-- =====================================================================
-- Captain change, Dry Run 2 and the main event:
--   Khurshid -> Table 12, covers 1-4
--   Pandey   -> Table 1,  covers 1-4
-- Same names and PIN. Safe to run twice. Nothing is deleted.
-- After running: both sign out on their tablet (Switch captain) and sign in again.
-- =====================================================================
do $$
declare
  e record;
  n int;
begin
  for e in select id, name from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    select count(*) into n from captains
     where event_id = e.id and is_active and lower(btrim(name)) like 'khurshid%' and table_number in (1, 12) and cover_from = 1;
    if n > 1 then raise exception 'Event "%": % captains named Khurshid on covers 1-4. Nothing changed.', e.name, n; end if;
    select count(*) into n from captains
     where event_id = e.id and is_active and lower(btrim(name)) like 'pande%' and table_number in (1, 12) and cover_from = 1;
    if n > 1 then raise exception 'Event "%": % captains named Pandey on covers 1-4. Nothing changed.', e.name, n; end if;

    update captains set table_number = 12, cover_from = 1, cover_to = 4
     where event_id = e.id and is_active and lower(btrim(name)) like 'khurshid%' and table_number in (1, 12) and cover_from = 1;
    update captains set table_number = 1, cover_from = 1, cover_to = 4
     where event_id = e.id and is_active and lower(btrim(name)) like 'pande%' and table_number in (1, 12) and cover_from = 1;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): the captains of tables 1 and 12
select e.name as event, 'T' || c.table_number as table_no, 'C' || c.cover_from || '-C' || c.cover_to as covers, c.name as captain, c.pin
  from captains c join events e on e.id = c.event_id
 where c.is_active and c.table_number in (1, 12)
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by e.name, c.table_number, c.cover_from;

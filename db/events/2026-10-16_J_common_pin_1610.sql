-- =====================================================================
-- One PIN for every captain and barker: 1610 (Dry Run 2 and the main event).
-- Sign-in is name + PIN, so names stay as they are. Supervisor, desk and
-- big-screen logins are not changed. Safe to run twice.
-- =====================================================================
update captains set pin = '1610'
 where is_active and event_id in (select id from events
   where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%'));

update barkers set pin = '1610'
 where is_active and event_id in (select id from events
   where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%'));

-- Check (the result the SQL Editor shows): every login with PIN 1610
select e.name as event, 'Captain' as login, count(*) as logins, string_agg(distinct c.pin, ', ') as pins
  from captains c join events e on e.id = c.event_id
 where c.is_active and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name
union all
select e.name, 'Barker', count(*), string_agg(distinct b.pin, ', ')
  from barkers b join events e on e.id = b.event_id
 where b.is_active and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name
 order by 1, 2;

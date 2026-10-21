-- =====================================================================
-- Four view-only logins for the managers: Manager 1, Manager 2, Manager 3,
-- Manager 4, PIN 1610 (Dry Run 2 and the main event). They sign in on the
-- admin page (…/supervisor) with that name and PIN and see only the Control
-- Desk, view only: nothing can be changed. Safe to run twice.
-- =====================================================================
do $$
declare
  e  record;
  i  int;
  v  uuid;
begin
  for e in select id, name from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    for i in 1..4 loop
      v := null;
      select id into v from supervisors where event_id = e.id and lower(btrim(name)) = 'manager ' || i order by created_at limit 1;
      if v is null then
        insert into supervisors (event_id, name, pin, role, is_active) values (e.id, 'Manager ' || i, '1610', 'screen_desk', true);
      else
        update supervisors set name = 'Manager ' || i, pin = '1610', role = 'screen_desk', is_active = true where id = v;
      end if;
    end loop;
  end loop;
end $$;

-- Check (the result the SQL Editor shows)
select e.name as event, s.name as login, s.pin, s.role
  from supervisors s join events e on e.id = s.event_id
 where s.is_active and s.name ilike 'manager %'
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 order by e.name, s.name;

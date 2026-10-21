-- =====================================================================
-- The separate Gujarati Thali items (Pista Bedmi, Kanki Khichu, Undhiyu …)
-- out of every list: moved into a hidden cuisine and switched off, in Dry Run 2
-- and the main event. They no longer show under Aqua Italian (or anywhere) in
-- Dishes: course and barker, nor on a captain's tablet. Nothing is deleted.
-- Safe to run twice.
-- =====================================================================
do $$
declare
  e    record;
  v_c  uuid;
begin
  for e in select id from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    v_c := null;
    select id into v_c from menu_categories where event_id = e.id and name = 'Gujarati Thali (old items)' limit 1;
    if v_c is null then
      insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
      values (e.id, 'Gujarati Thali (old items)', 998, false, null) returning id into v_c;
    end if;
    update menu_categories set is_visible = false where id = v_c;
    update menu_items m set category_id = v_c, is_available = false
      from menu_categories c
     where c.id = m.category_id and c.event_id = e.id and m.category_id <> v_c
       and (m.course ilike 'gujarati%' or c.name ilike 'gujarati%');
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): no Gujarati Thali item left on any visible list (0)
select e.name as event,
       count(*) filter (where coalesce(c.is_visible, true) and m.course ilike 'gujarati%') as gujarati_items_still_listed,
       count(*) filter (where c.name = 'Gujarati Thali (old items)') as moved_to_hidden
  from menu_items m join menu_categories c on c.id = m.category_id join events e on e.id = c.event_id
 where e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name order by e.name;

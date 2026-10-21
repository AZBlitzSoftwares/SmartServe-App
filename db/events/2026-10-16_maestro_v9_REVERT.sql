-- =====================================================================
-- Undo 2026-10-16_maestro_v9_vip_menus.sql (run in the Supabase SQL Editor).
-- Everything goes back to how it was before v9 first ran:
--   - seating a VIP guest adds their preferred dishes to the order again
--     (ms_vip_apply as before, from the copy v9 saved in ss_fn_backup);
--   - the VIP guests' names, labels and dish lists (their thali items) as before;
--   - the Gujarati Thali kitchen on again, its cuisine and thali items shown;
--   - the dishes v9 added (Gujarati Thali as one dish, the family's dishes) hidden.
-- Nothing is deleted. Orders and KOTs are not touched.
-- =====================================================================
do $$
declare
  r record;
  n int := 0;
begin
  for r in select def from ss_fn_backup where tag = 'before_v9' loop
    execute r.def;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No backup found: v9 was not run on this database, nothing to undo.'; end if;

  -- VIP guests as before; a guest added by v9 switched off
  update ms_vip_guests g
     set name = b.data ->> 'name', label = b.data ->> 'label',
         dishes = coalesce(b.data -> 'dishes', '[]'::jsonb),
         is_active = coalesce((b.data ->> 'is_active')::boolean, true)
    from ss_v9_backup b
   where b.kind = 'vip' and b.id = g.id;
  update ms_vip_guests g set is_active = false
   where g.event_id in (select id from ss_v9_backup where kind = 'event')
     and not exists (select 1 from ss_v9_backup b where b.kind = 'vip' and b.id = g.id);

  -- kitchens on or off as before
  update kitchens k
     set is_active = coalesce((b.data ->> 'is_active')::boolean, true),
         is_default = coalesce((b.data ->> 'is_default')::boolean, false)
    from ss_v9_backup b
   where b.kind = 'kitchen' and b.id = k.id;

  -- cuisines shown or hidden as before
  update menu_categories c set is_visible = coalesce((b.data ->> 'is_visible')::boolean, true)
    from ss_v9_backup b
   where b.kind = 'category' and b.id = c.id;

  -- dishes as before (available, course, kitchen, barker, VIP only)
  update menu_items m
     set is_available = coalesce((b.data ->> 'is_available')::boolean, true),
         course = b.data ->> 'course',
         kitchen_id = (b.data ->> 'kitchen_id')::uuid,
         barker = b.data ->> 'barker',
         vip_only = coalesce((b.data ->> 'vip_only')::boolean, false)
    from ss_v9_backup b
   where b.kind = 'dish' and b.id = m.id;
  -- the dishes v9 added: hidden
  update menu_items m set is_available = false
    from ss_v9_backup b
   where b.kind = 'v9_dish' and b.id = m.id;

  -- the course list as before
  update events e set courses = array(select jsonb_array_elements_text(b.data -> 'courses'))
    from ss_v9_backup b
   where b.kind = 'event' and b.id = e.id and jsonb_typeof(b.data -> 'courses') = 'array';

  -- run v9 again later: it saves the function as it is now (the copies of the menu stay)
  delete from ss_fn_backup where tag = 'before_v9';
end $$;

notify pgrst, 'reload schema';

-- Check: VIP guests and their dishes, Gujarati Thali kitchen
select e.name as event, g.label, g.name, jsonb_array_length(g.dishes) as dishes
  from ms_vip_guests g join events e on e.id = g.event_id
 where g.is_active and e.maestro and e.date between '2026-10-14' and '2026-10-17'
 order by e.name, g.sort_order;
select e.name as event, k.name as kitchen, k.is_active as on
  from kitchens k join events e on e.id = k.event_id
 where e.maestro and e.date between '2026-10-14' and '2026-10-17' and k.name ilike 'gujarati%';

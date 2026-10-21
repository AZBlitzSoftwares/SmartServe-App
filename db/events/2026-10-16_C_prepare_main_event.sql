-- =====================================================================
-- The main event (RMA32) set up like Dry Run 2: Amuse Bouche (kitchen, cuisine
-- and one dish) and the kitchen list (Amuse Bouche 1 barker; Hutong, Aqua,
-- INDDEE 2 barkers; Hot & Cold Beverages = Beverages + Tea & Coffee, 1 barker;
-- Desserts by Brix 1 barker; Gujarati Thali as it is).
-- Run now. Safe to run twice. No date is changed, no device is affected,
-- Dry Run 2 is not touched. Printers are copied later, at the switch-over.
-- =====================================================================

do $$
declare n int;
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17');
  if n <> 1 then raise exception 'Expected exactly one main Maestro event (16 or 17 Oct, not a dry run), found %. Nothing changed.', n; end if;
end $$;

-- Amuse Bouche
do $$
declare
  e record;
  v_k  uuid;
  v_c  uuid;
begin
  for e in select id, courses from events
            where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17') loop
    -- the kitchen: the existing Amuse Bouche kitchen switched on (one barker), or a new one
    select id into v_k from kitchens where event_id = e.id and name ilike 'amuse%' order by created_at limit 1;
    if v_k is null then
      insert into kitchens (event_id, name, prefix, is_active, sort_order)
      values (e.id, 'Amuse Bouche', 'AB', true, 0) returning id into v_k;
    end if;
    update kitchens set name = 'Amuse Bouche', is_active = true, barkers = 1 where id = v_k;
    -- its Barker A login, if one was set up before
    update barkers set is_active = true where kitchen_id = v_k and side = 'A';

    -- the course, first in the event's course list
    -- (an event without its own list uses the app's standard one, so that list is written out first)
    if not ('Amuse Bouche' = any(coalesce(e.courses, '{}'))) then
      update events set courses = array_prepend('Amuse Bouche',
               case when coalesce(array_length(courses, 1), 0) = 0
                    then array['First Course', 'Soup', 'Starters', 'Mains', 'Dessert'] else courses end)
       where id = e.id;
    end if;

    -- the cuisine (menu category), routed to the kitchen
    select id into v_c from menu_categories where event_id = e.id and name ilike 'amuse%' order by created_at limit 1;
    if v_c is null then
      insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
      values (e.id, 'Amuse Bouche', 0, true, v_k) returning id into v_c;
    end if;
    update menu_categories set name = 'Amuse Bouche', is_visible = true, kitchen_id = v_k where id = v_c;

    -- the one dish
    if not exists (select 1 from menu_items where category_id = v_c and name = 'Amuse Bouche') then
      insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker)
      values (v_c, 'Amuse Bouche', null, true, true, 1, 'Amuse Bouche', 'A');
    end if;
    update menu_items set is_available = true, course = 'Amuse Bouche', barker = 'A', kitchen_id = null
     where category_id = v_c and name = 'Amuse Bouche';
    -- only one Amuse Bouche product: any other old dish in that cuisine is hidden (not deleted)
    update menu_items set is_available = false where category_id = v_c and name <> 'Amuse Bouche';
  end loop;
end $$;


-- The kitchen list
do $$
declare
  e      record;
  v_am   uuid; v_hu uuid; v_aq uuid; v_in uuid; v_bev uuid; v_tea uuid; v_des uuid;
  c_bev  uuid; c_des uuid;
begin
  for e in select id from events
            where maestro and name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17') loop
    select id into v_am  from kitchens where event_id = e.id and name ilike 'amuse%'  order by created_at limit 1;
    select id into v_hu  from kitchens where event_id = e.id and name ilike 'hutong%' order by created_at limit 1;
    select id into v_aq  from kitchens where event_id = e.id and name ilike 'aqua%'   order by created_at limit 1;
    select id into v_in  from kitchens where event_id = e.id and name ilike 'inddee%' order by created_at limit 1;
    select id into v_bev from kitchens where event_id = e.id and (name ilike '%beverage%') order by created_at limit 1;
    select id into v_tea from kitchens where event_id = e.id and name ilike 'tea%'    order by created_at limit 1;
    select id into v_des from kitchens where event_id = e.id and (name ilike 'dessert%' or name ilike '%brix%') order by created_at limit 1;

    -- A, B, C, D: on, barkers as listed
    update kitchens set is_active = true, barkers = 1 where id = v_am;
    update kitchens set is_active = true, barkers = 2 where id in (v_hu, v_aq, v_in);

    -- E: Beverages becomes Hot & Cold Beverages and takes over Tea & Coffee
    if v_bev is null and v_tea is not null then v_bev := v_tea; v_tea := null; end if;
    if v_bev is not null then
      update kitchens set name = 'Hot & Cold Beverages', is_active = true, barkers = 1 where id = v_bev;
      if v_tea is not null and v_tea <> v_bev then
        -- its course rule, cuisines, dishes chosen for it, and its barker login move over
        update kitchens set courses = (select array(select distinct x from unnest(coalesce(b.courses, '{}') || coalesce(t.courses, '{}')) x))
          from kitchens b, kitchens t
         where kitchens.id = v_bev and b.id = v_bev and t.id = v_tea;
        update menu_categories set kitchen_id = v_bev where kitchen_id = v_tea;
        update menu_items set kitchen_id = v_bev where kitchen_id = v_tea;
        update barkers set kitchen_id = v_bev, side = 'A' where kitchen_id = v_tea;
        update kitchens set is_active = false, is_default = false where id = v_tea;
      end if;
      -- one cuisine with the kitchen's name: the drinks of the other cuisines move into it
      select id into c_bev from menu_categories where kitchen_id = v_bev order by (name ilike '%beverage%') desc, sort_order, created_at limit 1;
      if c_bev is not null then
        update menu_categories set name = 'Hot & Cold Beverages', is_visible = true where id = c_bev;
        update menu_items set category_id = c_bev
         where category_id in (select id from menu_categories where kitchen_id = v_bev and id <> c_bev);
        update menu_categories set is_visible = false where kitchen_id = v_bev and id <> c_bev;
      end if;
    end if;

    -- F: Desserts by Brix, one barker
    if v_des is not null then
      update kitchens set name = 'Desserts by Brix', is_active = true, barkers = 1 where id = v_des;
      select id into c_des from menu_categories where kitchen_id = v_des order by sort_order, created_at limit 1;
      if c_des is not null and (select count(*) from menu_categories where kitchen_id = v_des) = 1 then
        update menu_categories set name = 'Desserts by Brix' where id = c_des;
      end if;
    end if;

    v_am := null; v_hu := null; v_aq := null; v_in := null; v_bev := null; v_tea := null; v_des := null;
    c_bev := null; c_des := null;
  end loop;
end $$;


notify pgrst, 'reload schema';

select e.name as event, e.date, k.name as kitchen, k.is_active as on, k.barkers,
       (select string_agg(c.name, ', ') from menu_categories c where c.kitchen_id = k.id and c.is_visible) as cuisines,
       (select count(*) from menu_items i join menu_categories c on c.id = i.category_id where c.kitchen_id = k.id and i.is_available) as dishes,
       (select string_agg(b.side || ' ' || b.name, ', ' order by b.side) from barkers b where b.kitchen_id = k.id and b.is_active) as barker_logins
  from events e join kitchens k on k.event_id = e.id
 where e.maestro and e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')
 order by k.is_active desc, k.sort_order;

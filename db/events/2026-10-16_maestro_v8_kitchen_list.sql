-- =====================================================================
-- Smart Serve Maestro: the event's kitchen list (Dry Run 2 and the main event).
-- Run AFTER 2026-10-16_maestro_v7_barker_printers.sql. Safe to run twice.
-- Nothing is deleted: a kitchen that is no longer used is switched off, a
-- cuisine that is merged is hidden.
--
--   A  Amuse Bouche            1 barker   1 printer
--   B  Hutong Oriental         2 barkers  2 printers (A and B)
--   C  Aqua Italian            2 barkers  2 printers (A and B)
--   D  INDDEE Indian           2 barkers  2 printers (A and B)
--   E  Hot & Cold Beverages    1 barker   1 printer   (Beverages + Tea & Coffee in one)
--   F  Desserts by Brix        1 barker   1 printer
--
-- Kitchen and cuisine keep the same name. In a one-barker kitchen every dish
-- goes to Barker A by itself. The printers are set at the venue
-- (Kitchens & printers › Find printers › Use for a kitchen).
-- =====================================================================
do $$
declare
  e      record;
  v_am   uuid; v_hu uuid; v_aq uuid; v_in uuid; v_bev uuid; v_tea uuid; v_des uuid;
  c_bev  uuid; c_des uuid;
begin
  for e in select id from events
            where maestro and date in ('2026-10-15', '2026-10-16') and name not ilike '%dry run 1%' loop
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

-- Check: the kitchens of Dry Run 2 and the main event
select e.name as event, e.date, k.name as kitchen, k.prefix, k.is_active as on, k.barkers,
       coalesce(k.printer_ip, '-') as printer_a,
       coalesce(to_jsonb(k) ->> 'printer_ip_b', '-') as printer_b,
       (select string_agg(c.name, ', ') from menu_categories c where c.kitchen_id = k.id and c.is_visible) as cuisines,
       (select count(*) from menu_items i join menu_categories c on c.id = i.category_id
         where c.kitchen_id = k.id and i.is_available) as dishes,
       (select string_agg(b.side || ' ' || b.name, ', ' order by b.side) from barkers b where b.kitchen_id = k.id and b.is_active) as barker_logins
  from events e join kitchens k on k.event_id = e.id
 where e.maestro and e.date >= '2026-10-15' and e.name not ilike '%dry run 1%'
 order by e.date, e.name, k.is_active desc, k.sort_order;

-- =====================================================================
-- Soft Drinks: a new drink category (a cuisine of Hot & Cold Beverages, after
-- Beer) with one item, "Soft Drink". The captain adds it and types which soft
-- drink in the dish note (Coke, Diet Coke, Sprite, Soda, Tonic ...); the note
-- prints on the KOT. Course Beverages, Barker A, at the Hot & Cold Beverages
-- printer. Dry Run 2 and the main event. Safe to run twice.
-- =====================================================================
do $$
declare
  e     record;
  v_k   uuid;
  v_c   uuid;
  v_tc  int;
  v_id  uuid;
begin
  for e in select id, name from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    select id into v_k from kitchens where event_id = e.id and name ilike '%beverage%' order by is_active desc, created_at limit 1;
    if v_k is null then raise exception 'Event "%": no Hot & Cold Beverages kitchen. Nothing changed.', e.name; end if;

    -- after Beer: takes Tea & Coffee's place, Tea & Coffee moves one down
    select sort_order into v_tc from menu_categories
     where event_id = e.id and kitchen_id = v_k and lower(btrim(name)) = 'tea & coffee' and coalesce(is_visible, true) limit 1;
    if v_tc is null then
      select coalesce(max(sort_order), 0) + 1 into v_tc from menu_categories where event_id = e.id and kitchen_id = v_k and coalesce(is_visible, true);
    end if;

    select id into v_c from menu_categories
     where event_id = e.id and kitchen_id = v_k and lower(btrim(name)) = 'soft drinks' order by created_at limit 1;
    if v_c is null then
      update menu_categories set sort_order = sort_order + 1
       where event_id = e.id and kitchen_id = v_k and coalesce(is_visible, true) and sort_order >= v_tc;
      insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
      values (e.id, 'Soft Drinks', v_tc, true, v_k) returning id into v_c;
    else
      update menu_categories set is_visible = true, kitchen_id = v_k where id = v_c;
    end if;

    select id into v_id from menu_items where category_id = v_c and lower(btrim(name)) = 'soft drink' order by created_at limit 1;
    if v_id is null then
      insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker, vip_only)
      values (v_c, 'Soft Drink', 'Type which one in the note: Coke, Diet Coke, Sprite, Soda, Tonic ...', true, true, 49, 'Beverages', 'A', false);
    else
      update menu_items set is_available = true, course = 'Beverages', barker = 'A', vip_only = false, kitchen_id = null,
                            description = 'Type which one in the note: Coke, Diet Coke, Sprite, Soda, Tonic ...'
       where id = v_id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): the drink categories in order, Soft Drinks after Beer
select e.name as event, c.sort_order, c.name as category, count(m.id) as drinks,
       string_agg(m.name, ', ' order by m.sort_order) as list
  from menu_categories c join events e on e.id = c.event_id
  left join menu_items m on m.category_id = c.id and coalesce(m.is_available, true)
 where c.is_visible and c.kitchen_id in (select id from kitchens where name ilike '%beverage%')
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name, c.sort_order, c.name
 order by e.name, c.sort_order;

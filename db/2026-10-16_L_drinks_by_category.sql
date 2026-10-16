-- =====================================================================
-- Drinks by category, as in the cocktail menu: Cocktail, Liqueurs & Vermouth,
-- Tequila, Gin, Vodka, Rum, Whisky, Herbal Liqueur, Cognac, Red & White Wine,
-- Champagne & Rosé, Beer, Tea & Coffee (55 drinks), in Dry Run 2 AND the main
-- event. Each category is a cuisine of the Hot & Cold Beverages kitchen: on the
-- captain's tablet it is a chip in the Cuisine row (tap Whisky: only whiskies)
-- and every drink tile shows its category. All drinks still print at Hot & Cold
-- Beverages (Barker A). Courses: Beverages, and Tea & Coffee.
-- Replaces the earlier drinks SQL (H); run it whether or not H was run.
-- Drinks not in this list are hidden (not deleted). Safe to run twice.
-- =====================================================================
do $$
declare
  e      record;
  r      record;
  v_k    uuid;
  v_c    uuid;
  v_old  uuid;
  v_id   uuid;
  v_keep uuid[];
  v_cats uuid[];
  v_base int;
begin
  for e in select id, name from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    select id into v_k from kitchens where event_id = e.id and name ilike '%beverage%' order by is_active desc, created_at limit 1;
    if v_k is null then raise exception 'Event "%": no Hot & Cold Beverages kitchen. Nothing changed.', e.name; end if;

    -- a hidden cuisine for drinks that are not on the list
    select id into v_old from menu_categories where event_id = e.id and kitchen_id = v_k and name = 'Hot & Cold Beverages (old samples)' limit 1;
    if v_old is null then
      insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
      values (e.id, 'Hot & Cold Beverages (old samples)', 999, false, v_k) returning id into v_old;
    end if;

    -- the drink categories come after the food cuisines
    select coalesce(max(sort_order), 0) into v_base from menu_categories
     where event_id = e.id and coalesce(is_visible, true) and kitchen_id is distinct from v_k;

    update events set courses = array_append(courses, 'Beverages')
     where id = e.id and coalesce(array_length(courses, 1), 0) > 0 and not ('Beverages' = any(courses));
    update events set courses = array_append(courses, 'Tea & Coffee')
     where id = e.id and coalesce(array_length(courses, 1), 0) > 0 and not ('Tea & Coffee' = any(courses));

    v_keep := '{}'; v_cats := '{}';
    for r in select * from (values
      (1, 'Cocktail', 'Beverages', 1, 'Espresso Martini', 'Vodka shaken with freshly brewed espresso and coffee liqueur, finished with a smooth layer of crema and garnished with three coffee beans.'),
      (1, 'Cocktail', 'Beverages', 2, 'French 75', 'Gin shaken with fresh lemon juice and sugar, topped with Champagne for a refreshing, crisp, and elegant finish.'),
      (1, 'Cocktail', 'Beverages', 3, 'Indian Picante', 'Tequila mixed with tangy kokum, fresh lime juice, and jalapeño. Served with a Tajín-spiced rim for a bold Indian-inspired twist.'),
      (2, 'Liqueurs & Vermouth', 'Beverages', 4, 'Cointreau', null),
      (2, 'Liqueurs & Vermouth', 'Beverages', 5, 'Dry Martini', null),
      (2, 'Liqueurs & Vermouth', 'Beverages', 6, 'Sweet Martini', null),
      (2, 'Liqueurs & Vermouth', 'Beverages', 7, 'Kahlúa', null),
      (2, 'Liqueurs & Vermouth', 'Beverages', 8, 'Baileys Irish Cream', null),
      (3, 'Tequila', 'Beverages', 9, 'Clase Azul Ultra', null),
      (3, 'Tequila', 'Beverages', 10, 'Clase Azul Gold', null),
      (3, 'Tequila', 'Beverages', 11, 'Clase Azul Plata', null),
      (3, 'Tequila', 'Beverages', 12, 'Clase Azul Reposado', null),
      (3, 'Tequila', 'Beverages', 13, 'Don Julio 1942', null),
      (4, 'Gin', 'Beverages', 14, 'Cherrapunji Gin', null),
      (4, 'Gin', 'Beverages', 15, 'Hendrick''s Gin', null),
      (4, 'Gin', 'Beverages', 16, 'Monkey 47 Gin', null),
      (5, 'Vodka', 'Beverages', 17, 'Clicks Vodka', null),
      (5, 'Vodka', 'Beverages', 18, 'Belvedere Vodka', null),
      (5, 'Vodka', 'Beverages', 19, 'Beluga Vodka', null),
      (6, 'Rum', 'Beverages', 20, 'Bacardí Carta Blanca', null),
      (6, 'Rum', 'Beverages', 21, 'Diplomático Rum', null),
      (7, 'Whisky', 'Beverages', 22, 'The Macallan 18 Years Old', null),
      (7, 'Whisky', 'Beverages', 23, 'The Macallan 25 Years Old', null),
      (7, 'Whisky', 'Beverages', 24, 'Glenfiddich 21 Years Old', null),
      (7, 'Whisky', 'Beverages', 25, 'Glenfiddich 30 Years Old', null),
      (7, 'Whisky', 'Beverages', 26, 'The Glenlivet 18 Years Old', null),
      (7, 'Whisky', 'Beverages', 27, 'Johnnie Walker Blue Label', null),
      (7, 'Whisky', 'Beverages', 28, 'The Yamazaki 18 Years Old', null),
      (7, 'Whisky', 'Beverages', 29, 'The Yamazaki 12 Years Old', null),
      (7, 'Whisky', 'Beverages', 30, 'Hibiki 21 Years Old', null),
      (7, 'Whisky', 'Beverages', 31, 'Royal Salute 38 Years Old', null),
      (7, 'Whisky', 'Beverages', 32, 'Royal Salute 62 Gun Salute', null),
      (7, 'Whisky', 'Beverages', 33, 'Jack Daniel''s', null),
      (7, 'Whisky', 'Beverages', 34, 'Royal Salute Gun Salute', null),
      (7, 'Whisky', 'Beverages', 35, 'Glenmorangie 18 Years Old', null),
      (7, 'Whisky', 'Beverages', 36, 'Johnnie Walker King George V', null),
      (8, 'Herbal Liqueur', 'Beverages', 37, 'Jägermeister', null),
      (9, 'Cognac', 'Beverages', 38, 'Martell VS', null),
      (9, 'Cognac', 'Beverages', 39, 'Louis XIII', null),
      (10, 'Red & White Wine', 'Beverages', 40, 'Sassicaia', null),
      (10, 'Red & White Wine', 'Beverages', 41, 'Opus One', null),
      (10, 'Red & White Wine', 'Beverages', 42, 'Brancaia 2023', null),
      (10, 'Red & White Wine', 'Beverages', 43, 'Cloudy Bay', null),
      (10, 'Red & White Wine', 'Beverages', 44, 'Chablis', null),
      (11, 'Champagne & Rosé', 'Beverages', 45, 'Dom Pérignon Rosé', null),
      (11, 'Champagne & Rosé', 'Beverages', 46, 'Dom Pérignon Brut', null),
      (11, 'Champagne & Rosé', 'Beverages', 47, 'Armand de Brignac Rosé (Ace of Spades)', null),
      (12, 'Beer', 'Beverages', 48, 'Corona', null),
      (12, 'Beer', 'Beverages', 49, 'Budweiser', null),
      (13, 'Tea & Coffee', 'Tea & Coffee', 50, 'Kesar Masala Tea', null),
      (13, 'Tea & Coffee', 'Tea & Coffee', 51, 'Nescafe', null),
      (13, 'Tea & Coffee', 'Tea & Coffee', 52, 'Espresso', null),
      (13, 'Tea & Coffee', 'Tea & Coffee', 53, 'Cappuccino', null),
      (13, 'Tea & Coffee', 'Tea & Coffee', 54, 'Café Latte', null),
      (13, 'Tea & Coffee', 'Tea & Coffee', 55, 'Americano', null)
    ) as x(cat_no, cat, course, ord, nm, descr) order by ord loop
      -- the category (cuisine) of the Hot & Cold Beverages kitchen
      v_c := null;
      select id into v_c from menu_categories
       where event_id = e.id and kitchen_id = v_k and lower(btrim(name)) = lower(r.cat) and id <> v_old
       order by coalesce(is_visible, true) desc, created_at limit 1;
      if v_c is null then
        insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
        values (e.id, r.cat, v_base + r.cat_no, true, v_k) returning id into v_c;
      end if;
      update menu_categories set name = r.cat, is_visible = true, sort_order = v_base + r.cat_no, kitchen_id = v_k where id = v_c;
      if not (v_c = any(v_cats)) then v_cats := v_cats || v_c; end if;

      -- the drink: the same name anywhere in this kitchen's cuisines, else new
      v_id := null;
      select m.id into v_id from menu_items m join menu_categories c on c.id = m.category_id
       where c.event_id = e.id and c.kitchen_id = v_k and lower(btrim(m.name)) = lower(r.nm) and not (m.id = any(v_keep))
       order by (m.category_id = v_c) desc, m.created_at limit 1;
      if v_id is null then
        insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker, vip_only)
        values (v_c, r.nm, r.descr, true, true, r.ord, r.course, 'A', false) returning id into v_id;
      else
        update menu_items set category_id = v_c, name = r.nm, description = r.descr, is_available = true,
                              sort_order = r.ord, course = r.course, barker = 'A', vip_only = false, kitchen_id = null
         where id = v_id;
      end if;
      v_keep := v_keep || v_id;
    end loop;

    -- anything else in this kitchen's cuisines: hidden
    update menu_items m set category_id = v_old, is_available = false
      from menu_categories c
     where c.id = m.category_id and c.event_id = e.id and c.kitchen_id = v_k and not (m.id = any(v_keep));
    -- cuisines of this kitchen that are not drink categories: hidden (e.g. the old "Hot & Cold Beverages")
    update menu_categories set is_visible = false
     where event_id = e.id and kitchen_id = v_k and not (id = any(v_cats));
    raise notice 'Event "%": % drinks in % categories', e.name, cardinality(v_keep), cardinality(v_cats);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): each category with its drinks
select e.name as event, c.name as category, m.course, count(*) as drinks,
       string_agg(m.name, ', ' order by m.sort_order) as list
  from menu_items m join menu_categories c on c.id = m.category_id join events e on e.id = c.event_id
 where c.is_visible and m.is_available
   and c.kitchen_id in (select id from kitchens where name ilike '%beverage%')
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name, c.name, c.sort_order, m.course
 order by e.name, c.sort_order;

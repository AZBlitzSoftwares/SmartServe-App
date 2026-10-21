-- =====================================================================
-- Hot & Cold Beverages: the drinks list of the sit-down dinner (cocktails, the
-- bar, tea and coffee), in Dry Run 2 AND the main event. 55 drinks.
-- All print at Hot & Cold Beverages (Barker A). On the captain's tablet: course
-- Beverages (cocktails and the bar, grouped by type, the type on each tile) and
-- course Tea & Coffee. Search finds a type too ("whisky", "gin" ...).
-- The sample drinks there before are hidden (not deleted). Safe to run twice.
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
begin
  for e in select id, name, courses from events
            where maestro and ((name not ilike '%dry run%' and date in ('2026-10-16', '2026-10-17')) or name ilike '%dry run 2%') loop
    select id into v_k from kitchens where event_id = e.id and name ilike '%beverage%' order by is_active desc, created_at limit 1;
    if v_k is null then raise exception 'Event "%": no Hot & Cold Beverages kitchen. Nothing changed.', e.name; end if;
    v_c := null;
    select id into v_c from menu_categories where event_id = e.id and kitchen_id = v_k and coalesce(is_visible, true)
     order by (name ilike '%beverage%') desc, sort_order, created_at limit 1;
    if v_c is null then
      insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
      values (e.id, 'Hot & Cold Beverages', 90, true, v_k) returning id into v_c;
    end if;
    update menu_categories set name = 'Hot & Cold Beverages', is_visible = true where id = v_c;

    -- both courses in the event's list
    update events set courses = array_append(courses, 'Beverages')
     where id = e.id and coalesce(array_length(courses, 1), 0) > 0 and not ('Beverages' = any(courses));
    update events set courses = array_append(courses, 'Tea & Coffee')
     where id = e.id and coalesce(array_length(courses, 1), 0) > 0 and not ('Tea & Coffee' = any(courses));

    v_keep := '{}';
    for r in select * from (values
      ('Espresso Martini', 'Cocktail · Vodka shaken with freshly brewed espresso and coffee liqueur, finished with a smooth layer of crema and garnished with three coffee beans.', 'Beverages', 1),
      ('French 75', 'Cocktail · Gin shaken with fresh lemon juice and sugar, topped with Champagne for a refreshing, crisp, and elegant finish.', 'Beverages', 2),
      ('Indian Picante', 'Cocktail · Tequila mixed with tangy kokum, fresh lime juice, and jalapeño. Served with a Tajín-spiced rim for a bold Indian-inspired twist.', 'Beverages', 3),
      ('Cointreau', 'Liqueurs & Vermouth', 'Beverages', 4),
      ('Dry Martini', 'Liqueurs & Vermouth', 'Beverages', 5),
      ('Sweet Martini', 'Liqueurs & Vermouth', 'Beverages', 6),
      ('Kahlúa', 'Liqueurs & Vermouth', 'Beverages', 7),
      ('Baileys Irish Cream', 'Liqueurs & Vermouth', 'Beverages', 8),
      ('Clase Azul Ultra', 'Tequila', 'Beverages', 9),
      ('Clase Azul Gold', 'Tequila', 'Beverages', 10),
      ('Clase Azul Plata', 'Tequila', 'Beverages', 11),
      ('Clase Azul Reposado', 'Tequila', 'Beverages', 12),
      ('Don Julio 1942', 'Tequila', 'Beverages', 13),
      ('Cherrapunji Gin', 'Gin', 'Beverages', 14),
      ('Hendrick''s Gin', 'Gin', 'Beverages', 15),
      ('Monkey 47 Gin', 'Gin', 'Beverages', 16),
      ('Clicks Vodka', 'Vodka', 'Beverages', 17),
      ('Belvedere Vodka', 'Vodka', 'Beverages', 18),
      ('Beluga Vodka', 'Vodka', 'Beverages', 19),
      ('Bacardí Carta Blanca', 'Rum', 'Beverages', 20),
      ('Diplomático Rum', 'Rum', 'Beverages', 21),
      ('The Macallan 18 Years Old', 'Whisky', 'Beverages', 22),
      ('The Macallan 25 Years Old', 'Whisky', 'Beverages', 23),
      ('Glenfiddich 21 Years Old', 'Whisky', 'Beverages', 24),
      ('Glenfiddich 30 Years Old', 'Whisky', 'Beverages', 25),
      ('The Glenlivet 18 Years Old', 'Whisky', 'Beverages', 26),
      ('Johnnie Walker Blue Label', 'Whisky', 'Beverages', 27),
      ('The Yamazaki 18 Years Old', 'Whisky', 'Beverages', 28),
      ('The Yamazaki 12 Years Old', 'Whisky', 'Beverages', 29),
      ('Hibiki 21 Years Old', 'Whisky', 'Beverages', 30),
      ('Royal Salute 38 Years Old', 'Whisky', 'Beverages', 31),
      ('Royal Salute 62 Gun Salute', 'Whisky', 'Beverages', 32),
      ('Jack Daniel''s', 'Whisky', 'Beverages', 33),
      ('Royal Salute Gun Salute', 'Whisky', 'Beverages', 34),
      ('Glenmorangie 18 Years Old', 'Whisky', 'Beverages', 35),
      ('Johnnie Walker King George V', 'Whisky', 'Beverages', 36),
      ('Jägermeister', 'Herbal Liqueur', 'Beverages', 37),
      ('Martell VS', 'Cognac', 'Beverages', 38),
      ('Louis XIII', 'Cognac', 'Beverages', 39),
      ('Sassicaia', 'Red & White Wine', 'Beverages', 40),
      ('Opus One', 'Red & White Wine', 'Beverages', 41),
      ('Brancaia 2023', 'Red & White Wine', 'Beverages', 42),
      ('Cloudy Bay', 'Red & White Wine', 'Beverages', 43),
      ('Chablis', 'Red & White Wine', 'Beverages', 44),
      ('Dom Pérignon Rosé', 'Champagne & Rosé', 'Beverages', 45),
      ('Dom Pérignon Brut', 'Champagne & Rosé', 'Beverages', 46),
      ('Armand de Brignac Rosé (Ace of Spades)', 'Champagne & Rosé', 'Beverages', 47),
      ('Corona', 'Beer', 'Beverages', 48),
      ('Budweiser', 'Beer', 'Beverages', 49),
      ('Kesar Masala Tea', 'Tea & Coffee', 'Tea & Coffee', 50),
      ('Nescafe', 'Tea & Coffee', 'Tea & Coffee', 51),
      ('Espresso', 'Tea & Coffee', 'Tea & Coffee', 52),
      ('Cappuccino', 'Tea & Coffee', 'Tea & Coffee', 53),
      ('Café Latte', 'Tea & Coffee', 'Tea & Coffee', 54),
      ('Americano', 'Tea & Coffee', 'Tea & Coffee', 55)
    ) as x(nm, descr, course, ord) loop
      v_id := null;
      select m.id into v_id from menu_items m where m.category_id = v_c and lower(btrim(m.name)) = lower(r.nm) order by m.created_at limit 1;
      if v_id is null then
        insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker, vip_only)
        values (v_c, r.nm, r.descr, true, true, r.ord, r.course, 'A', false) returning id into v_id;
      else
        update menu_items set name = r.nm, description = r.descr, is_available = true, sort_order = r.ord,
                              course = r.course, barker = 'A', vip_only = false, kitchen_id = null
         where id = v_id;
      end if;
      v_keep := v_keep || v_id;
    end loop;

    -- the sample drinks: into a hidden cuisine of the same kitchen, switched off
    if exists (select 1 from menu_items where category_id = v_c and not (id = any(v_keep))) then
      v_old := null;
      select id into v_old from menu_categories where event_id = e.id and kitchen_id = v_k and not coalesce(is_visible, true)
       order by created_at limit 1;
      if v_old is null then
        insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
        values (e.id, 'Hot & Cold Beverages (old samples)', 99, false, v_k) returning id into v_old;
      end if;
      update menu_items set category_id = v_old, is_available = false
       where category_id = v_c and not (id = any(v_keep));
    end if;
    raise notice 'Event "%": % drinks on Hot & Cold Beverages', e.name, cardinality(v_keep);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): drinks per event and course
select e.name as event, m.course, count(*) as drinks,
       string_agg(m.name, ', ' order by m.sort_order) as list
  from menu_items m join menu_categories c on c.id = m.category_id join events e on e.id = c.event_id
 where c.is_visible and c.name = 'Hot & Cold Beverages' and m.is_available
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name, m.course
 order by e.name, m.course;

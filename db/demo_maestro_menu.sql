-- Smart Serve Maestro demo: the client's sit-down dinner menu (29 dishes, all vegetarian).
-- Three cuisines - Italian, Oriental, Indian - each from its own kitchen, over six courses:
--   Soup, Appetizer, Entrée, Palate Cleanser, Main Course 1, Main Course 2,
-- plus Dessert, cooked in a separate Desserts kitchen (the desserts are placeholders until the
-- client's list arrives). Menu categories are kitchen-wise: Italian, Oriental, Indian, Desserts.
-- Every course is chosen by the guest and fired by the captain (no automatic first course).
-- Every table gets a table captain (the earlier eight logins are kept).
-- Barker A / B share each kitchen's dishes about half and half.
-- Replaces the demo event's menu, courses and kitchen layout and clears its test service
-- (orders, KOTs, chat, help requests). Kitchens on the Virtual Printers (127.0.0.1) are put on
-- ports 9101-9104; a kitchen already given a real printer keeps it. Safe to run more than once.
-- Run after demo_maestro_event.sql (Supabase > SQL Editor > paste > Run).
do $menu$
declare ev uuid := '00000000-0000-4000-8000-0000000de304';
        c record; cat uuid; kid uuid; has_sort boolean; has_mac boolean;
begin
  if not exists (select 1 from events where id = ev) then raise notice 'demo event not found'; return; end if;

  -- test service of the demo: it points at the earlier dishes and kitchens
  delete from ms_items      where event_id = ev;
  delete from ms_firings    where event_id = ev;
  delete from ms_covers     where event_id = ev;
  delete from kots          where event_id = ev;
  delete from sos_request_items where sos_request_id in (select id from sos_requests where event_id = ev);
  delete from sos_requests  where event_id = ev;
  delete from chat_messages where event_id = ev;

  update events set courses = array['Soup', 'Appetizer', 'Entrée', 'Palate Cleanser', 'Main Course 1', 'Main Course 2', 'Dessert'], first_course_auto = false where id = ev;

  -- kitchens: one per cuisine plus Desserts (renames the earlier demo's kitchens)
  update kitchens set name = 'Oriental' where event_id = ev and name = 'Asian'
     and not exists (select 1 from kitchens where event_id = ev and name = 'Oriental');
  update kitchens set name = 'Indian' where event_id = ev and name = 'Modern Indian'
     and not exists (select 1 from kitchens where event_id = ev and name = 'Indian');
  delete from barkers  where kitchen_id in (select id from kitchens where event_id = ev and name not in ('Italian', 'Oriental', 'Indian', 'Desserts'));
  delete from kitchens where event_id = ev and name not in ('Italian', 'Oriental', 'Indian', 'Desserts');
  select exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'kitchens' and column_name = 'printer_mac') into has_mac;
  for c in select * from (values (1, 'Italian', 'IT', 9101), (2, 'Oriental', 'OR', 9102), (3, 'Indian', 'IN', 9103), (4, 'Desserts', 'DS', 9104)) v(n, name, prefix, port) loop
    update kitchens set prefix = c.prefix, sort_order = c.n, is_active = true, barkers = 2,
           courses = case when c.name = 'Desserts' then array['Dessert'] else '{}'::text[] end,
           is_default = (c.name = 'Oriental'), kot_seq = 0, kot_seq_b = 0,
           printer_port = case when printer_ip is null or printer_ip = '127.0.0.1' then c.port else printer_port end,
           printer_ip = coalesce(printer_ip, '127.0.0.1')
     where event_id = ev and name = c.name;
    if not found then
      insert into kitchens (event_id, name, prefix, printer_ip, printer_port, sort_order, is_active, is_default, barkers, courses)
      values (ev, c.name, c.prefix, '127.0.0.1', c.port, c.n, true, c.name = 'Oriental', 2,
              case when c.name = 'Desserts' then array['Dessert'] else '{}'::text[] end);
    end if;
  end loop;
  if has_mac then
    -- the Virtual Printers have no hardware address; forget any learned for the old ports
    execute 'update kitchens set printer_mac = null where event_id = $1 and printer_ip = ''127.0.0.1''' using ev;
  end if;

  -- two barkers per kitchen (kept when already there)
  for c in select * from (values ('Italian', 'A', 'Ajay', '6201'), ('Italian', 'B', 'Vijay', '6202'), ('Oriental', 'A', 'Rohit', '6301'), ('Oriental', 'B', 'Kunal', '6302'), ('Indian', 'A', 'Farhan', '6401'), ('Indian', 'B', 'Sunil', '6402'), ('Desserts', 'A', 'Pooja', '6501'), ('Desserts', 'B', 'Meena', '6502')) v(kitchen, side, name, pin) loop
    select id into kid from kitchens where event_id = ev and name = c.kitchen;
    if not exists (select 1 from barkers where kitchen_id = kid and side = c.side and is_active) then
      insert into barkers (event_id, kitchen_id, side, name, pin, is_active) values (ev, kid, c.side, c.name, c.pin, true);
    end if;
  end loop;

  -- menu categories, kitchen-wise
  update menu_categories set name = 'Oriental' where event_id = ev and name = 'Asian'
     and not exists (select 1 from menu_categories where event_id = ev and name = 'Oriental');
  update menu_categories set name = 'Indian' where event_id = ev and name = 'Modern Indian'
     and not exists (select 1 from menu_categories where event_id = ev and name = 'Indian');
  update menu_categories set name = 'Desserts' where event_id = ev and name = 'Mexican'
     and not exists (select 1 from menu_categories where event_id = ev and name = 'Desserts');
  delete from menu_items where category_id in (select id from menu_categories where event_id = ev);
  delete from menu_categories where event_id = ev and name not in ('Italian', 'Oriental', 'Indian', 'Desserts');
  for c in select * from (values (1, 'Italian', 'IT', 9101), (2, 'Oriental', 'OR', 9102), (3, 'Indian', 'IN', 9103), (4, 'Desserts', 'DS', 9104)) v(n, name, prefix, port) loop
    select id into kid from kitchens where event_id = ev and name = c.name;
    update menu_categories set sort_order = c.n, kitchen_id = kid, is_visible = true where event_id = ev and name = c.name;
    if not found then
      insert into menu_categories (event_id, name, sort_order, kitchen_id, is_visible) values (ev, c.name, c.n, kid, true);
    end if;
  end loop;

  -- a table captain on every table (kept when the table already has one), so the
  -- pre-service check is all green: the demo's 15 tables
  for c in select * from (values ('Kabir', '4404', 4), ('Zoya', '5505', 5), ('Dev', '6606', 6), ('Ishaan', '9909', 9), ('Tanvi', '1010', 10), ('Rohan', '1101', 11), ('Sara', '1202', 12), ('Vivek', '1303', 13), ('Anaya', '1404', 14), ('Yusuf', '1505', 15)) v(name, pin, table_number) loop
    if not exists (select 1 from captains where event_id = ev and table_number = c.table_number and is_active)
       and not exists (select 1 from captains where event_id = ev and lower(name) = lower(c.name)) then
      insert into captains (event_id, name, pin, table_number, is_active) values (ev, c.name, c.pin, c.table_number, true);
    end if;
  end loop;

  select exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'menu_items' and column_name = 'sort_order') into has_sort;
  for c in select * from (values
    (1, 'Italian', 'Soup', 'Funghi Tea Soup', 'Truffle foam', 'A'),
    (2, 'Italian', 'Soup', 'Cream of Asparagus Soup (Jain)', 'Jain preparation', 'B'),
    (3, 'Italian', 'Appetizer', 'Spinach Gnudi Butter Sage', '', 'A'),
    (4, 'Italian', 'Entrée', 'Margherita Pizza', '', 'B'),
    (5, 'Italian', 'Entrée', 'Giardino Pizza (Jain)', 'Jain preparation', 'A'),
    (6, 'Italian', 'Palate Cleanser', 'Beetroot Sorbet', 'Cucumber granita', 'B'),
    (7, 'Italian', 'Main Course 1', 'Spaghetti Arrabiata', '', 'A'),
    (8, 'Italian', 'Main Course 2', 'Asparagus Barley Truffle Risotto', '', 'B'),
    (9, 'Oriental', 'Soup', 'Siamese Noodle Soup', '', 'A'),
    (10, 'Oriental', 'Appetizer', 'Crispy Kale & Asparagus Uramaki', 'Crispy kale uramaki, asparagus uramaki', 'B'),
    (11, 'Oriental', 'Entrée', 'Baked Yasai Umami', '', 'A'),
    (12, 'Oriental', 'Palate Cleanser', 'Lemongrass Granita', '', 'B'),
    (13, 'Oriental', 'Main Course 1', 'Grilled Tofu', 'Snow peas, baby pak choy, nut butter espuma', 'A'),
    (14, 'Oriental', 'Main Course 2', 'Blue Pea Flower Edamame Fried Rice', '', 'B'),
    (15, 'Oriental', 'Main Course 2', 'Exotic Veggies in Chili Basil Sauce', '', 'A'),
    (16, 'Indian', 'Soup', 'Tamatar Dhaniya Shorba', '', 'A'),
    (17, 'Indian', 'Appetizer', 'Potato Gratin Chaat', '', 'B'),
    (18, 'Indian', 'Appetizer', 'Dabeli Bao', '', 'A'),
    (19, 'Indian', 'Entrée', 'Ajmer Style Kadhi Kachori', '', 'B'),
    (20, 'Indian', 'Palate Cleanser', 'Sugarcane Sorbet', '', 'A'),
    (21, 'Indian', 'Main Course 1', 'Stracciatella Palak Saag', 'Truffle chili oil, makai di roti', 'B'),
    (22, 'Indian', 'Main Course 2', 'Amritsari Chole Kulcha', 'Amritsari chole, Amritsari kulcha, paneer makhani, onion chutney', 'A'),
    (23, 'Indian', 'Main Course 2', 'Dal Bukhara & Pyaz Ka Pulao', 'Dal Bukhara, pyaz ka pulao, papad roll', 'B'),
    (24, 'Desserts', 'Dessert', 'Tiramisu', 'Eggless, mascarpone, espresso', 'A'),
    (25, 'Desserts', 'Dessert', 'Pistachio Panna Cotta', 'Berry compote', 'B'),
    (26, 'Desserts', 'Dessert', 'Mango Sticky Rice', 'Coconut cream, sesame', 'A'),
    (27, 'Desserts', 'Dessert', 'Dark Chocolate Mousse', 'Eggless, cocoa nib crumble', 'B'),
    (28, 'Desserts', 'Dessert', 'Rasmalai Tres Leches', 'Saffron milk, pistachio', 'A'),
    (29, 'Desserts', 'Dessert', 'Kesar Pista Kulfi', 'Falooda, rose syrup', 'B')
  ) v(n, cuisine, course, name, description, barker) loop
    select id into cat from menu_categories where event_id = ev and name = c.cuisine;
    insert into menu_items (category_id, name, description, is_veg, is_available, is_live_counter, course, barker)
    values (cat, c.name, nullif(c.description, ''), true, true, false, c.course, c.barker);
    if has_sort then
      execute 'update menu_items set sort_order = $1 where category_id = $2 and name = $3' using c.n, cat, c.name;
    end if;
  end loop;
end $menu$;

-- check: four kitchens with their dishes
select k.name as kitchen, k.prefix, k.printer_ip || ':' || k.printer_port as printer, count(i.id) as dishes
  from kitchens k
  left join menu_categories mc on mc.kitchen_id = k.id
  left join menu_items i on i.category_id = mc.id
 where k.event_id = '00000000-0000-4000-8000-0000000de304'
 group by k.name, k.prefix, k.printer_ip, k.printer_port, k.sort_order
 order by k.sort_order;

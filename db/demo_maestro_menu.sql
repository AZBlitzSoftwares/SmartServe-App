-- Smart Serve Maestro demo: the sample menu (116 dishes, all vegetarian).
-- Three cuisines (Italian, Asian, Modern Indian), seven courses:
--   First Course (three bites, served to every guest automatically when seated),
--   Canapés, Soup, Salad, Appetiser, Main Course (7 dishes per cuisine each), Dessert (Italian + Mexican,
--   cooked in the Desserts kitchen). Guests mix cuisines freely within any course.
-- Barker A / B alternate inside each kitchen and course, so the rush of one course is shared.
-- Replaces the demo event's dishes; safe to run more than once. Run after demo_maestro_event.sql.
do $menu$
declare ev uuid := '00000000-0000-4000-8000-0000000de304';
        k_fc uuid; k_it uuid; k_as uuid; k_mi uuid; k_ds uuid; c record; cat uuid; has_sort boolean;
begin
  if not exists (select 1 from events where id = ev) then raise notice 'demo event not found'; return; end if;
  select id into k_fc from kitchens where event_id = ev and name = 'First Course';
  select id into k_it from kitchens where event_id = ev and name = 'Italian';
  select id into k_as from kitchens where event_id = ev and name = 'Asian';
  select id into k_mi from kitchens where event_id = ev and name = 'Modern Indian';
  select id into k_ds from kitchens where event_id = ev and name = 'Desserts';

  update events set courses = array['First Course', 'Canapés', 'Soup', 'Salad', 'Appetiser', 'Main Course', 'Dessert'], first_course_auto = true where id = ev;
  update kitchens set courses = array['First Course'], barkers = 1 where id = k_fc;
  update kitchens set courses = array['Dessert'] where id = k_ds;
  update kitchens set courses = '{}', barkers = 2 where id in (k_it, k_as, k_mi);

  delete from menu_items where category_id in (select id from menu_categories where event_id = ev);
  update menu_categories set name = 'Mexican' where event_id = ev and name = 'Desserts'
     and not exists (select 1 from menu_categories where event_id = ev and name = 'Mexican');
  for c in select * from (values (1, 'Chef''s Welcome', k_fc), (2, 'Italian', k_it), (3, 'Asian', k_as),
                                 (4, 'Modern Indian', k_mi), (5, 'Mexican', k_ds)) v(n, name, kid) loop
    update menu_categories set sort_order = c.n, kitchen_id = c.kid, is_visible = true where event_id = ev and name = c.name;
    if not found then
      insert into menu_categories (event_id, name, sort_order, kitchen_id, is_visible) values (ev, c.name, c.n, c.kid, true);
    end if;
  end loop;
  delete from menu_categories where event_id = ev
     and name not in ('Chef''s Welcome', 'Italian', 'Asian', 'Modern Indian', 'Mexican');

  select exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'menu_items' and column_name = 'sort_order') into has_sort;
  for c in select * from (values
    (1, 'Chef''s Welcome', 'First Course', 'Chilled Tomato Consommé Shot', 'Clear tomato water, basil oil', 'A'),
    (2, 'Chef''s Welcome', 'First Course', 'Truffle Edamame Spoon', 'Edamame mousse, truffle, sesame crumb', 'A'),
    (3, 'Chef''s Welcome', 'First Course', 'Mini Masala Puri', 'Spiced potato, tamarind pearl, sev', 'A'),
    (4, 'Italian', 'Canapés', 'Tomato Bruschetta', 'Heirloom tomato, basil, aged balsamic', 'A'),
    (5, 'Italian', 'Canapés', 'Truffle Arancini Bite', 'Crisp risotto, black truffle aioli', 'B'),
    (6, 'Italian', 'Canapés', 'Burrata Crostini', 'Creamy burrata, pesto, toasted sourdough', 'A'),
    (7, 'Italian', 'Canapés', 'Caprese Skewer', 'Bocconcini, cherry tomato, basil oil', 'B'),
    (8, 'Italian', 'Canapés', 'Wild Mushroom Tartlet', 'Mushroom duxelles, parmesan crisp', 'A'),
    (9, 'Italian', 'Canapés', 'Fig & Gorgonzola Bite', 'Caramelised fig, gorgonzola mousse', 'B'),
    (10, 'Italian', 'Canapés', 'Olive Tapenade Crostino', 'Kalamata tapenade, sun-dried tomato', 'A'),
    (11, 'Asian', 'Canapés', 'Honey Chilli Lotus Stem', 'Crisp lotus stem, sesame', 'A'),
    (12, 'Asian', 'Canapés', 'Edamame Truffle Dumpling', 'Steamed, truffle soy', 'B'),
    (13, 'Asian', 'Canapés', 'Avocado Maki', 'Avocado, cucumber, pickled ginger', 'A'),
    (14, 'Asian', 'Canapés', 'Spring Roll Cigar', 'Crisp roll, sweet chilli', 'B'),
    (15, 'Asian', 'Canapés', 'Glazed Tofu Bao Slider', 'Bao bun, glazed tofu, kimchi slaw', 'A'),
    (16, 'Asian', 'Canapés', 'Thai Corn Cake', 'Sweet corn fritter, cucumber relish', 'B'),
    (17, 'Asian', 'Canapés', 'Water Chestnut Satay', 'Peanut sauce, lime', 'A'),
    (18, 'Modern Indian', 'Canapés', 'Dhokla Bite', 'Khaman dhokla, mustard pearls', 'A'),
    (19, 'Modern Indian', 'Canapés', 'Pani Puri Shots', 'Spiced water, tamarind, boondi', 'B'),
    (20, 'Modern Indian', 'Canapés', 'Paneer Tikka Bite', 'Clay-oven paneer, mint', 'A'),
    (21, 'Modern Indian', 'Canapés', 'Dahi Puri', 'Sweet yoghurt, tamarind, sev', 'B'),
    (22, 'Modern Indian', 'Canapés', 'Mini Moong Kachori', 'Green chutney', 'A'),
    (23, 'Modern Indian', 'Canapés', 'Khandvi Roll', 'Gram flour roll, tempered mustard', 'B'),
    (24, 'Modern Indian', 'Canapés', 'Avocado Papdi Chaat', 'Avocado, chutneys, pomegranate', 'A'),
    (25, 'Italian', 'Soup', 'Minestrone', 'Vegetable and bean soup, basil oil', 'A'),
    (26, 'Italian', 'Soup', 'Roasted Tomato Basil Soup', 'Slow-roasted tomato, basil cream', 'B'),
    (27, 'Italian', 'Soup', 'Wild Mushroom Velouté', 'Porcini, thyme, truffle oil', 'A'),
    (28, 'Italian', 'Soup', 'Ribollita', 'Tuscan bread and cannellini soup', 'B'),
    (29, 'Italian', 'Soup', 'Pumpkin & Sage Crema', 'Roasted pumpkin, crisp sage', 'A'),
    (30, 'Italian', 'Soup', 'Asparagus Velouté', 'Green asparagus, parmesan foam', 'B'),
    (31, 'Italian', 'Soup', 'Zuppa di Fagioli', 'Borlotti beans, rosemary, olive oil', 'A'),
    (32, 'Asian', 'Soup', 'Hot & Sour Soup', 'Tofu, mushroom, white pepper', 'A'),
    (33, 'Asian', 'Soup', 'Tom Yum', 'Lemongrass, galangal, kaffir lime', 'B'),
    (34, 'Asian', 'Soup', 'Manchow Soup', 'Ginger, garlic, crispy noodles', 'A'),
    (35, 'Asian', 'Soup', 'Sweet Corn Soup', 'Creamed corn, spring onion', 'B'),
    (36, 'Asian', 'Soup', 'Miso Soup', 'Silken tofu, wakame, scallion', 'A'),
    (37, 'Asian', 'Soup', 'Tom Kha', 'Coconut, galangal, mushroom', 'B'),
    (38, 'Asian', 'Soup', 'Lemon Coriander Soup', 'Clear broth, fresh coriander', 'A'),
    (39, 'Modern Indian', 'Soup', 'Tomato Shorba', 'Spiced tomato broth, coriander', 'A'),
    (40, 'Modern Indian', 'Soup', 'Dal Shorba', 'Yellow lentil, cumin, ghee', 'B'),
    (41, 'Modern Indian', 'Soup', 'Palak Shorba', 'Spinach, garlic, cream', 'A'),
    (42, 'Modern Indian', 'Soup', 'Mulligatawny', 'Lentil, apple, mild spice', 'B'),
    (43, 'Modern Indian', 'Soup', 'Pepper Rasam', 'Tamarind, black pepper, curry leaf', 'A'),
    (44, 'Modern Indian', 'Soup', 'Badam Shorba', 'Almond, saffron, cardamom', 'B'),
    (45, 'Modern Indian', 'Soup', 'Gujarati Kadhi Shorba', 'Yoghurt, ginger, curry leaf', 'A'),
    (46, 'Italian', 'Salad', 'Classic Caprese', 'Buffalo mozzarella, tomato, basil', 'A'),
    (47, 'Italian', 'Salad', 'Panzanella', 'Bread, tomato, cucumber, red onion', 'B'),
    (48, 'Italian', 'Salad', 'Rocket & Parmesan Salad', 'Wild rocket, shaved parmesan, lemon', 'A'),
    (49, 'Italian', 'Salad', 'Burrata & Grilled Peach', 'Grilled peach, burrata, mint', 'B'),
    (50, 'Italian', 'Salad', 'Roasted Beet Carpaccio', 'Goat cheese, candied walnut', 'A'),
    (51, 'Italian', 'Salad', 'Tuscan Bean Salad', 'Cannellini, celery, herb dressing', 'B'),
    (52, 'Italian', 'Salad', 'Italian Garden Salad', 'Mixed leaves, olives, balsamic', 'A'),
    (53, 'Asian', 'Salad', 'Som Tam', 'Raw papaya, peanuts, lime', 'A'),
    (54, 'Asian', 'Salad', 'Glass Noodle Salad', 'Herbs, chilli lime dressing', 'B'),
    (55, 'Asian', 'Salad', 'Smashed Cucumber Salad', 'Sesame, chilli oil', 'A'),
    (56, 'Asian', 'Salad', 'Crispy Lotus Salad', 'Lotus stem, honey chilli', 'B'),
    (57, 'Asian', 'Salad', 'Japanese Seaweed Salad', 'Wakame, sesame dressing', 'A'),
    (58, 'Asian', 'Salad', 'Thai Raw Mango Salad', 'Red onion, peanuts, lime', 'B'),
    (59, 'Asian', 'Salad', 'Soba & Edamame Salad', 'Soba noodles, edamame, ponzu', 'A'),
    (60, 'Modern Indian', 'Salad', 'Kachumber', 'Cucumber, tomato, onion, lime', 'A'),
    (61, 'Modern Indian', 'Salad', 'Chana Chaat Salad', 'Chickpeas, tamarind, mint', 'B'),
    (62, 'Modern Indian', 'Salad', 'Koshimbir', 'Cucumber, peanuts, coconut', 'A'),
    (63, 'Modern Indian', 'Salad', 'Sprout Salad', 'Moong sprouts, pomegranate, chaat masala', 'B'),
    (64, 'Modern Indian', 'Salad', 'Tandoori Paneer Salad', 'Charred paneer, greens, mint dressing', 'A'),
    (65, 'Modern Indian', 'Salad', 'Beetroot Raita Salad', 'Beetroot, yoghurt, mustard seed', 'B'),
    (66, 'Modern Indian', 'Salad', 'Fruit Chaat', 'Seasonal fruit, chaat masala, mint', 'A'),
    (67, 'Italian', 'Appetiser', 'Arancini Trio', 'Saffron, truffle and pesto risotto balls', 'A'),
    (68, 'Italian', 'Appetiser', 'Melanzane Parmigiana', 'Baked aubergine, tomato, mozzarella', 'B'),
    (69, 'Italian', 'Appetiser', 'Polenta Fries', 'Parmesan, rosemary, garlic aioli', 'A'),
    (70, 'Italian', 'Appetiser', 'Stuffed Mushrooms', 'Spinach, ricotta, garlic crumb', 'B'),
    (71, 'Italian', 'Appetiser', 'Fried Zucchini Flowers', 'Ricotta-filled, light batter', 'A'),
    (72, 'Italian', 'Appetiser', 'Rosemary Focaccia Board', 'Olive oil, balsamic, olives', 'B'),
    (73, 'Italian', 'Appetiser', 'Burrata Plate', 'Burrata, roasted tomatoes, pesto', 'A'),
    (74, 'Asian', 'Appetiser', 'Crystal Veg Dim Sum', 'Water chestnut, greens, chilli oil', 'A'),
    (75, 'Asian', 'Appetiser', 'Szechuan Eggplant', 'Crisp aubergine, Szechuan pepper glaze', 'B'),
    (76, 'Asian', 'Appetiser', 'Kimchi Bao', 'Steamed bao, house kimchi, sesame', 'A'),
    (77, 'Asian', 'Appetiser', 'Tofu Satay', 'Charred tofu, peanut sauce', 'B'),
    (78, 'Asian', 'Appetiser', 'Chilli Paneer', 'Peppers, spring onion, soy chilli', 'A'),
    (79, 'Asian', 'Appetiser', 'Salt & Pepper Corn', 'Crisp sweet corn, garlic, chilli', 'B'),
    (80, 'Asian', 'Appetiser', 'Pan-fried Veg Gyoza', 'Vegetable dumplings, ponzu', 'A'),
    (81, 'Modern Indian', 'Appetiser', 'Paneer Tikka', 'Clay-oven cottage cheese, mint chutney', 'A'),
    (82, 'Modern Indian', 'Appetiser', 'Hara Bhara Kebab', 'Spinach and green pea patties', 'B'),
    (83, 'Modern Indian', 'Appetiser', 'Dahi Ke Kebab', 'Hung curd, cashew, crisp crust', 'A'),
    (84, 'Modern Indian', 'Appetiser', 'Tandoori Broccoli', 'Cheese marinade, charred', 'B'),
    (85, 'Modern Indian', 'Appetiser', 'Malai Soya Chaap', 'Cream, cardamom, clay oven', 'A'),
    (86, 'Modern Indian', 'Appetiser', 'Afghani Mushroom', 'Creamy marinade, tandoor', 'B'),
    (87, 'Modern Indian', 'Appetiser', 'Corn Seekh Kebab', 'Sweet corn, spices, skewered', 'A'),
    (88, 'Italian', 'Main Course', 'Truffle Risotto', 'Arborio rice, parmesan, black truffle', 'A'),
    (89, 'Italian', 'Main Course', 'Wild Mushroom Ravioli', 'Sage butter, parmesan', 'B'),
    (90, 'Italian', 'Main Course', 'Penne Arrabbiata', 'Spicy tomato, garlic, basil', 'A'),
    (91, 'Italian', 'Main Course', 'Spinach & Ricotta Cannelloni', 'Baked in tomato and béchamel', 'B'),
    (92, 'Italian', 'Main Course', 'Pesto Gnocchi', 'Potato gnocchi, basil pesto, pine nuts', 'A'),
    (93, 'Italian', 'Main Course', 'Wood-fired Margherita', 'Tomato, mozzarella, basil', 'B'),
    (94, 'Italian', 'Main Course', 'Spaghetti Aglio e Olio', 'Garlic, chilli, olive oil', 'A'),
    (95, 'Asian', 'Main Course', 'Thai Green Curry', 'Coconut, basil, jasmine rice', 'A'),
    (96, 'Asian', 'Main Course', 'Burnt Garlic Fried Rice', 'Wok-tossed, spring onion', 'B'),
    (97, 'Asian', 'Main Course', 'Hakka Noodles', 'Wok-tossed noodles, vegetables', 'A'),
    (98, 'Asian', 'Main Course', 'Mapo Tofu', 'Silken tofu, chilli bean sauce, steamed rice', 'B'),
    (99, 'Asian', 'Main Course', 'Pad Thai', 'Rice noodles, tamarind, peanuts', 'A'),
    (100, 'Asian', 'Main Course', 'Thai Red Curry', 'Vegetables, coconut, steamed rice', 'B'),
    (101, 'Asian', 'Main Course', 'Greens in Black Bean Sauce', 'Bok choy, broccoli, mushroom', 'A'),
    (102, 'Modern Indian', 'Main Course', 'Dal Makhani', 'Slow-cooked black lentils, butter, naan', 'A'),
    (103, 'Modern Indian', 'Main Course', 'Paneer Butter Masala', 'Tomato makhani gravy, naan', 'B'),
    (104, 'Modern Indian', 'Main Course', 'Veg Dum Biryani', 'Layered basmati, saffron, raita', 'A'),
    (105, 'Modern Indian', 'Main Course', 'Undhiyu', 'Gujarati winter vegetables, methi muthia, puri', 'B'),
    (106, 'Modern Indian', 'Main Course', 'Malai Kofta', 'Paneer dumplings, cashew gravy', 'A'),
    (107, 'Modern Indian', 'Main Course', 'Subz Kolhapuri', 'Spicy mixed vegetables, tandoori roti', 'B'),
    (108, 'Modern Indian', 'Main Course', 'Kadhai Paneer', 'Bell peppers, kadhai masala', 'A'),
    (109, 'Italian', 'Dessert', 'Tiramisu', 'Coffee, mascarpone, cocoa (eggless)', 'A'),
    (110, 'Italian', 'Dessert', 'Vanilla Panna Cotta', 'Berry compote', 'B'),
    (111, 'Italian', 'Dessert', 'Pistachio Cannoli', 'Ricotta, pistachio, dark chocolate', 'A'),
    (112, 'Italian', 'Dessert', 'Affogato', 'Vanilla gelato, espresso', 'B'),
    (113, 'Mexican', 'Dessert', 'Churros', 'Cinnamon sugar, chocolate dip', 'A'),
    (114, 'Mexican', 'Dessert', 'Tres Leches', 'Three-milk sponge cake', 'B'),
    (115, 'Mexican', 'Dessert', 'Sopapillas', 'Honey, cinnamon pastry', 'A'),
    (116, 'Mexican', 'Dessert', 'Mango Chamoy Sorbet', 'Mango, chilli-lime', 'B')
  ) v(n, cuisine, course, name, description, barker) loop
    select id into cat from menu_categories where event_id = ev and name = c.cuisine;
    insert into menu_items (category_id, name, description, is_veg, is_available, is_live_counter, course, barker)
    values (cat, c.name, c.description, true, true, false, c.course, c.barker);
    if has_sort then
      execute 'update menu_items set sort_order = $1 where category_id = $2 and name = $3' using c.n, cat, c.name;
    end if;
  end loop;
end $menu$;

-- =====================================================================
-- Smart Serve Maestro v9: the family's own menus, Gujarati Thali as one dish.
-- Dry Run 2 and the main event. Run in the Supabase SQL Editor, with the app
-- update of the same round. Safe to run twice. Nothing is deleted.
-- Undo: 2026-10-16_maestro_v9_REVERT.sql
--
-- 1. Choosing a VIP guest on a cover adds NO dishes to the order any more:
--    their allergies and notes go on the cover (and on every KOT, with the
--    VIP's name at the top). The captain's tablet shows the guest's own menu.
-- 2. The five family members, each with the menu of their booklet:
--      NMA - Mrs Nita Ambani, RMA - Mrs Radhika Merchant Ambani,
--      SMA - Mrs Shloka Mehta Ambani, Mr Anant Ambani, Mr Akash Ambani
--    Aqua, Hutong and INDDEE (7 courses each) and their Brix desserts. A
--    booklet dish already on the menu is used as it is (same kitchen, same
--    barker; where their booklet describes it differently, the captain sees
--    their booklet's words). A dish only in a booklet (Bok Choy with Mix
--    Veggies, the sugar-free Brix desserts …) is added in the same cuisine
--    and kitchen as a "VIP guests only" dish.
-- 3. Gujarati Thali: ONE dish, course Gujarati Thali, for every guest, made
--    by INDDEE Indian (its KOT prints there). No kitchen of its own: the
--    Gujarati Thali kitchen is switched off, its separate thali items hidden.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Copies for the undo (kept from the first run)
-- ---------------------------------------------------------------------
create table if not exists ss_fn_backup (
  tag      text not null,
  fn       text not null,
  def      text not null,
  saved_at timestamptz not null default now(),
  primary key (tag, fn)
);
alter table ss_fn_backup enable row level security;   -- not readable through the app's API
insert into ss_fn_backup (tag, fn, def)
select 'before_v9', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'ms_vip_apply'
on conflict (tag, fn) do nothing;

create table if not exists ss_v9_backup (
  kind     text not null,      -- event | vip | kitchen | category | dish | v9_dish (added by v9)
  id       uuid not null,
  data     jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (kind, id)
);
alter table ss_v9_backup enable row level security;

-- ---------------------------------------------------------------------
-- 1. Seating a VIP guest: the guest on the cover, nothing added to the order
-- ---------------------------------------------------------------------
create or replace function ms_vip_apply(p_event_id uuid, p_table_number int, p_cover_no int,
                                        p_vip_id uuid, p_captain_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g        ms_vip_guests;
  v_note   text;
  v_seat   jsonb;
begin
  select * into g from ms_vip_guests where id = p_vip_id and event_id = p_event_id and is_active;
  if g.id is null then raise exception 'NO_VIP: this VIP guest is not on the list'; end if;
  if p_cover_no is null or p_cover_no < 1 then raise exception 'NO_COVER: choose the cover first'; end if;

  -- one cover at a time: a guest moved to another cover leaves the old one
  update ms_items set state = 'cancelled', cancelled_at = now()
   where event_id = p_event_id and vip_guest_id = g.id and state = 'held'
     and not (table_number = p_table_number and cover_no = p_cover_no);
  update ms_covers set vip_guest_id = null, guest_note = null, guest_allergy = null
   where event_id = p_event_id and vip_guest_id = g.id
     and not (table_number = p_table_number and cover_no = p_cover_no);

  v_note := nullif(concat_ws(', ', nullif(btrim(coalesce(g.notes, '')), ''),
                             case when nullif(btrim(coalesce(g.likes, '')), '') is not null
                                  then 'Likes: ' || replace(btrim(g.likes), ',', ' /') end,
                             case when nullif(btrim(coalesce(g.dislikes, '')), '') is not null
                                  then 'Dislikes: ' || replace(btrim(g.dislikes), ',', ' /') end), '');

  insert into ms_covers (event_id, table_number, cover_no, guest_note, guest_allergy, vip_guest_id, vip_done)
  values (p_event_id, p_table_number, p_cover_no, v_note, nullif(btrim(coalesce(g.allergies, '')), ''), g.id, true)
  on conflict (event_id, table_number, cover_no)
  do update set guest_note = excluded.guest_note, guest_allergy = excluded.guest_allergy,
                vip_guest_id = excluded.vip_guest_id, vip_done = true;

  -- (no dishes are added: the captain's tablet shows the guest's own menu)
  v_seat := ms_seat(p_event_id, p_table_number, array[p_cover_no], p_captain_id, true, true);

  return jsonb_build_object('vip', g.name, 'held', 0, 'ids', '[]'::jsonb, 'seat', v_seat);
end $$;

grant execute on function ms_vip_apply(uuid, int, int, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Helpers for matching the booklets to the menu (dropped at the end)
-- ---------------------------------------------------------------------
-- "Garden Consommé, Steamed …" -> "gardenconsommesteamed…" (letters and digits only; "tt" left
-- out, so a name copied from a PDF as "Rico a" still matches "Ricotta")
create or replace function ss_v9_norm(t text) returns text language sql immutable as $f$
  select replace(regexp_replace(lower(translate(
           replace(replace(replace(replace(replace(coalesce(t, ''), 'ﬀ', 'ff'), 'ﬁ', 'fi'), 'ﬂ', 'fl'), 'ﬃ', 'ffi'), 'ﬄ', 'ffl'),
           'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
           'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]', '', 'g'), 'tt', '')
$f$;
-- a course, whatever its spelling: Appetiser/Appetizer, Entrée/Entree, Main Course I/1 …
create or replace function ss_v9_ckey(t text) returns text language sql immutable as $f$
  select case when n ~ '^soup' then 'soup'
              when n ~ '^(appeti|starter)' then 'appetiser'
              when n ~ '^entr' then 'entree'
              when n ~ '^palate' then 'palate'
              when n ~ '^maincourse(1|i|one)$' then 'main1'
              when n ~ '^maincourse(2|ii|two)$' then 'main2'
              when n ~ '^dessert' then 'dessert'
              else n end
    from (select regexp_replace(lower(translate(coalesce(t, ''), 'Éé', 'Ee')), '[^a-z0-9]', '', 'g') as n) x
$f$;

-- ---------------------------------------------------------------------
-- 3. Gujarati Thali, and the five family menus
-- ---------------------------------------------------------------------
do $$
declare
  e       record;
  r       record;
  g       ms_vip_guests;
  v_tpl   menu_items;
  v_n     int := 0;
  v_k     uuid;
  v_cat   uuid;
  v_in_k  uuid;
  v_in_c  uuid;
  v_gt_k  uuid;
  v_gt    uuid;
  v_course text;
  v_dish  uuid;
  v_dname text;
  v_ddesc text;
  v_nt    text;
  v_ntd   text;
  v_desc  text;
  v_entry jsonb;
  v_menus jsonb;
  v_who   text;
  v_made  int;
begin
  for e in select ev.id, ev.name, ev.courses from events ev
            where ev.maestro and ev.date between '2026-10-14' and '2026-10-17'
              and ev.name not ilike '%dry run 1%'
              and exists (select 1 from kitchens k where k.event_id = ev.id and k.name ilike 'inddee%')
            order by ev.date, ev.name loop
    v_n := v_n + 1;
    v_made := 0;
    v_menus := '{}'::jsonb;

    -- copies for the undo, taken the first time only
    if not exists (select 1 from ss_v9_backup where kind = 'event' and id = e.id) then
      insert into ss_v9_backup (kind, id, data) values ('event', e.id, jsonb_build_object('name', e.name, 'courses', to_jsonb(e.courses)));
      insert into ss_v9_backup (kind, id, data) select 'vip', x.id, to_jsonb(x) from ms_vip_guests x where x.event_id = e.id on conflict do nothing;
      insert into ss_v9_backup (kind, id, data) select 'kitchen', x.id, to_jsonb(x) from kitchens x where x.event_id = e.id on conflict do nothing;
      insert into ss_v9_backup (kind, id, data) select 'category', x.id, to_jsonb(x) from menu_categories x where x.event_id = e.id on conflict do nothing;
      insert into ss_v9_backup (kind, id, data)
      select 'dish', m.id, to_jsonb(m) from menu_items m join menu_categories c on c.id = m.category_id
       where c.event_id = e.id on conflict do nothing;
    end if;

    -- ---- Gujarati Thali: one dish, made by INDDEE Indian -------------------
    select id into v_in_k from kitchens where event_id = e.id and name ilike 'inddee%' order by is_active desc, created_at limit 1;
    select id into v_in_c from menu_categories where event_id = e.id and kitchen_id = v_in_k
     order by coalesce(is_visible, true) desc, sort_order, created_at limit 1;
    if v_in_c is null then
      raise exception 'Event "%": INDDEE Indian has no cuisine (menu category). Nothing changed.', e.name;
    end if;
    update kitchens set is_active = true where id = v_in_k;

    v_gt := null;
    select m.id into v_gt from menu_items m where m.category_id = v_in_c and m.name = 'Gujarati Thali' order by m.created_at limit 1;
    if v_gt is null then
      insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker, kitchen_id, vip_only)
      values (v_in_c, 'Gujarati Thali', null, true, true, 900, 'Gujarati Thali', 'A', v_in_k, false)
      returning id into v_gt;
      insert into ss_v9_backup (kind, id, data) values ('v9_dish', v_gt, jsonb_build_object('event', e.id, 'name', 'Gujarati Thali'))
      on conflict do nothing;
    end if;
    -- for every guest (not VIP only), sent to INDDEE Indian, Barker A
    update menu_items set is_available = true, vip_only = false, course = 'Gujarati Thali', kitchen_id = v_in_k, barker = 'A'
     where id = v_gt;
    update events set courses = array_append(courses, 'Gujarati Thali')
     where id = e.id and coalesce(array_length(courses, 1), 0) > 0 and not ('Gujarati Thali' = any(courses));

    -- the Gujarati Thali kitchen switched off; its cuisine and the separate thali items hidden
    v_gt_k := null;
    select id into v_gt_k from kitchens where event_id = e.id and name ilike 'gujarati%' order by created_at limit 1;
    if v_gt_k is not null then
      update menu_categories set is_visible = false where event_id = e.id and kitchen_id = v_gt_k and id <> v_in_c;
      update kitchens set is_active = false, is_default = false where id = v_gt_k;
    end if;
    update menu_categories set is_visible = false where event_id = e.id and name ilike 'gujarati%' and id <> v_in_c;
    update menu_items m set is_available = false
      from menu_categories c
     where c.id = m.category_id and c.event_id = e.id and m.id <> v_gt
       and (m.course = 'Gujarati Thali' or c.name ilike 'gujarati%' or c.kitchen_id = v_gt_k);

    -- ---- The family's menus, booklet by booklet ------------------------------
    for r in select * from (values
      -- NMA: Mrs Nita Ambani
      ('NMA', 'aqua', 'Soup', 1, 'Garden Consommé, Steamed Jerusalem Artichoke & Celeriac', null),
      ('NMA', 'aqua', 'Appetiser', 2, 'Shallot Tart, Edible Flowers, Parmesan 24 Month Fondue', null),
      ('NMA', 'aqua', 'Entrée', 3, 'Asparagus, Truffle, Parmentier Sauce & Fresh Salad Leaves', null),
      ('NMA', 'aqua', 'Palate Cleanser', 4, 'Fennel Granita', null),
      ('NMA', 'aqua', 'Main Course 1', 5, 'Homemade Gnocchi, Baby Zucchini & Mint Sauce', null),
      ('NMA', 'aqua', 'Main Course 2', 6, 'Handmade Italian Plin Ravioli', 'Pumpkin, Amaretti, Aromatic Butter & Organic Crispy Sage'),
      ('NMA', 'aqua', 'Dessert', 7, 'Lemon and Ricotta', null),
      ('NMA', 'hutong', 'Soup', 8, 'Vegetable Clear Soup, Chrysanthemum Tofu', null),
      ('NMA', 'hutong', 'Appetiser', 9, 'Dim Sum Platter', 'Tea Smoked Spinach Tofu | Crystal Vegetable | Artichoke Lilybud'),
      ('NMA', 'hutong', 'Entrée', 10, 'Steamed Wild Mushroom Truffle Bao', null),
      ('NMA', 'hutong', 'Palate Cleanser', 11, 'White Watermelon Ginger Sorbet', null),
      ('NMA', 'hutong', 'Main Course 1', 12, 'Imperial Jade Roll', 'Roasted Pepper filled with water chestnut, Green Bamboo & Bamboo Shoot in black pepper sauce'),
      ('NMA', 'hutong', 'Main Course 2', 13, 'Lotus Garden', 'Lotus root, wok fried rice & chinese vegetable ratatouille in aromatic laoganma sauce'),
      ('NMA', 'hutong', 'Dessert', 14, 'Caramel & Sesame Bourbon', null),
      ('NMA', 'inddee', 'Soup', 15, 'Himalayan Winter', 'Sikkim-inspired momos with bamboo shoots, daikon, gundruk, ghost pepper achar and warm daikon dashi broth.'),
      ('NMA', 'inddee', 'Appetiser', 16, 'Parsi Love Affair', 'Delicate soy milk chawanmushi with raisins, macadamia nuts, smoked sugar snap peas'),
      ('NMA', 'inddee', 'Entrée', 17, 'Sweet Medicine', 'Charcoal-grilled asparagus with creamy fenugreek, Vasterbotten cheese and black truffle.'),
      ('NMA', 'inddee', 'Palate Cleanser', 18, 'Guava & Roselle Sorbet', null),
      ('NMA', 'inddee', 'Main Course 1', 19, 'Queen of Pickles', 'Charcoal-grilled French potatoes with kasundi beurre blanc'),
      ('NMA', 'inddee', 'Main Course 2', 20, 'Richness of Chettiars', 'Charcoal grilled maitake mushroom with aromatic Chettinad curry, smoked coconut, young coconut pickle and ghee rice.'),
      ('NMA', 'inddee', 'Dessert', 21, 'A Tale of Milk & Sugar', 'Falooda-inspired baked yogurt with rose, salted pistachio cream and basil seeds.'),
      ('NMA', 'brix', 'Dessert', 22, 'Blooming Flower (Sugar Free)', null),
      ('NMA', 'brix', 'Dessert', 23, 'Chocolate Lingot (Sugar Free)', null),
      ('NMA', 'brix', 'Dessert', 24, 'Rich Cheesecake (Sugar Free)', null),
      ('NMA', 'brix', 'Dessert', 25, 'Coconut Ice Cream (Sugar Free)', null),
      -- RMA: Mrs Radhika Merchant Ambani
      ('RMA', 'aqua', 'Soup', 1, 'Garden Consommé, Steamed Jerusalem Artichoke & Celeriac', null),
      ('RMA', 'aqua', 'Appetiser', 2, 'Orange and Shallot Tart, Edible Flowers, Parmesan 24 Month Fondue', null),
      ('RMA', 'aqua', 'Entrée', 3, 'Asparagus, Truffle, Parmentier Sauce & Fresh Salad Leaves', null),
      ('RMA', 'aqua', 'Palate Cleanser', 4, 'Fennel Granita', null),
      ('RMA', 'aqua', 'Main Course 1', 5, 'Homemade Gnocchi, Baby Zucchini & Mint Sauce', null),
      ('RMA', 'aqua', 'Main Course 2', 6, 'Handmade Italian Plin Ravioli', 'Pumpkin, Amaretti, Aromatic Butter & Organic Crispy Sage'),
      ('RMA', 'aqua', 'Dessert', 7, 'Lemon and Ricotta', null),
      ('RMA', 'hutong', 'Soup', 8, 'Vegetable Clear Soup, Chrysanthemum Tofu', null),
      ('RMA', 'hutong', 'Appetiser', 9, 'Dim Sum Platter', 'Tea Smoked Spinach Tofu | Crystal Vegetable | Artichoke Lilybud'),
      ('RMA', 'hutong', 'Entrée', 10, 'Steamed Wild Mushroom Truffle Bao', null),
      ('RMA', 'hutong', 'Palate Cleanser', 11, 'White Watermelon Ginger Sorbet', null),
      ('RMA', 'hutong', 'Main Course 1', 12, 'Imperial Jade Roll', 'Roasted Pepper filled with water chestnut, Green Bamboo & Bamboo Shoot'),
      ('RMA', 'hutong', 'Main Course 2', 13, 'Lotus Garden', 'Lotus root, wok fried rice & chinese vegetable ratatouille in aromatic laoganma sauce'),
      ('RMA', 'hutong', 'Dessert', 14, 'Caramel & Sesame Bourbon', null),
      ('RMA', 'inddee', 'Soup', 15, 'Himalayan Winter', 'Sikkim-inspired momos with bamboo shoots, daikon, gundruk, ghost pepper achar and warm daikon dashi broth.'),
      ('RMA', 'inddee', 'Appetiser', 16, 'Parsi Love Affair', 'Delicate soy milk chawanmushi with raisins, macadamia nuts, smoked sugar snap peas and slow-roasted tomato jus.'),
      ('RMA', 'inddee', 'Entrée', 17, 'Sweet Medicine', 'Charcoal-grilled asparagus with creamy fenugreek, Vasterbotten cheese and black truffle.'),
      ('RMA', 'inddee', 'Palate Cleanser', 18, 'Guava & Roselle Sorbet', null),
      ('RMA', 'inddee', 'Main Course 1', 19, 'Queen of Pickles', 'Charcoal-grilled French potatoes with kasundi beurre blanc, Gondhoraj lime foam and toasted almonds.'),
      ('RMA', 'inddee', 'Main Course 2', 20, 'Richness of Chettiars', 'Charcoal grilled maitake mushroom with aromatic Chettinad curry, smoked coconut, young coconut pickle and ghee rice.'),
      ('RMA', 'inddee', 'Dessert', 21, 'A Tale of Milk & Sugar', 'Falooda-inspired baked yogurt with rose, salted pistachio cream and basil seeds.'),
      ('RMA', 'brix', 'Dessert', 22, 'Blooming Flower (Sugar Free)', null),
      ('RMA', 'brix', 'Dessert', 23, 'Chocolate Lingot (Sugar Free)', null),
      ('RMA', 'brix', 'Dessert', 24, 'Rich Cheesecake, Citrusy Lemon Sponge (Sugar Free)', null),
      -- SMA: Mrs Shloka Mehta Ambani
      ('SMA', 'aqua', 'Soup', 1, 'Garden Consommé, Steamed Jerusalem Artichoke & Celeriac', null),
      ('SMA', 'aqua', 'Appetiser', 2, 'Orange and Shallot Tart, Edible Flowers, Parmesan 24 Month Fondue', null),
      ('SMA', 'aqua', 'Entrée', 3, 'Asparagus, Truffle, Parmentier Sauce & Fresh Salad Leaves', null),
      ('SMA', 'aqua', 'Palate Cleanser', 4, 'Fennel Granita', null),
      ('SMA', 'aqua', 'Main Course 1', 5, 'Homemade Gnocchi, Baby Zucchini & Mint Sauce', null),
      ('SMA', 'aqua', 'Main Course 2', 6, 'Handmade Italian Plin Ravioli', 'Pumpkin, Amaretti, Aromatic Butter & Organic Crispy Sage'),
      ('SMA', 'aqua', 'Dessert', 7, 'Lemon and Ricotta', null),
      ('SMA', 'hutong', 'Soup', 8, 'Vegetable Clear Soup, Chrysanthemum Tofu', null),
      ('SMA', 'hutong', 'Appetiser', 9, 'Dim Sum Platter', 'Tea Smoked Spinach Tofu | Crystal Vegetable | Artichoke Lilybud'),
      ('SMA', 'hutong', 'Entrée', 10, 'Steamed Wild Mushroom Truffle Bao', null),
      ('SMA', 'hutong', 'Palate Cleanser', 11, 'White Watermelon Ginger Sorbet', null),
      ('SMA', 'hutong', 'Main Course 1', 12, 'Imperial Jade Roll', 'Roasted Pepper filled with water chestnut, Green Bamboo & Bamboo Shoot in black pepper sauce'),
      ('SMA', 'hutong', 'Main Course 2', 13, 'Lotus Garden', 'Lotus root, wok fried rice & chinese vegetable ratatouille in aromatic laoganma sauce'),
      ('SMA', 'hutong', 'Dessert', 14, 'Caramel & Sesame Bourbon', null),
      ('SMA', 'inddee', 'Soup', 15, 'Himalayan Winter', 'Sikkim-inspired momos with bamboo shoots, daikon, gundruk, ghost pepper achar and warm daikon dashi broth.'),
      ('SMA', 'inddee', 'Appetiser', 16, 'Parsi Love Affair', 'Delicate soy milk chawanmushi with raisins, macadamia nuts, smoked sugar snap peas and slow-roasted tomato jus.'),
      ('SMA', 'inddee', 'Entrée', 17, 'Sweet Medicine', 'Charcoal-grilled asparagus with creamy fenugreek, Vasterbotten cheese and black truffle.'),
      ('SMA', 'inddee', 'Palate Cleanser', 18, 'Guava & Roselle Sorbet', null),
      ('SMA', 'inddee', 'Main Course 1', 19, 'Queen of Pickles', 'Charcoal-grilled French potatoes with kasundi beurre blanc, Gondhoraj lime foam and toasted almonds.'),
      ('SMA', 'inddee', 'Main Course 2', 20, 'Richness of Chettiars', 'Charcoal grilled maitake mushroom with aromatic Chettinad curry, smoked coconut, young coconut pickle and ghee rice.'),
      ('SMA', 'inddee', 'Dessert', 21, 'A Tale of Milk & Sugar', 'Falooda-inspired baked yogurt with rose, salted pistachio cream and basil seeds.'),
      ('SMA', 'brix', 'Dessert', 22, 'Chocolate Lingot (Sugar Free)', null),
      ('SMA', 'brix', 'Dessert', 23, 'Pineapple Cake (Sugar Free)', null),
      -- ANANT: Mr Anant Ambani
      ('ANANT', 'aqua', 'Soup', 1, 'Garden Consommé, Steamed Jerusalem Artichoke & Celeriac', null),
      ('ANANT', 'aqua', 'Appetiser', 2, 'Orange and Shallot Tart, Edible Flowers, Parmesan 24 Month Fondue', null),
      ('ANANT', 'aqua', 'Entrée', 3, 'Asparagus, Truffle, Parmentier Sauce & Fresh Salad Leaves', null),
      ('ANANT', 'aqua', 'Palate Cleanser', 4, 'Fennel Granita', null),
      ('ANANT', 'aqua', 'Main Course 1', 5, 'Homemade Gnocchi, Baby Zucchini & Mint Sauce', null),
      ('ANANT', 'aqua', 'Main Course 2', 6, 'Handmade Italian Plin Ravioli', 'Pumpkin, Amaretti, Aromatic Butter & Organic Crispy Sage'),
      ('ANANT', 'aqua', 'Dessert', 7, 'Lemon and Ricotta', null),
      ('ANANT', 'hutong', 'Soup', 8, 'The Floating Chrysanthemum', null),
      ('ANANT', 'hutong', 'Appetiser', 9, 'Dim Sum Platter', 'Tea Smoked Spinach Tofu | Crystal Vegetable | Artichoke Lilybud'),
      ('ANANT', 'hutong', 'Entrée', 10, 'Bok Choy with Mix Veggies', null),
      ('ANANT', 'hutong', 'Palate Cleanser', 11, 'White Watermelon Ginger Sorbet', null),
      ('ANANT', 'hutong', 'Main Course 1', 12, 'Imperial Jade Roll', 'Roasted Pepper filled with Green Bamboo & Bamboo Shoot in black pepper sauce'),
      ('ANANT', 'hutong', 'Main Course 2', 13, 'Lotus Garden', 'Lotus root, wok fried rice & chinese vegetable ratatouille in aromatic laoganma sauce'),
      ('ANANT', 'hutong', 'Dessert', 14, 'Caramel & Sesame Bourbon', null),
      ('ANANT', 'inddee', 'Soup', 15, 'Himalayan Winter', 'Sikkim-inspired momos with bamboo shoots, daikon, gundruk, ghost pepper achar and warm daikon dashi broth.'),
      ('ANANT', 'inddee', 'Appetiser', 16, 'Parsi Love Affair', 'Delicate soy milk chawanmushi with raisins, macadamia nuts, smoked sugar snap peas and slow-roasted tomato jus.'),
      ('ANANT', 'inddee', 'Entrée', 17, 'Sweet Medicine', 'Charcoal-grilled asparagus with creamy fenugreek, Vasterbotten cheese and black truffle.'),
      ('ANANT', 'inddee', 'Palate Cleanser', 18, 'Guava & Roselle Sorbet', null),
      ('ANANT', 'inddee', 'Main Course 1', 19, 'Queen of Pickles', 'Charcoal-grilled French potatoes with kasundi beurre blanc, Gondhoraj lime foam and toasted almonds.'),
      ('ANANT', 'inddee', 'Main Course 2', 20, 'Richness of Chettiars', 'Charcoal grilled maitake mushroom with aromatic Chettinad curry, smoked coconut, young coconut pickle and ghee rice.'),
      ('ANANT', 'inddee', 'Dessert', 21, 'A Tale of Milk & Sugar', 'Falooda-inspired baked yogurt with rose, salted pistachio cream and basil seeds.'),
      ('ANANT', 'brix', 'Dessert', 22, 'Blooming Flower (Sugar Free)', null),
      ('ANANT', 'brix', 'Dessert', 23, 'Chocolate Lingot (Sugar Free)', null),
      ('ANANT', 'brix', 'Dessert', 24, 'Rich Cheesecake, Citrusy Lemon Sponge (Sugar Free)', null),
      -- AKASH: Mr Akash Ambani
      ('AKASH', 'aqua', 'Soup', 1, 'Garden Consommé, Steamed Jerusalem Artichoke & Celeriac', null),
      ('AKASH', 'aqua', 'Appetiser', 2, 'Orange and Shallot Tart, Edible Flowers, Parmesan 24 Month Fondue', null),
      ('AKASH', 'aqua', 'Entrée', 3, 'Asparagus, Truffle, Parmentier Sauce & Fresh Salad Leaves', null),
      ('AKASH', 'aqua', 'Palate Cleanser', 4, 'Fennel Granita', null),
      ('AKASH', 'aqua', 'Main Course 1', 5, 'Homemade Gnocchi, Baby Zucchini & Mint Sauce', null),
      ('AKASH', 'aqua', 'Main Course 2', 6, 'Handmade Italian Plin Ravioli', 'Pumpkin, Amaretti, Aromatic Butter & Organic Crispy Sage'),
      ('AKASH', 'aqua', 'Dessert', 7, 'Lemon and Ricotta', null),
      ('AKASH', 'hutong', 'Soup', 8, 'Vegetable Clear Soup, Chrysanthemum Tofu', null),
      ('AKASH', 'hutong', 'Appetiser', 9, 'Dim Sum Platter', 'Tea Smoked Spinach Tofu | Crystal Vegetable | Artichoke Lilybud'),
      ('AKASH', 'hutong', 'Entrée', 10, 'Steamed Wild Mushroom Truffle Bao', null),
      ('AKASH', 'hutong', 'Palate Cleanser', 11, 'White Watermelon Ginger Sorbet', null),
      ('AKASH', 'hutong', 'Main Course 1', 12, 'Imperial Jade Roll', 'Roasted Pepper filled with water chestnut, Green Bamboo & Bamboo Shoot in black pepper sauce'),
      ('AKASH', 'hutong', 'Main Course 2', 13, 'Lotus Garden', 'Lotus root, wok fried rice & chinese vegetable ratatouille in aromatic laoganma sauce'),
      ('AKASH', 'hutong', 'Dessert', 14, 'Caramel & Sesame Bourbon', null),
      ('AKASH', 'inddee', 'Soup', 15, 'Himalayan Winter', 'Sikkim-inspired momos with bamboo shoots, daikon, gundruk, ghost pepper achar and warm daikon dashi broth.'),
      ('AKASH', 'inddee', 'Appetiser', 16, 'Parsi Love Affair', 'Delicate soy milk chawanmushi with raisins, macadamia nuts, smoked sugar snap peas and slow-roasted tomato jus.'),
      ('AKASH', 'inddee', 'Entrée', 17, 'Sweet Medicine', 'Charcoal-grilled asparagus with creamy fenugreek, Vasterbotten cheese and black truffle.'),
      ('AKASH', 'inddee', 'Palate Cleanser', 18, 'Guava & Roselle Sorbet', null),
      ('AKASH', 'inddee', 'Main Course 1', 19, 'Queen of Pickles', 'Charcoal-grilled French potatoes with kasundi beurre blanc, Gondhoraj lime foam and toasted almonds.'),
      ('AKASH', 'inddee', 'Main Course 2', 20, 'Richness of Chettiars', 'Charcoal grilled maitake mushroom with aromatic Chettinad curry, smoked coconut, young coconut pickle and ghee rice.'),
      ('AKASH', 'inddee', 'Dessert', 21, 'A Tale of Milk & Sugar', 'Falooda-inspired baked yogurt with rose, salted pistachio cream and basil seeds.'),
      ('AKASH', 'brix', 'Dessert', 22, 'Blooming Flower (Sugar Free)', null),
      ('AKASH', 'brix', 'Dessert', 23, 'Chocolate Lingot (Sugar Free)', null),
      ('AKASH', 'brix', 'Dessert', 24, 'Rich Cheesecake, Citrusy Lemon Sponge (Sugar Free)', null)
    ) as b(who, cz, course, ord, title, descr)
    order by who, ord loop
      -- the cuisine: its kitchen and its menu category (kitchen and cuisine have the same name)
      v_k := null; v_cat := null;
      select id into v_k from kitchens
       where event_id = e.id
         and name ilike case r.cz when 'aqua' then 'aqua%' when 'hutong' then 'hutong%' when 'inddee' then 'inddee%' else '%brix%' end
       order by is_active desc, created_at limit 1;
      if v_k is null and r.cz = 'brix' then
        select id into v_k from kitchens where event_id = e.id and name ilike 'dessert%' order by is_active desc, created_at limit 1;
      end if;
      if v_k is not null then
        select id into v_cat from menu_categories where event_id = e.id and kitchen_id = v_k
         order by coalesce(is_visible, true) desc, sort_order, created_at limit 1;
      end if;
      if v_cat is null then
        select id into v_cat from menu_categories
         where event_id = e.id
           and name ilike case r.cz when 'aqua' then 'aqua%' when 'hutong' then 'hutong%' when 'inddee' then 'inddee%' else '%brix%' end
         order by coalesce(is_visible, true) desc, sort_order, created_at limit 1;
      end if;
      if v_cat is null then
        raise exception 'Event "%": no % cuisine on the menu. Nothing changed.', e.name, r.cz;
      end if;

      -- the course as the event spells it
      v_course := null;
      select c into v_course from unnest(coalesce(e.courses, '{}'::text[])) as c
       where ss_v9_ckey(c) = ss_v9_ckey(r.course) limit 1;
      v_course := coalesce(v_course, r.course);

      -- the dish already on the menu (same cuisine), by its name
      v_nt  := ss_v9_norm(r.title);
      v_ntd := ss_v9_norm(r.title || ' ' || coalesce(r.descr, ''));
      v_dish := null; v_dname := null; v_ddesc := null;
      select m.id, m.name, m.description into v_dish, v_dname, v_ddesc
        from menu_items m join menu_categories c on c.id = m.category_id
       where c.event_id = e.id and coalesce(c.is_visible, true)
         and (c.id = v_cat or (v_k is not null and c.kitchen_id = v_k))
         and coalesce(m.name, '') <> ''
         and (r.title ilike '%sugar free%') = (m.name ilike '%sugar free%')   -- a sugar-free dessert is its own dish
         and (ss_v9_norm(m.name) in (v_nt, v_ntd)
              or (length(ss_v9_norm(m.name)) >= 10 and v_nt like ss_v9_norm(m.name) || '%')
              or (length(v_nt) >= 8 and ss_v9_norm(m.name) like v_nt || '%'))
       order by (ss_v9_norm(m.name) = v_nt) desc, m.vip_only, coalesce(m.is_available, true) desc,
                (m.course = v_course) desc, m.sort_order nulls last, m.created_at
       limit 1;

      -- not on the menu: added in the same cuisine as a "VIP guests only" dish, routed like
      -- the cuisine's other dish of that course (same kitchen, same barker)
      if v_dish is null then
        v_tpl := null;
        select m.* into v_tpl
          from menu_items m join menu_categories c on c.id = m.category_id
         where c.event_id = e.id and coalesce(c.is_visible, true)
           and (c.id = v_cat or (v_k is not null and c.kitchen_id = v_k))
           and m.course = v_course and not m.vip_only
         order by coalesce(m.is_available, true) desc, m.sort_order nulls last, m.created_at
         limit 1;
        insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker, kitchen_id, vip_only)
        values (coalesce(v_tpl.category_id, v_cat), r.title, r.descr, coalesce(v_tpl.is_veg, true), true,
                coalesce(v_tpl.sort_order, 0) + 1, v_course, coalesce(v_tpl.barker, 'A'), v_tpl.kitchen_id, true)
        returning id, name, description into v_dish, v_dname, v_ddesc;
        insert into ss_v9_backup (kind, id, data) values ('v9_dish', v_dish, jsonb_build_object('event', e.id, 'name', r.title))
        on conflict do nothing;
        v_made := v_made + 1;
      else
        -- a family dish v9 added before and the undo hid: back on the menu
        update menu_items set is_available = true
         where id = v_dish and not coalesce(is_available, true)
           and exists (select 1 from ss_v9_backup where kind = 'v9_dish' and id = v_dish);
      end if;

      -- how the dish reads on this guest's menu, where their booklet says it differently
      v_desc := null;
      if r.descr is not null and ss_v9_norm(r.descr) <> ss_v9_norm(v_ddesc) then
        v_desc := r.descr;
      elsif r.descr is null and v_nt <> ss_v9_norm(v_dname) and v_nt <> ss_v9_norm(v_ddesc)
            and v_nt <> ss_v9_norm(v_dname || ' ' || coalesce(v_ddesc, '')) then
        v_desc := r.title;
      end if;

      v_entry := jsonb_build_object('menu_item_id', v_dish);
      if v_desc is not null then v_entry := v_entry || jsonb_build_object('desc', v_desc); end if;
      if not coalesce(v_menus -> r.who, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('menu_item_id', v_dish)) then
        v_menus := jsonb_set(v_menus, array[r.who], coalesce(v_menus -> r.who, '[]'::jsonb) || jsonb_build_array(v_entry));
      end if;
    end loop;

    -- ---- The five VIP guests: each with their menu -------------------------
    foreach v_who in array array['NMA', 'RMA', 'SMA', 'ANANT', 'AKASH'] loop
      g := null;
      select * into g from ms_vip_guests x
       where x.event_id = e.id
         and (upper(btrim(coalesce(x.label, ''))) = v_who
              or case v_who when 'NMA'   then x.name ilike '%nita%'
                            when 'RMA'   then x.name ilike '%radhika%'
                            when 'SMA'   then x.name ilike '%shloka%' or x.name ilike '%sholka%'
                            when 'ANANT' then x.name ilike '%anant%'
                            else x.name ilike '%akash%' end)
       order by x.is_active desc, x.created_at
       limit 1;
      if g.id is null then
        insert into ms_vip_guests (event_id, name, label, sort_order, dishes)
        values (e.id,
                case v_who when 'NMA' then 'Mrs Nita Ambani' when 'RMA' then 'Mrs Radhika Merchant Ambani'
                           when 'SMA' then 'Mrs Shloka Mehta Ambani' when 'ANANT' then 'Mr Anant Ambani' else 'Mr Akash Ambani' end,
                null, array_position(array['NMA', 'RMA', 'SMA', 'ANANT', 'AKASH'], v_who), '[]'::jsonb)
        returning * into g;
      end if;
      -- their menu, in booklet order; a note, allergy or description already set for one of
      -- these dishes (Event set-up › VIP guests) is kept
      select coalesce(jsonb_agg(n.x || coalesce((select jsonb_strip_nulls(o) - 'menu_item_id'
                                                   from jsonb_array_elements(coalesce(g.dishes, '[]'::jsonb)) o
                                                  where o ->> 'menu_item_id' = n.x ->> 'menu_item_id' limit 1), '{}'::jsonb)
                                order by n.i), '[]'::jsonb)
        into v_entry
        from jsonb_array_elements(coalesce(v_menus -> v_who, '[]'::jsonb)) with ordinality as n(x, i);
      update ms_vip_guests
         set dishes = v_entry, is_active = true,
             label = case when v_who in ('NMA', 'RMA', 'SMA') then v_who
                          else coalesce(nullif(btrim(coalesce(label, '')), ''), 'Host family') end
       where id = g.id;
    end loop;

    raise notice 'Event "%": Gujarati Thali one dish (INDDEE Indian), 5 family menus, % dishes added for the family', e.name, v_made;
  end loop;

  if v_n = 0 then
    raise exception 'No Maestro event with an INDDEE kitchen dated 14-17 Oct was found. Nothing changed.';
  end if;
end $$;

drop function if exists ss_v9_norm(text);
drop function if exists ss_v9_ckey(text);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Check 1: dishes added for the family ("VIP guests only") and Gujarati Thali
select e.name as event, c.name as cuisine, m.course, m.name as dish,
       case when m.vip_only then 'VIP guests only' else 'every guest' end as for_whom,
       coalesce(k.name, '(cuisine''s kitchen)') as kot_goes_to, m.is_available as on_menu
  from ss_v9_backup b
  join menu_items m on m.id = b.id
  join menu_categories c on c.id = m.category_id
  join events e on e.id = c.event_id
  left join kitchens k on k.id = m.kitchen_id
 where b.kind = 'v9_dish'
 order by e.date, e.name, c.name, m.course, m.name;

-- Check 2: kitchens (Gujarati Thali off)
select e.name as event, k.name as kitchen, k.is_active as on, k.barkers
  from kitchens k join events e on e.id = k.event_id
 where e.id in (select id from ss_v9_backup where kind = 'event')
 order by e.date, e.name, k.is_active desc, k.sort_order;

-- Check 3 (the result the SQL Editor shows): the family, each with their menu in booklet
-- order (23 to 25 dishes each), and seating a VIP adds nothing to the order
select e.name as event, g.label, g.name as guest, coalesce(g.allergies, '-') as allergies,
       jsonb_array_length(g.dishes) as dishes_on_their_menu,
       position('insert into ms_items' in pg_get_functiondef('ms_vip_apply(uuid,int,int,uuid,uuid)'::regprocedure)) = 0 as seating_adds_no_dishes,
       (select string_agg(m.name, ' | ' order by x.i)
          from jsonb_array_elements(g.dishes) with ordinality as x(d, i)
          join menu_items m on m.id = (x.d ->> 'menu_item_id')::uuid) as their_menu
  from ms_vip_guests g join events e on e.id = g.event_id
 where g.is_active and e.id in (select id from ss_v9_backup where kind = 'event')
 order by e.date, e.name, g.sort_order, g.name;

-- Demo · Smart Serve Maestro: three VIP guests (fictional) and the v2 settings
-- (kitchen alert after 3 minutes, delivered dishes leave the captain's order after 3 minutes).
-- Run after 2026-10-13_maestro_v2.sql. Safe to run again: replaces the demo VIP list.
-- Preferred dishes are looked up by name in the demo menu; a name not on the menu is skipped.

update events set late_minutes = 3, served_hide_minutes = 3
 where id = '00000000-0000-4000-8000-0000000de304';

delete from ms_vip_guests where event_id = '00000000-0000-4000-8000-0000000de304';

with ev as (select id from events where id = '00000000-0000-4000-8000-0000000de304'),
dish as (
  select m.id, m.name from menu_items m join menu_categories c on c.id = m.category_id, ev
   where c.event_id = ev.id
),
pick(guest, ord, dish_name, note) as (values
  ('Mr. Vikram Sethi', 1, 'Tamatar Dhaniya Shorba', 'Very hot'),
  ('Mr. Vikram Sethi', 2, 'Margherita Pizza', 'Thin crust, extra basil'),
  ('Mr. Vikram Sethi', 3, 'Spaghetti Arrabiata', 'Mild'),
  ('Mr. Vikram Sethi', 4, 'Tiramisu', null),
  ('Mrs. Anjali Sethi', 1, 'Cream of Asparagus Soup (Jain)', null),
  ('Mrs. Anjali Sethi', 2, 'Giardino Pizza (Jain)', null),
  ('Mrs. Anjali Sethi', 3, 'Kesar Pista Kulfi', null),
  ('Ms. Tara Sethi', 1, 'Siamese Noodle Soup', 'Gluten-free noodles'),
  ('Ms. Tara Sethi', 2, 'Grilled Tofu', null),
  ('Ms. Tara Sethi', 3, 'Mango Sticky Rice', null)
),
dishes as (
  select p.guest, jsonb_agg(jsonb_build_object('menu_item_id', d.id, 'note', p.note) order by p.ord) as list
    from pick p join dish d on d.name = p.dish_name
   group by p.guest
),
guests(sort_order, name, label, table_number, cover_no, allergies, likes, dislikes, notes) as (values
  (1, 'Mr. Vikram Sethi', 'VVIP', null::int, null::int, 'Shellfish', 'Mild Italian, thin-crust pizza', 'Mushroom', 'Less spicy'),
  (2, 'Mrs. Anjali Sethi', 'VVIP', 2, 4, 'Peanuts', 'Jain food', 'Onion, garlic', 'Jain preparation'),
  (3, 'Ms. Tara Sethi', 'VIP', null::int, null::int, 'Gluten', 'Oriental', 'Coriander', 'No ajinomoto')
)
insert into ms_vip_guests (event_id, name, label, table_number, cover_no, allergies, likes, dislikes, notes, dishes, sort_order)
select ev.id, g.name, g.label, g.table_number, g.cover_no, g.allergies, g.likes, g.dislikes, g.notes,
       coalesce(d.list, '[]'::jsonb), g.sort_order
  from guests g cross join ev left join dishes d on d.guest = g.name;

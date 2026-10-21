-- =====================================================================
-- Barker A / Barker B by course, in the two-barker kitchens (Aqua Italian,
-- Hutong Oriental, INDDEE Indian), Dry Run 2 and the main event:
--   Barker A: Soup, Appetiser, Entrée, Palate Cleanser
--   Barker B: Main Course 1, Main Course 2, Dessert
-- One-barker kitchens (Amuse Bouche, Desserts by Brix, Hot & Cold Beverages
-- incl. Tea & Coffee): everything to Barker A. Any other course: Barker A.
-- Safe to run twice. KOTs already printed are not changed.
-- =====================================================================
update menu_items m
   set barker = case
         when coalesce(k.barkers, 2) < 2 then 'A'
         when lower(coalesce(m.course, '')) ~ '^(main|dessert)' then 'B'
         else 'A' end
  from menu_categories c
  join events e on e.id = c.event_id
  join kitchens k on k.id = c.kitchen_id
 where c.id = m.category_id
   and m.kitchen_id is null
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%');

-- a dish sent to a kitchen of its own (not its cuisine's): the same rule with that kitchen
update menu_items m
   set barker = case
         when coalesce(k.barkers, 2) < 2 then 'A'
         when lower(coalesce(m.course, '')) ~ '^(main|dessert)' then 'B'
         else 'A' end
  from kitchens k
  join events e on e.id = k.event_id
 where k.id = m.kitchen_id
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%');

-- Check (the result the SQL Editor shows): per kitchen, which courses go to A and B
select e.name as event, k.name as kitchen, m.barker,
       string_agg(distinct m.course, ', ') as courses, count(*) as dishes
  from menu_items m
  join menu_categories c on c.id = m.category_id
  join kitchens k on k.id = coalesce(m.kitchen_id, c.kitchen_id)
  join events e on e.id = c.event_id
 where k.is_active and coalesce(c.is_visible, true) and coalesce(m.is_available, true)
   and e.maestro and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
 group by e.name, k.name, k.sort_order, m.barker
 order by e.name, k.sort_order, m.barker;

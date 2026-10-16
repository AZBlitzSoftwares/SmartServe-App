-- =====================================================================
-- Gujarati Thali is served by hand: off the captain's menu, so no KOT
-- prints for it anywhere (not at INDDEE Indian, not at any kitchen).
-- Dry Run 2 and the main event. Run in the Supabase SQL Editor after v9.
-- Safe to run twice. Nothing is deleted: the dish moves into the hidden
-- Gujarati Thali cuisine and is switched off.
-- To show it again: Menu › Gujarati Thali › switch it on (and move it to a
-- visible cuisine).
-- =====================================================================
update menu_items m
   set category_id = coalesce((select g.id from menu_categories g
                                where g.event_id = c.event_id and g.name ilike 'gujarati%'
                                order by g.created_at limit 1), m.category_id),
       is_available = false
  from menu_categories c join events e on e.id = c.event_id
 where c.id = m.category_id
   and m.name = 'Gujarati Thali'
   and e.maestro and e.date between '2026-10-14' and '2026-10-17' and e.name not ilike '%dry run 1%';

-- the Gujarati Thali cuisine stays hidden
update menu_categories c set is_visible = false
  from events e
 where e.id = c.event_id and c.name ilike 'gujarati%'
   and e.maestro and e.date between '2026-10-14' and '2026-10-17' and e.name not ilike '%dry run 1%';

notify pgrst, 'reload schema';

-- Check: every row should say on_captains_menu = false
select e.name as event, m.name as dish, c.name as cuisine,
       (coalesce(c.is_visible, true) and coalesce(m.is_available, true)) as on_captains_menu
  from menu_items m join menu_categories c on c.id = m.category_id join events e on e.id = c.event_id
 where m.name = 'Gujarati Thali'
   and e.maestro and e.date between '2026-10-14' and '2026-10-17' and e.name not ilike '%dry run 1%'
 order by e.date, e.name;

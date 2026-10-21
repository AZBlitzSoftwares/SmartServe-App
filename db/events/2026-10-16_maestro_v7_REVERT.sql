-- =====================================================================
-- Undo the printing part of 2026-10-16_maestro_v7_barker_printers.sql.
-- Puts hub_claim_kots, hub_printer_status and kots_virtual_print back exactly
-- as they were before v7 ran (the copy v7 saved in ss_fn_backup). Every KOT then
-- prints on the kitchen printer again (A and B together), as before.
-- The new kitchen columns stay (unused). Run in the Supabase SQL Editor.
-- =====================================================================
do $$
declare r record; n int := 0;
begin
  for r in select fn, def from ss_fn_backup where tag = 'before_v7' loop
    execute r.def;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No backup found: v7 was not run on this database, nothing to undo.'; end if;
  raise notice 'Restored % functions', n;
end $$;

notify pgrst, 'reload schema';

-- Amuse Bouche is left as it is. To switch it off again, remove the two dashes
-- at the start of the next lines and run them:
-- update kitchens set is_active = false
--  where name = 'Amuse Bouche' and event_id in (select id from events where maestro and date in ('2026-10-15', '2026-10-16'));
-- update menu_items set is_available = false
--  where name = 'Amuse Bouche' and category_id in (select c.id from menu_categories c join events e on e.id = c.event_id
--                                                 where e.maestro and e.date in ('2026-10-15', '2026-10-16'));

select fn, saved_at from ss_fn_backup where tag = 'before_v7';

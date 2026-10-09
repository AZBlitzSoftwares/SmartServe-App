-- Smart Serve Maestro: two table captains can share a table and split its covers.
--   captains.cover_from / cover_to: the covers this captain looks after, e.g. Neha C1-C5 and
--   Arjun C6-C10 at table 7. Both empty: every cover of the table (as before).
-- Set in Event set-up > Captains. The captain's tablet opens on their own covers; the other
-- covers stay one tap away, so a captain can take an order or fire for a colleague who is away.
-- Nothing else changes: any captain of the table may still act on any cover.
-- Safe to run more than once. Supabase > SQL Editor > paste > Run.
alter table captains add column if not exists cover_from int;
alter table captains add column if not exists cover_to   int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'captains_cover_range_chk') then
    alter table captains add constraint captains_cover_range_chk
      check ((cover_from is null or cover_from >= 1) and (cover_to is null or cover_to >= 1)
             and (cover_from is null or cover_to is null or cover_from <= cover_to));
  end if;
end $$;

notify pgrst, 'reload schema';

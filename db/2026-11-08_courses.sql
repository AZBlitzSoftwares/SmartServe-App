-- =====================================================================
-- Courses for guest and captain events (Control › Courses & categories)
--
-- The course of a dish lives on the dish (menu_items.course); the order of
-- the courses on the event (events.courses). A course's printer is kept on
-- the printer (kitchens.courses) and its KOT code in kot_series.codes, both
-- by name. Renaming or removing a course therefore touches four places:
-- these functions do it in one step, so nothing is left behind under the
-- old name.
--
--   ss_course_rename(event, old, new)  -> {"dishes": n}
--   ss_course_remove(event, name)      -> {"dishes": n}   dishes keep their
--                                          category, the course is cleared
--   ss_kot_code_move(event, old, new)  -> codes            a KOT code follows
--                                          a renamed category or course
--
-- A category (counter) can belong to a course too (menu_categories.course):
-- its dishes take that course, and a dish added to it later starts with it.
-- A mixed counter (dishes from two courses) keeps a course per dish.
--
-- Run once in the Supabase SQL Editor. Safe to run again.
-- The Offline Kit applies it on the laptop at Prepare Event.
-- =====================================================================

alter table menu_categories add column if not exists course text;

create or replace function ss_kot_code_move(p_event uuid, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old   text := lower(btrim(coalesce(p_old, '')));
  v_new   text := lower(btrim(coalesce(p_new, '')));
  v_codes jsonb;
begin
  if v_old = '' or v_new = '' or v_old = v_new then
    select codes into v_codes from kot_series where event_id = p_event;
    return coalesce(v_codes, '{}'::jsonb);
  end if;
  select codes into v_codes from kot_series where event_id = p_event for update;
  if v_codes is not null and v_codes ? v_old then
    update kot_series
       set codes = (codes - v_old - v_new) || jsonb_build_object(v_new, v_codes ->> v_old), updated_at = now()
     where event_id = p_event
     returning codes into v_codes;
  end if;
  return coalesce(v_codes, '{}'::jsonb);
end $$;

create or replace function ss_course_rename(p_event uuid, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old    text := btrim(coalesce(p_old, ''));
  v_new    text := btrim(regexp_replace(coalesce(p_new, ''), '\s+', ' ', 'g'));
  v_dishes int  := 0;
begin
  if v_old = '' or v_new = '' then raise exception 'BAD_NAME: a course needs a name'; end if;
  if lower(v_old) <> lower(v_new) and (
       exists (select 1 from events e, unnest(e.courses) c where e.id = p_event and lower(btrim(c)) = lower(v_new))
    or exists (select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
                where mc.event_id = p_event and lower(btrim(mi.course)) = lower(v_new))) then
    raise exception 'NAME_TAKEN: % is already a course', v_new;
  end if;

  -- the event's course order: the same place, the new name
  update events e
     set courses = (select coalesce(array_agg(case when lower(btrim(c)) = lower(v_old) then v_new else c end order by o), '{}'::text[])
                      from unnest(e.courses) with ordinality t(c, o))
   where e.id = p_event;

  -- the dishes
  update menu_items mi set course = v_new
    from menu_categories mc
   where mc.id = mi.category_id and mc.event_id = p_event and lower(btrim(mi.course)) = lower(v_old);
  get diagnostics v_dishes = row_count;

  -- the counters that belong to it
  update menu_categories set course = v_new
   where event_id = p_event and lower(btrim(course)) = lower(v_old);

  -- the printer the course prints on
  update kitchens k
     set courses = (select array_agg(case when lower(btrim(x)) = lower(v_old) then v_new else x end order by o)
                      from unnest(k.courses) with ordinality t(x, o))
   where k.event_id = p_event and k.courses is not null
     and exists (select 1 from unnest(k.courses) x where lower(btrim(x)) = lower(v_old));

  -- its KOT code (IN-041 stays IN-042 after the rename)
  perform ss_kot_code_move(p_event, v_old, v_new);

  return jsonb_build_object('dishes', v_dishes);
end $$;

create or replace function ss_course_remove(p_event uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_dishes int  := 0;
begin
  if v_name = '' then return jsonb_build_object('dishes', 0); end if;

  update events e
     set courses = (select coalesce(array_agg(c order by o), '{}'::text[])
                      from unnest(e.courses) with ordinality t(c, o) where lower(btrim(c)) <> lower(v_name))
   where e.id = p_event;

  -- dishes keep their category (counter); with One KOT per course they print by category again
  update menu_items mi set course = null
    from menu_categories mc
   where mc.id = mi.category_id and mc.event_id = p_event and lower(btrim(mi.course)) = lower(v_name);
  get diagnostics v_dishes = row_count;

  update menu_categories set course = null
   where event_id = p_event and lower(btrim(course)) = lower(v_name);

  update kitchens k
     set courses = nullif((select coalesce(array_agg(x order by o), '{}'::text[])
                             from unnest(k.courses) with ordinality t(x, o) where lower(btrim(x)) <> lower(v_name)), '{}'::text[])
   where k.event_id = p_event and k.courses is not null
     and exists (select 1 from unnest(k.courses) x where lower(btrim(x)) = lower(v_name));

  -- its KOT code is free again
  update kot_series set codes = codes - lower(v_name), updated_at = now()
   where event_id = p_event and codes ? lower(v_name);

  return jsonb_build_object('dishes', v_dishes);
end $$;

grant execute on function ss_kot_code_move(uuid, text, text) to anon, authenticated;
grant execute on function ss_course_rename(uuid, text, text) to anon, authenticated;
grant execute on function ss_course_remove(uuid, text)       to anon, authenticated;

notify pgrst, 'reload schema';

select 'Courses' as update, 'OK' as result;

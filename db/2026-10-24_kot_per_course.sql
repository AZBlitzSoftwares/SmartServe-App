-- =====================================================================
-- One KOT per COURSE (instead of per category) - per event.
-- Additive and safe to run twice. Events with the new switch off work
-- exactly as before (one KOT per category).
--
-- With events.kot_per_course on (and "One KOT per category" on):
--   * an order is split into one KOT per course of its dishes (Beverages,
--     Soups, Chat ...) - Beverages + Shakes & Smoothies + Fresh Shots in one
--     order give ONE Beverages KOT, not three;
--   * a dish without a course goes on the KOT of its category, as before;
--   * the KOT shows the course name where it showed the category, its dishes
--     are listed counter by counter (category order);
--   * the printer is the one of the course's first category (by menu order);
--     no printer -> printed at the desk, as today.
-- Switched on below for the Sanjog Wedding Carnival events.
-- =====================================================================

alter table events add column if not exists kot_per_course boolean not null default false;

create or replace function ss_cat_kots() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_id     uuid;
  v_kit    uuid;
  v_prefix text;
  v_seq    int;
  v_no     text;
  v_tn     int;
  v_cap    text;
begin
  for r in
    select g.order_id, g.event_id, g.grp_cat as category_id, g.grp_name as cat_name,
           (array_agg(g.cat_kitchen order by g.cat_sort nulls last, g.dish))[1] as cat_kitchen,
           jsonb_agg(jsonb_build_object(
             'name', g.dish || case when g.live then ' [LIVE]' else '' end,
             'qty', g.quantity, 'note', g.note, 'veg', g.veg, 'cat', g.cat_label)
             order by g.cat_sort nulls last, g.dish) as items,
           min(g.course_pos) as cpos, min(g.cat_sort) as srt
      from (
        select ni.order_id, o.event_id, ni.quantity, ni.note,
               mi.name as dish, coalesce(mi.is_live_counter, false) as live, mi.is_veg as veg,
               c.kitchen_id as cat_kitchen, c.sort_order as cat_sort,
               coalesce(nullif(btrim(c.name), ''), 'Other') as cat_label,
               case when coalesce(e.kot_per_course, false) and nullif(btrim(mi.course), '') is not null
                    then null else mi.category_id end as grp_cat,
               case when coalesce(e.kot_per_course, false) and nullif(btrim(mi.course), '') is not null
                    then btrim(mi.course) else coalesce(nullif(btrim(c.name), ''), 'Other') end as grp_name,
               case when coalesce(e.kot_per_course, false)
                    then array_position(e.courses, btrim(mi.course)) end as course_pos
          from new_rows ni
          join orders o     on o.id = ni.order_id
          join events e     on e.id = o.event_id
          join menu_items mi on mi.id = ni.menu_item_id
          left join menu_categories c on c.id = mi.category_id
         where coalesce(e.kot_per_category, false) and not coalesce(e.multi_kitchen, false)
           and not coalesce(e.maestro, false) and o.status <> 'cancelled'
      ) g
     group by g.order_id, g.event_id, g.grp_cat, g.grp_name
     order by g.order_id, min(g.course_pos) nulls last, min(g.cat_sort) nulls last
  loop
    -- dishes added to an order whose KOT for this course / category has no waiter yet: same KOT
    v_id := null;
    update kots set items = items || r.items
     where order_id = r.order_id and kind = 'order' and status = 'open' and print_status = 'held'
       and category_id is not distinct from r.category_id
       and (r.category_id is not null or category_name = r.cat_name)
     returning id into v_id;
    if v_id is not null then continue; end if;

    -- the category's printer; else the event's default printer; else none (printed at the desk)
    v_kit := null; v_prefix := null;
    select k.id, k.prefix into v_kit, v_prefix from kitchens k
     where k.id = r.cat_kitchen and k.event_id = r.event_id and k.is_active;
    if v_kit is null then
      select k.id, k.prefix into v_kit, v_prefix from kitchens k
       where k.event_id = r.event_id and k.is_active
       order by k.is_default desc, k.sort_order, k.created_at limit 1;
    end if;

    if v_kit is not null then
      update kitchens set kot_seq = kot_seq + 1 where id = v_kit returning kot_seq into v_seq;
      v_no := upper(coalesce(nullif(btrim(v_prefix), ''), 'K')) || '-' || lpad(v_seq::text, 3, '0');
    else
      select count(*) + 1 into v_seq from kots where event_id = r.event_id and kind = 'order';
      v_no := 'K-' || lpad(v_seq::text, 3, '0');
    end if;

    select t.table_number into v_tn from orders o join tables t on t.id = o.table_id where o.id = r.order_id;
    select cp.name into v_cap from orders o join captains cp on cp.id = o.captain_id where o.id = r.order_id;

    insert into kots (event_id, order_id, kitchen_id, kind, kot_no, table_number, captain_name, kitchen_name,
                      items, category_id, category_name, print_status, status)
    values (r.event_id, r.order_id, v_kit, 'order', v_no, v_tn, v_cap, r.cat_name,
            r.items, r.category_id, r.cat_name, 'held', 'open');
  end loop;
  return null;
end $$;

drop trigger if exists order_items_cat_kots on order_items;
create trigger order_items_cat_kots after insert on order_items
  referencing new table as new_rows
  for each statement execute function ss_cat_kots();

-- Sanjog Wedding Carnival events: one KOT per course from now on
update events set kot_per_course = true where name ilike '%sanjog%';

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): the events with one KOT per course
select name, date, kot_per_category, kot_per_course
  from events where kot_per_course order by date, name;

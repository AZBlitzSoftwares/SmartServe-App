-- =====================================================================
-- RUN NOW, BEFORE SERVICE: the main event (RMA32) takes the dry run's set-up,
-- exactly (by name): event settings (courses, pacing, chairs, tables), kitchens
-- (1 or 2 barkers, course rule, default, KOT letters), cuisines (shown / hidden,
-- kitchen) and dishes (Barker A/B, course, kitchen, on/off, VIP-only). Sold-out
-- marks from the dry run are not copied. Logins, printers and dates are NOT
-- touched (already done by the switch).
-- Refuses to run once any dish is ordered on the main event, so service is never
-- disturbed. Safe to run twice before service. Nothing is deleted.
-- =====================================================================
do $$
declare
  v_main  uuid;
  v_dry   uuid;
  n       int;
  rb      record;
  v_id    uuid;
  col     text;
begin
  select count(*) into n from events where maestro and name not ilike '%dry run%' and date = '2026-10-16';
  if n <> 1 then raise exception 'Expected exactly one main Maestro event on 16 Oct, found %. Nothing changed.', n; end if;
  select id into v_main from events where maestro and name not ilike '%dry run%' and date = '2026-10-16';
  select id into v_dry from events where maestro and name ilike '%dry run 2%' order by created_at desc limit 1;
  if v_dry is null then raise exception 'Dry Run 2 not found. Nothing changed.'; end if;
  select count(*) into n from ms_items where event_id = v_main and state <> 'cancelled';
  if n > 0 then raise exception 'Service has started on the main event (% dishes ordered): nothing copied, nothing changed.', n; end if;

    -- ---- 1b. event settings (columns a database does not have are skipped) -----
    foreach col in array array['courses', 'late_minutes', 'pacing_minutes', 'first_course_auto', 'number_of_tables',
                               'table_covers', 'spare_covers', 'chairs_per_table', 'served_hide_minutes', 'multi_kitchen',
                               'service_mode', 'call_waiter_enabled', 'max_orders_per_table'] loop
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events' and column_name = col) then
        execute format('update events m set %1$I = d.%1$I from events d
                         where m.id = $1 and d.id = $2 and m.%1$I is distinct from d.%1$I', col) using v_main, v_dry;
      end if;
    end loop;

    -- ---- 1c. kitchens: on/off, 1 or 2 barkers, course rule, late time, default, KOT letters
    update kitchens m set is_active = d.is_active
      from kitchens d
     where m.event_id = v_main and d.event_id = v_dry and lower(btrim(m.name)) = lower(btrim(d.name))
       and d.is_active and not m.is_active;
    foreach col in array array['barkers', 'courses', 'late_minutes', 'is_default', 'prefix', 'sort_order', 'cloud_print_id'] loop
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'kitchens' and column_name = col) then
        execute format('update kitchens m set %1$I = d.%1$I from kitchens d
                         where m.event_id = $1 and d.event_id = $2 and m.is_active and d.is_active
                           and lower(btrim(m.name)) = lower(btrim(d.name)) and m.%1$I is distinct from d.%1$I', col)
          using v_main, v_dry;
      end if;
    end loop;
    -- ---- 1e. cuisines: shown or hidden, order, kitchen; a cuisine only in the dry run is added
    insert into menu_categories (event_id, name, sort_order, is_visible)
    select v_main, d.name, d.sort_order, d.is_visible from menu_categories d
     where d.event_id = v_dry
       and not exists (select 1 from menu_categories m where m.event_id = v_main and lower(btrim(m.name)) = lower(btrim(d.name)));
    update menu_categories m
       set is_visible = d.is_visible, sort_order = d.sort_order,
           kitchen_id = case when d.kitchen_id is null then null
                             else coalesce((select mk.id from kitchens mk join kitchens dk on lower(btrim(dk.name)) = lower(btrim(mk.name))
                                             where dk.id = d.kitchen_id and mk.event_id = v_main
                                             order by mk.is_active desc, mk.created_at limit 1), m.kitchen_id) end
      from menu_categories d
     where m.event_id = v_main and d.event_id = v_dry and lower(btrim(m.name)) = lower(btrim(d.name));

    -- ---- 1f. dishes, paired by cuisine name + dish name; a dish only in the dry run is added
    drop table if exists ss_dish_pair;
    create temp table ss_dish_pair (did uuid primary key, mid uuid not null);
    insert into ss_dish_pair (did, mid)
    with d as (select m.id, lower(btrim(c.name)) cn, lower(btrim(m.name)) dn,
                      row_number() over (partition by lower(btrim(c.name)), lower(btrim(m.name)) order by m.sort_order, m.created_at, m.id) rn
                 from menu_items m join menu_categories c on c.id = m.category_id where c.event_id = v_dry),
         x as (select m.id, lower(btrim(c.name)) cn, lower(btrim(m.name)) dn,
                      row_number() over (partition by lower(btrim(c.name)), lower(btrim(m.name)) order by m.sort_order, m.created_at, m.id) rn
                 from menu_items m join menu_categories c on c.id = m.category_id where c.event_id = v_main)
    select d.id, x.id from d join x using (cn, dn, rn);
    for rb in select d.id, d.name, (select mc.id from menu_categories mc where mc.event_id = v_main
                                     and lower(btrim(mc.name)) = lower(btrim(dc.name)) order by mc.created_at limit 1) as cat
               from menu_items d join menu_categories dc on dc.id = d.category_id
              where dc.event_id = v_dry and not exists (select 1 from ss_dish_pair p where p.did = d.id) loop
      continue when rb.cat is null;
      insert into menu_items (category_id, name) values (rb.cat, rb.name) returning id into v_id;
      insert into ss_dish_pair (did, mid) values (rb.id, v_id);
    end loop;
    foreach col in array array['description', 'is_veg', 'is_live_counter', 'photo_url', 'photo_source', 'sort_order',
                               'course', 'barker', 'vip_only'] loop
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'menu_items' and column_name = col) then
        execute format('update menu_items m set %1$I = d.%1$I from ss_dish_pair p join menu_items d on d.id = p.did
                         where m.id = p.mid and m.%1$I is distinct from d.%1$I', col);
      end if;
    end loop;
    update menu_items m
       set kitchen_id = case when d.kitchen_id is null then null
                             else coalesce((select mk.id from kitchens mk join kitchens dk on lower(btrim(dk.name)) = lower(btrim(mk.name))
                                             where dk.id = d.kitchen_id and mk.event_id = v_main
                                             order by mk.is_active desc, mk.created_at limit 1), m.kitchen_id) end
      from ss_dish_pair p join menu_items d on d.id = p.did
     where m.id = p.mid;
    -- on or off as set up in the dry run; whatever was sold out (dry run or main event) is on again
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'menu_items' and column_name = 'sold_out_at') then
      execute 'update menu_items m set is_available = case when d.sold_out_at is null then d.is_available else true end
                 from ss_dish_pair p join menu_items d on d.id = p.did
                where m.id = p.mid';
      execute 'update menu_items m set is_available = true, sold_out_at = null
                where m.sold_out_at is not null
                  and m.category_id in (select id from menu_categories where event_id = $1)' using v_main;
    else
      update menu_items m set is_available = d.is_available
        from ss_dish_pair p join menu_items d on d.id = p.did where m.id = p.mid;
    end if;

end $$;

notify pgrst, 'reload schema';

-- Check (the one result the SQL Editor shows). Every row should say OK.
with main as (select id from events where maestro and name not ilike '%dry run%' and date = '2026-10-16' limit 1),
     dry  as (select id from events where maestro and name ilike '%dry run 2%' order by created_at desc limit 1),
     kd as (select k.id, lower(btrim(k.name)) n from kitchens k where k.event_id in (select id from dry)),
     km as (select k.id, lower(btrim(k.name)) n from kitchens k where k.event_id in (select id from main)),
     dd as (select lower(btrim(c.name)) cn, lower(btrim(m.name)) dn, m.name, coalesce(m.barker, '') barker, coalesce(m.course, '') course,
                   coalesce((select n from kd where kd.id = m.kitchen_id), '') kit,
                   coalesce(m.is_available, true) or (to_jsonb(m) ->> 'sold_out_at') is not null as av,
                   row_number() over (partition by lower(btrim(c.name)), lower(btrim(m.name)) order by m.sort_order, m.created_at, m.id) rn
              from menu_items m join menu_categories c on c.id = m.category_id where c.event_id in (select id from dry)),
     dm as (select lower(btrim(c.name)) cn, lower(btrim(m.name)) dn, m.name, coalesce(m.barker, '') barker, coalesce(m.course, '') course,
                   coalesce((select n from km where km.id = m.kitchen_id), '') kit,
                   coalesce(m.is_available, true) or (to_jsonb(m) ->> 'sold_out_at') is not null as av, c.is_visible as cv,
                   row_number() over (partition by lower(btrim(c.name)), lower(btrim(m.name)) order by m.sort_order, m.created_at, m.id) rn
              from menu_items m join menu_categories c on c.id = m.category_id where c.event_id in (select id from main)),
     ddiff as (select coalesce(dd.name, dm.name) as name
                 from dd full join dm using (cn, dn, rn)
                where dd.name is null and coalesce(dm.cv, true) and dm.av   -- shown only in the main event
                   or dm.name is null                                       -- missing in the main event
                   or (dd.name is not null and dm.name is not null
                       and (dd.barker <> dm.barker or dd.course <> dm.course or dd.kit <> dm.kit or dd.av <> dm.av))),
     cdiff as (select coalesce(a.name, b.name) as name
                 from (select c.name, lower(btrim(c.name)) n, c.is_visible, coalesce((select n from kd where kd.id = c.kitchen_id), '') kit
                         from menu_categories c where c.event_id in (select id from dry)) a
                 full join (select c.name, lower(btrim(c.name)) n, c.is_visible, coalesce((select n from km where km.id = c.kitchen_id), '') kit
                              from menu_categories c where c.event_id in (select id from main)) b using (n)
                where a.name is null and coalesce(b.is_visible, true) or b.name is null
                   or (a.name is not null and b.name is not null and (a.is_visible is distinct from b.is_visible or a.kit <> b.kit))),
     kdiff as (select a.name
                 from kitchens a join kitchens b on lower(btrim(b.name)) = lower(btrim(a.name))
                where a.event_id in (select id from dry) and b.event_id in (select id from main) and a.is_active
                  and (not b.is_active or a.barkers is distinct from b.barkers or a.courses::text is distinct from b.courses::text
                       or a.is_default is distinct from b.is_default))
select step, item, detail, ok from (
  select 1 as s, 'Event tonight' as step, e.name as item, e.date::text as detail,
         case when e.name ilike '%dry run%' then 'NO - dry run still dated tonight' else 'OK' end as ok
    from events e where e.date in ('2026-10-16', '2026-10-17')
  union all
  select 2, 'Kitchen', k.name,
         coalesce(k.barkers, 1)::text || ' barker' || case when coalesce(k.barkers, 1) >= 2 then 's' else '' end
           || '  ·  A ' || coalesce(nullif(btrim(coalesce(k.printer_ip, '')), ''), 'NOT SET')
           || case when k.barkers >= 2 then '  ·  B ' || coalesce(nullif(btrim(coalesce(to_jsonb(k) ->> 'printer_ip_b', '')), ''), 'same printer as A') else '' end
           || case when k.barkers >= 2 then '  ·  dishes A ' || (select count(*) from menu_items m join menu_categories c on c.id = m.category_id
                                                                   where coalesce(m.kitchen_id, c.kitchen_id) = k.id and m.barker = 'A' and coalesce(m.is_available, true) and coalesce(c.is_visible, true))
                                            || ' / B ' || (select count(*) from menu_items m join menu_categories c on c.id = m.category_id
                                                                   where coalesce(m.kitchen_id, c.kitchen_id) = k.id and m.barker = 'B' and coalesce(m.is_available, true) and coalesce(c.is_visible, true))
                   else '' end,
         case when nullif(btrim(coalesce(k.printer_ip, '')), '') is null then 'NO - printer missing' else 'OK' end
    from kitchens k join main m on m.id = k.event_id where k.is_active
  union all
  select 3, 'Same as dry run', 'Kitchens (barkers, course rule)',
         coalesce(string_agg(name, ', '), 'all the same'), case when count(*) = 0 then 'OK' else 'NO - differ' end from kdiff
  union all
  select 3, 'Same as dry run', 'Cuisines (shown, kitchen)',
         coalesce(left(string_agg(name, ', '), 200), 'all the same'), case when count(*) = 0 then 'OK' else 'NO - ' || count(*) || ' differ' end from cdiff
  union all
  select 3, 'Same as dry run', 'Dishes (A/B, course, kitchen, on/off)',
         coalesce(left(string_agg(name, ', '), 200), 'all the same'), case when count(*) = 0 then 'OK' else 'NO - ' || count(*) || ' differ' end from ddiff
  union all
  select 4, 'Logins', 'Captains', count(*)::text || ' on', case when count(*) > 0 then 'OK' else 'NO - none' end
    from captains c join main m on m.id = c.event_id where c.is_active
  union all
  select 4, 'Logins', 'Barkers', count(*)::text || ' on', case when count(*) > 0 then 'OK' else 'NO - none' end
    from barkers b join main m on m.id = b.event_id join kitchens k on k.id = b.kitchen_id where b.is_active and k.is_active
  union all
  select 4, 'Logins', 'Managers / desk / screens',
         coalesce(string_agg(coalesce(s.name, '?'), ', ' order by s.name), 'none'), 'OK'
    from supervisors s join main m on m.id = s.event_id where s.is_active
  union all
  select 5, 'Dry run logins still on', 'captains, barkers, managers',
         ((select count(*) from captains where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
        + (select count(*) from barkers where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
        + (select count(*) from supervisors where is_active and event_id in (select id from events where maestro and name ilike '%dry run%')))::text,
         case when (select count(*) from captains where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
                 + (select count(*) from barkers where is_active and event_id in (select id from events where maestro and name ilike '%dry run%'))
                 + (select count(*) from supervisors where is_active and event_id in (select id from events where maestro and name ilike '%dry run%')) = 0
              then 'OK' else 'NO' end
) x
order by s, step, item;

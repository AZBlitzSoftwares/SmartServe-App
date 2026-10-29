-- =====================================================================
-- KOT numbers by course / category code (Guest Self-Service and Captain
-- Service events with "One KOT per category"):
--
--     IN-041  (Indian)   CH-042  (Chinese)   IT-043  (Italian)   DE-044 (Dessert)
--
-- The letters are the course's code (One KOT for each: Course) or the
-- category's code (One KOT for each: Category). The number runs on for the
-- whole event, so every KOT has its own number and "22" finds one KOT.
-- Codes are made from the name the first time (first two letters, without a
-- meal word such as "DINNER - "; another pair if two names would share one)
-- and can be changed in Control › KOT printing. They no longer come from the
-- printer's letters (P1-, C1-). Numbers carry on from the event's last KOT.
-- Maestro and multi-kitchen events are not affected.
-- Additive and safe to run twice. The Offline Kit applies it at Prepare Event.
-- =====================================================================

create table if not exists kot_series (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null unique references events(id) on delete cascade,
  seq        int  not null default 0,                    -- last KOT number given out
  codes      jsonb not null default '{}'::jsonb,         -- lower(course or category name) -> code
  updated_at timestamptz not null default now()
);

alter table kot_series enable row level security;
drop policy if exists kot_series_select on kot_series;
drop policy if exists kot_series_insert on kot_series;
drop policy if exists kot_series_update on kot_series;
create policy kot_series_select on kot_series for select using (true);
create policy kot_series_insert on kot_series for insert with check (true);
create policy kot_series_update on kot_series for update using (true) with check (true);
grant select, insert, update on kot_series to anon, authenticated;

-- ---------------------------------------------------------------------
-- The code for a course / category name (made and kept the first time)
-- ---------------------------------------------------------------------
create or replace function ss_kot_code(p_event uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_key   text := lower(btrim(coalesce(p_name, '')));
  v_codes jsonb;
  v_have  text;
  v_base  text;
  v_words text[];
  v_all   text;
  v_c     text;
  v_cands text[] := '{}';
  i       int;
begin
  insert into kot_series (event_id) values (p_event) on conflict (event_id) do nothing;
  select codes into v_codes from kot_series where event_id = p_event for update;
  v_have := nullif(btrim(v_codes ->> v_key), '');
  if v_have is not null then return upper(v_have); end if;

  -- "DINNER - JUICES AND SHAKES" -> JUICES AND SHAKES; "Desserts" -> DESSERTS
  v_base := regexp_replace(btrim(coalesce(p_name, '')),
    '^\s*(dinner|lunch|breakfast|brunch|all\s*day|high\s*tea|evening|snacks?)\s*[-–:|]\s*', '', 'i');
  v_words := array(select w from unnest(regexp_split_to_array(upper(regexp_replace(v_base, '[^A-Za-z ]', ' ', 'g')), '\s+')) w
                    where w <> '' and w not in ('AND', 'OF', 'THE', 'WITH', 'N'));
  v_all := array_to_string(v_words, '');

  if v_all <> '' then
    -- a hyphenated first word reads by its parts: "Non-Veg Starters" -> NV
    v_c := split_part(upper(regexp_replace(btrim(v_base), '[^A-Za-z -]', '', 'g')), ' ', 1);
    if v_c ~ '^[A-Z]+-[A-Z]' then v_cands := v_cands || (left(split_part(v_c, '-', 1), 1) || left(split_part(v_c, '-', 2), 1)); end if;
    if length(v_words[1]) >= 2 then v_cands := v_cands || left(v_words[1], 2); end if;          -- IN, CH, IT, DE
    if array_length(v_words, 1) >= 2 then v_cands := v_cands || (left(v_words[1], 1) || left(v_words[2], 1)); end if;  -- MC
    if array_length(v_words, 1) >= 3 then v_cands := v_cands || (left(v_words[1], 1) || left(v_words[3], 1)); end if;
    for i in 2 .. length(v_all) loop v_cands := v_cands || (left(v_all, 1) || substr(v_all, i, 1)); end loop;
    for i in 2 .. 9 loop v_cands := v_cands || (left(v_all, 1) || i::text); end loop;
  end if;
  for i in 1 .. 99 loop v_cands := v_cands || ('K' || i::text); end loop;

  foreach v_c in array v_cands loop
    if not exists (select 1 from jsonb_each_text(v_codes) x where upper(x.value) = v_c) then
      update kot_series set codes = codes || jsonb_build_object(v_key, v_c), updated_at = now() where event_id = p_event;
      return v_c;
    end if;
  end loop;
  return 'K';
end $$;

-- ---------------------------------------------------------------------
-- The next KOT number of an event: CODE-NNN, the number running on for the
-- whole event (starts after the event's highest KOT number so far)
-- ---------------------------------------------------------------------
create or replace function ss_kot_no(p_event uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_seq int;
begin
  insert into kot_series (event_id, seq)
  values (p_event, greatest(
            coalesce((select max(nullif(substring(k.kot_no from '(\d+)\s*$'), '')::int)
                        from kots k where k.event_id = p_event and k.kind = 'order'), 0),
            coalesce((select max(kt.kot_seq) from kitchens kt where kt.event_id = p_event), 0)))
  on conflict (event_id) do nothing;
  v_code := ss_kot_code(p_event, p_name);
  update kot_series set seq = seq + 1, updated_at = now() where event_id = p_event returning seq into v_seq;
  return v_code || '-' || lpad(v_seq::text, 3, '0');
end $$;

-- ---------------------------------------------------------------------
-- Control › KOT printing: show every course / category its code (made in
-- menu order the first time), and change one
-- ---------------------------------------------------------------------
create or replace function ss_kot_codes(p_event uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_codes jsonb; v_course boolean;
begin
  select coalesce(kot_per_course, false) into v_course from events where id = p_event;
  if v_course then
    -- courses in the event's order, then any other course on a dish
    for v_name in
      select x.c from (
        select btrim(u.c) as c, u.ord from unnest(coalesce((select courses from events where id = p_event), '{}'::text[])) with ordinality as u(c, ord)
        union all
        select distinct btrim(mi.course), 100000 from menu_items mi join menu_categories mc on mc.id = mi.category_id
         where mc.event_id = p_event and nullif(btrim(mi.course), '') is not null
      ) x where x.c <> '' group by x.c order by min(x.ord), x.c
    loop
      perform ss_kot_code(p_event, v_name);
    end loop;
  else
    -- categories in menu order
    for v_name in
      select coalesce(nullif(btrim(mc.name), ''), 'Other') from menu_categories mc
       where mc.event_id = p_event order by mc.sort_order nulls last, mc.name
    loop
      perform ss_kot_code(p_event, v_name);
    end loop;
  end if;
  select codes into v_codes from kot_series where event_id = p_event;
  return coalesce(v_codes, '{}'::jsonb);
end $$;

create or replace function ss_kot_code_set(p_event uuid, p_name text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text := lower(btrim(coalesce(p_name, ''))); v_code text := upper(btrim(coalesce(p_code, ''))); v_codes jsonb;
begin
  if v_code !~ '^[A-Z0-9]{1,4}$' then raise exception 'BAD_CODE: use 1 to 4 letters or digits'; end if;
  insert into kot_series (event_id) values (p_event) on conflict (event_id) do nothing;
  select codes into v_codes from kot_series where event_id = p_event for update;
  if exists (select 1 from jsonb_each_text(v_codes) x where upper(x.value) = v_code and x.key <> v_key) then
    raise exception 'CODE_TAKEN: % is already used by another course or category', v_code;
  end if;
  update kot_series set codes = codes || jsonb_build_object(v_key, v_code), updated_at = now()
   where event_id = p_event returning codes into v_codes;
  return v_codes;
end $$;

grant execute on function ss_kot_code(uuid, text)          to anon, authenticated;
grant execute on function ss_kot_no(uuid, text)            to anon, authenticated;
grant execute on function ss_kot_codes(uuid)               to anon, authenticated;
grant execute on function ss_kot_code_set(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- KOTs: the same function as 2026-10-26_course_printers.sql; only the
-- number changes (course / category code + the event's running number)
-- ---------------------------------------------------------------------
create or replace function ss_cat_kots() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_id     uuid;
  v_kit    uuid;
  v_prefix text;
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

    -- the course's printer (Control > KOT printing > Courses: kitchens.courses); else the
    -- category's printer; else the event's default printer; else none (printed at the desk)
    v_kit := null; v_prefix := null;
    if r.category_id is null and r.cat_name is not null then
      select k.id, k.prefix into v_kit, v_prefix from kitchens k
       where k.event_id = r.event_id and k.is_active
         and exists (select 1 from unnest(coalesce(k.courses, '{}'::text[])) c where lower(btrim(c)) = lower(r.cat_name))
       order by k.sort_order nulls last, k.created_at limit 1;
    end if;
    if v_kit is null then
      select k.id, k.prefix into v_kit, v_prefix from kitchens k
       where k.id = r.cat_kitchen and k.event_id = r.event_id and k.is_active;
    end if;
    if v_kit is null then
      select k.id, k.prefix into v_kit, v_prefix from kitchens k
       where k.event_id = r.event_id and k.is_active
       order by k.is_default desc, k.sort_order, k.created_at limit 1;
    end if;

    -- IN-041: the course / category code and the event's running number
    v_no := ss_kot_no(r.event_id, r.cat_name);

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

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows)
select 'KOT codes by course / category' as change,
       case when position('ss_kot_no' in pg_get_functiondef('ss_cat_kots'::regproc)) > 0
             and to_regclass('public.kot_series') is not null then 'OK' else 'NOT APPLIED' end as status;

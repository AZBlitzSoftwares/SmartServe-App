-- =====================================================================
-- Smart Serve Maestro - course-paced, multi-kitchen service (v1, 8 Oct 2026)
--
-- Builds on 2026-10-07_multikitchen.sql (run that one first).
--
-- ADDITIVE ONLY. New tables, new nullable/defaulted columns and new
-- functions. Nothing existing is renamed, dropped or changed in meaning:
-- guest events, captain events and multi-kitchen events behave exactly as
-- before. Maestro is switched on per event (events.maestro).
--
-- How Maestro works in the database
--   ms_items    every dish a captain takes down, for one cover (seat) of a
--               table. It starts HELD. Nothing reaches a kitchen yet.
--   ms_fire()   the captain fires dishes: in ONE transaction each dish is
--               routed to its kitchen and barker (A or B), the dishes are
--               grouped into one KOT per cover per barker, each KOT gets its
--               barker's next number (AS-A 014) and is queued for the Print Hub.
--   kots        the existing KOT table, with a kitchen stage per KOT:
--               new -> received -> in_prep -> ready -> dispatched, each with
--               its time, then served (tapped by the table captain).
--   ms_covers   which covers are seated. Seating a cover fires the First
--               Course for it automatically (if the event says so).
--   barkers     kitchen barkers, signed in on the Kitchen Display by name + PIN.
--
-- Safe to run more than once. Runs as one transaction: if any line fails,
-- nothing is applied.
--
-- Run in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Event settings
-- ---------------------------------------------------------------------
alter table events add column if not exists maestro            boolean not null default false;
alter table events add column if not exists courses            text[]  not null
  default array['First Course', 'Soup', 'Starters', 'Mains', 'Dessert']::text[];
alter table events add column if not exists late_minutes       int     not null default 5;   -- KOT turns red this long after firing
alter table events add column if not exists pacing_minutes     int     not null default 25;  -- seated cover with nothing fired this long -> alert
alter table events add column if not exists first_course_auto  boolean not null default true;-- seating a cover fires the First Course

-- ---------------------------------------------------------------------
-- 2. Kitchens: course rule, barkers, late threshold, Barker B number series
-- ---------------------------------------------------------------------
alter table kitchens add column if not exists courses       text[];                          -- course rule: these courses come here, any cuisine
alter table kitchens add column if not exists barkers       int not null default 2;          -- 1 = Barker A only, 2 = A and B
alter table kitchens add column if not exists late_minutes  int;                             -- null = the event's
alter table kitchens add column if not exists kot_seq_b     int not null default 0;          -- kot_seq is Barker A's series

-- ---------------------------------------------------------------------
-- 3. Dishes: course, barker, sold-out record
-- ---------------------------------------------------------------------
alter table menu_items add column if not exists course       text;                           -- one of events.courses
alter table menu_items add column if not exists barker       text;                           -- 'A' or 'B' within its kitchen
alter table menu_items add column if not exists sold_out_at  timestamptz;
alter table menu_items add column if not exists sold_out_by  text;

-- ---------------------------------------------------------------------
-- 4. KOT: one cover, one barker, one firing, and its kitchen stages
-- ---------------------------------------------------------------------
alter table kots add column if not exists cover_no       int;
alter table kots add column if not exists barker         text;           -- A | B
alter table kots add column if not exists barker_name    text;
alter table kots add column if not exists course         text;
alter table kots add column if not exists firing_id      uuid;
alter table kots add column if not exists firing_no      int;
alter table kots add column if not exists fired_at       timestamptz;
alter table kots add column if not exists stage          text not null default 'new'; -- new | received | in_prep | ready | dispatched
alter table kots add column if not exists stage_by       text;
alter table kots add column if not exists received_at    timestamptz;
alter table kots add column if not exists in_prep_at     timestamptz;
alter table kots add column if not exists ready_at       timestamptz;
alter table kots add column if not exists dispatched_at  timestamptz;
alter table kots add column if not exists served_at      timestamptz;
alter table kots add column if not exists is_remake      boolean not null default false;
alter table kots add column if not exists priority       boolean not null default false;
alter table kots add column if not exists is_reprint     boolean not null default false;
create index if not exists kots_kitchen_stage_idx on kots(kitchen_id, stage);
create index if not exists kots_firing_idx        on kots(firing_id);

-- ---------------------------------------------------------------------
-- 5. New tables
-- ---------------------------------------------------------------------
create table if not exists barkers (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  kitchen_id  uuid references kitchens(id) on delete set null,
  side        text not null default 'A',          -- A | B
  name        text not null,
  pin         text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- When this barker's Kitchen Display last checked in (Control Desk shows a green dot)
alter table barkers add column if not exists last_seen_at timestamptz;
create index if not exists barkers_event_idx on barkers(event_id);

create table if not exists ms_covers (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  table_number  int  not null,
  cover_no      int  not null,
  seated_at     timestamptz,
  seated_by     text,
  created_at    timestamptz not null default now(),
  unique (event_id, table_number, cover_no)
);

create table if not exists ms_firings (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  table_number  int  not null,
  firing_no     int  not null,
  captain_id    uuid,
  captain_name  text,
  is_remake     boolean not null default false,
  client_ref    text,
  fired_at      timestamptz not null default now()
);
create index if not exists ms_firings_table_idx on ms_firings(event_id, table_number);
create unique index if not exists ms_firings_client_ref_uq on ms_firings(client_ref) where client_ref is not null;

create table if not exists ms_items (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  table_number   int  not null,
  cover_no       int  not null,
  menu_item_id   uuid references menu_items(id) on delete set null,
  name           text not null,
  course         text,
  qty            int  not null default 1,
  note           text,
  veg            boolean,
  kitchen_id     uuid references kitchens(id) on delete set null,  -- routed at hold time, re-routed at firing
  barker         text,
  state          text not null default 'held',   -- held | fired | cancelled
  firing_id      uuid references ms_firings(id) on delete set null,
  kot_id         uuid references kots(id) on delete set null,
  held_by        uuid,                           -- captain
  held_by_name   text,
  held_at        timestamptz not null default now(),
  fired_at       timestamptz,
  served_at      timestamptz,
  cancelled_at   timestamptz,
  is_first_course boolean not null default false,
  remake_of      uuid,
  client_ref     text
);
create index if not exists ms_items_table_idx   on ms_items(event_id, table_number, cover_no);
create index if not exists ms_items_kitchen_idx on ms_items(kitchen_id, state);
create index if not exists ms_items_kot_idx     on ms_items(kot_id);
create unique index if not exists ms_items_client_ref_uq on ms_items(client_ref) where client_ref is not null;

-- ---------------------------------------------------------------------
-- 6. Access - same open policy style as every other table in this app
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['barkers', 'ms_covers', 'ms_firings', 'ms_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for select using (true)', t || '_select', t);
    execute format('create policy %I on %I for insert with check (true)', t || '_insert', t);
    execute format('create policy %I on %I for update using (true) with check (true)', t || '_update', t);
    execute format('create policy %I on %I for delete using (true)', t || '_delete', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;

-- Live updates for the captain, kitchen displays and the Control Desk
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['barkers', 'ms_covers', 'ms_firings', 'ms_items'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Routing: which kitchen and which barker prepares a dish.
--    The first matching rule wins:
--      1. a kitchen set on the dish itself
--      2. a kitchen whose courses include the dish's course
--      3. the kitchen of the dish's category (cuisine)
--      4. the default kitchen
--    Barker: the dish's barker (A or B); always A in a one-barker kitchen.
-- ---------------------------------------------------------------------
create or replace function ms_route(p_event_id uuid, p_menu_item_id uuid)
returns table(kitchen_id uuid, barker text)
language sql stable security definer set search_path = public as $$
  with mi as (
    select m.id, m.kitchen_id as dish_kitchen, m.course, m.barker, c.kitchen_id as cat_kitchen
      from menu_items m left join menu_categories c on c.id = m.category_id
     where m.id = p_menu_item_id
  ), pick as (
    select coalesce(
      (select k.id from kitchens k, mi where k.id = mi.dish_kitchen and k.is_active),
      (select k.id from kitchens k, mi
        where k.event_id = p_event_id and k.is_active and mi.course is not null
          and mi.course = any(coalesce(k.courses, '{}'::text[]))
        order by k.sort_order, k.created_at limit 1),
      (select k.id from kitchens k, mi where k.id = mi.cat_kitchen and k.is_active),
      (select k.id from kitchens k
        where k.event_id = p_event_id and k.is_active
        order by k.is_default desc, k.sort_order, k.created_at limit 1)
    ) as kid
  )
  select pick.kid,
         case when coalesce(k.barkers, 2) < 2 then 'A'
              when upper(btrim(coalesce((select barker from mi), 'A'))) = 'B' then 'B'
              else 'A' end
    from pick left join kitchens k on k.id = pick.kid
$$;

-- ---------------------------------------------------------------------
-- 8. Hold: the captain saves dishes for one cover. Nothing is sent.
--    p_items: [{"menu_item_id": "...", "qty": 1, "note": "Jain"}]
--    p_client_ref: one id per Save, so a retry never saves twice.
-- ---------------------------------------------------------------------
create or replace function ms_hold(p_event_id uuid, p_table_number int, p_cover_no int,
                                   p_captain_id uuid, p_items jsonb, p_client_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap text;
  v_ids uuid[];
begin
  if nullif(btrim(coalesce(p_client_ref, '')), '') is not null
     and exists (select 1 from ms_items where client_ref like p_client_ref || ':%') then
    select array_agg(id) into v_ids from ms_items where client_ref like p_client_ref || ':%';
    return jsonb_build_object('duplicate', true, 'ids', to_jsonb(v_ids));
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER: nothing to save';
  end if;
  if p_cover_no is null or p_cover_no < 1 then
    raise exception 'NO_COVER: choose the cover first';
  end if;
  select name into v_cap from captains where id = p_captain_id;

  with src as (
    select x, ord from jsonb_array_elements(p_items) with ordinality as t(x, ord)
  ), ins as (
    insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, note, veg,
                          kitchen_id, barker, held_by, held_by_name, client_ref)
    select p_event_id, p_table_number, p_cover_no, m.id, m.name, m.course,
           greatest(1, coalesce((s.x->>'qty')::int, (s.x->>'quantity')::int, 1)),
           nullif(btrim(coalesce(s.x->>'note', '')), ''), m.is_veg,
           r.kitchen_id, r.barker, p_captain_id, v_cap,
           case when nullif(btrim(coalesce(p_client_ref, '')), '') is null then null
                else p_client_ref || ':' || s.ord end
      from src s
      join menu_items m on m.id = (s.x->>'menu_item_id')::uuid
      cross join lateral ms_route(p_event_id, m.id) r
    returning id
  )
  select array_agg(id) into v_ids from ins;

  return jsonb_build_object('ids', to_jsonb(coalesce(v_ids, '{}'::uuid[])));
end $$;

-- ---------------------------------------------------------------------
-- 9. Fire: send held dishes to the kitchens, in one transaction.
--    One KOT per cover per kitchen barker. Each KOT takes its barker's
--    next number. Returns the KOTs for the captain's screen.
--    p_client_ref: one id per Fire tap; tapping again (slow network)
--    returns the first result instead of a second KOT.
-- ---------------------------------------------------------------------
create or replace function ms_fire(p_event_id uuid, p_table_number int, p_item_ids uuid[],
                                   p_captain_id uuid, p_client_ref text default null,
                                   p_remake boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_firing  uuid;
  v_no      int;
  v_cap     text;
  v_prefix  text;
  v_kname   text;
  v_seq     int;
  v_kot_no  text;
  v_kot     uuid;
  v_bname   text;
  v_count   int;
  v_out     jsonb := '[]'::jsonb;
  r         record;
begin
  if nullif(btrim(coalesce(p_client_ref, '')), '') is not null then
    select id into v_firing from ms_firings where client_ref = p_client_ref;
    if v_firing is not null then
      return jsonb_build_object('firing_id', v_firing, 'duplicate', true, 'kots',
        coalesce((select jsonb_agg(jsonb_build_object('kot_id', k.id, 'kot_no', k.kot_no, 'kitchen', k.kitchen_name,
                                                      'cover_no', k.cover_no, 'barker', k.barker) order by k.kot_no)
                    from kots k where k.firing_id = v_firing), '[]'::jsonb));
    end if;
  end if;

  -- one firing at a time per table, so firing numbers never clash
  perform pg_advisory_xact_lock(hashtext(p_event_id::text || ':' || p_table_number::text));

  select count(*) into v_count from ms_items
   where id = any(p_item_ids) and event_id = p_event_id and table_number = p_table_number and state = 'held';
  if v_count = 0 then
    raise exception 'NOTHING_TO_FIRE: these dishes were already sent or cancelled';
  end if;
  perform 1 from ms_items where id = any(p_item_ids) and state = 'held' for update;

  if not exists (select 1 from kitchens where event_id = p_event_id and is_active) then
    raise exception 'NO_KITCHENS: no kitchens are set up for this event';
  end if;

  select name into v_cap from captains where id = p_captain_id;
  select coalesce(max(firing_no), 0) + 1 into v_no
    from ms_firings where event_id = p_event_id and table_number = p_table_number;

  insert into ms_firings (event_id, table_number, firing_no, captain_id, captain_name, is_remake, client_ref)
  values (p_event_id, p_table_number, v_no, p_captain_id, v_cap, p_remake,
          nullif(btrim(coalesce(p_client_ref, '')), ''))
  returning id into v_firing;

  -- route again at firing time: set-up changes made since the hold count
  update ms_items i set kitchen_id = r2.kitchen_id, barker = r2.barker
    from (select i2.id, rt.kitchen_id, rt.barker
            from ms_items i2 cross join lateral ms_route(p_event_id, i2.menu_item_id) rt
           where i2.id = any(p_item_ids) and i2.state = 'held' and i2.menu_item_id is not null) r2
   where i.id = r2.id and r2.kitchen_id is not null;

  update ms_items set kitchen_id = (select id from kitchens where event_id = p_event_id and is_active
                                     order by is_default desc, sort_order, created_at limit 1),
                      barker = coalesce(barker, 'A')
   where id = any(p_item_ids) and state = 'held' and kitchen_id is null;

  for r in
    select i.cover_no, i.kitchen_id, coalesce(i.barker, 'A') as barker,
           array_agg(i.id) as ids,
           jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'qty', i.qty,
                                        'note', i.note, 'veg', i.veg, 'course', i.course)
                     order by array_position(ev.courses, i.course) nulls last, i.held_at, i.name) as items,
           string_agg(distinct i.course, ' + ') as course
      from ms_items i
      join events ev on ev.id = i.event_id
     where i.id = any(p_item_ids) and i.state = 'held'
     group by i.cover_no, i.kitchen_id, coalesce(i.barker, 'A')
     order by i.cover_no, i.kitchen_id, coalesce(i.barker, 'A')
  loop
    if r.barker = 'B' then
      update kitchens set kot_seq_b = kot_seq_b + 1 where id = r.kitchen_id
        returning kot_seq_b, prefix, name into v_seq, v_prefix, v_kname;
    else
      update kitchens set kot_seq = kot_seq + 1 where id = r.kitchen_id
        returning kot_seq, prefix, name into v_seq, v_prefix, v_kname;
    end if;
    v_kot_no := upper(coalesce(nullif(v_prefix, ''), 'K')) || '-' || r.barker || ' ' || lpad(v_seq::text, 3, '0');

    select b.name into v_bname from barkers b
     where b.kitchen_id = r.kitchen_id and b.side = r.barker and b.is_active
     order by b.created_at limit 1;

    insert into kots (event_id, kitchen_id, kind, kot_no, table_number, chairs, captain_name, kitchen_name,
                      items, cover_no, barker, barker_name, course, firing_id, firing_no, fired_at,
                      stage, is_remake, priority)
    values (p_event_id, r.kitchen_id, 'order', v_kot_no, p_table_number, array[r.cover_no], v_cap, v_kname,
            r.items, r.cover_no, r.barker, v_bname, r.course, v_firing, v_no, now(),
            'new', p_remake, p_remake)
    returning id into v_kot;

    update ms_items set state = 'fired', kot_id = v_kot, firing_id = v_firing, fired_at = now()
     where id = any(r.ids);

    v_out := v_out || jsonb_build_object('kot_id', v_kot, 'kot_no', v_kot_no, 'kitchen', v_kname,
                                         'cover_no', r.cover_no, 'barker', r.barker);
  end loop;

  return jsonb_build_object('firing_id', v_firing, 'firing_no', v_no, 'kots', v_out);
end $$;

-- ---------------------------------------------------------------------
-- 10. Seat covers. A cover seated for the first time gets the event's
--     First Course fired automatically (first_course_auto). p_seated false
--     un-marks a cover tapped by mistake.
-- ---------------------------------------------------------------------
create or replace function ms_seat(p_event_id uuid, p_table_number int, p_covers int[],
                                   p_captain_id uuid, p_seated boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap     text;
  v_new     int[] := '{}';
  v_first   text;
  v_auto    boolean;
  v_ids     uuid[];
  v_fire    jsonb := null;
  c         int;
begin
  select name into v_cap from captains where id = p_captain_id;
  if not p_seated then
    update ms_covers set seated_at = null
     where event_id = p_event_id and table_number = p_table_number and cover_no = any(p_covers);
    return jsonb_build_object('unseated', to_jsonb(p_covers));
  end if;

  foreach c in array coalesce(p_covers, '{}'::int[]) loop
    if not exists (select 1 from ms_covers where event_id = p_event_id and table_number = p_table_number
                     and cover_no = c and seated_at is not null) then
      insert into ms_covers (event_id, table_number, cover_no, seated_at, seated_by)
      values (p_event_id, p_table_number, c, now(), v_cap)
      on conflict (event_id, table_number, cover_no)
      do update set seated_at = now(), seated_by = excluded.seated_by;
      v_new := v_new || c;
    end if;
  end loop;

  select courses[1], first_course_auto into v_first, v_auto from events where id = p_event_id;
  if v_auto and cardinality(v_new) > 0 and v_first is not null
     and not exists (select 1 from ms_items where event_id = p_event_id and table_number = p_table_number
                       and cover_no = any(v_new) and is_first_course and state <> 'cancelled') then
    with ins as (
      insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, veg,
                            kitchen_id, barker, held_by, held_by_name, is_first_course)
      select p_event_id, p_table_number, cv, m.id, m.name, m.course, 1, m.is_veg,
             r.kitchen_id, r.barker, p_captain_id, v_cap, true
        from unnest(v_new) cv
        cross join menu_items m
        cross join lateral ms_route(p_event_id, m.id) r
       where m.event_id = p_event_id and m.course = v_first and coalesce(m.is_available, true)
      returning id
    )
    select array_agg(id) into v_ids from ins;
    if v_ids is not null and cardinality(v_ids) > 0 then
      v_fire := ms_fire(p_event_id, p_table_number, v_ids, p_captain_id, null, false);
    end if;
  end if;

  return jsonb_build_object('seated', to_jsonb(v_new), 'first_course', v_fire);
end $$;

-- ---------------------------------------------------------------------
-- 11. Kitchen stage: the barker moves a KOT. Moving back (a mis-click)
--     clears the later times. Dispatched = the plate left with a steward.
-- ---------------------------------------------------------------------
create or replace function ms_kot_stage(p_kot_id uuid, p_stage text, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row kots; v_rank int;
begin
  v_rank := array_position(array['new', 'received', 'in_prep', 'ready', 'dispatched'], p_stage);
  if v_rank is null then raise exception 'BAD_STAGE: %', p_stage; end if;
  update kots set
      stage         = p_stage,
      stage_by      = coalesce(p_by, stage_by),
      received_at   = case when v_rank >= 2 then coalesce(received_at, now()) else null end,
      in_prep_at    = case when v_rank >= 3 then coalesce(in_prep_at, now()) else null end,
      ready_at      = case when v_rank >= 4 then coalesce(ready_at, now()) else null end,
      dispatched_at = case when v_rank >= 5 then coalesce(dispatched_at, now()) else null end
   where id = p_kot_id and kind = 'order' and status <> 'cancelled'
   returning * into v_row;
  if v_row.id is null then select * into v_row from kots where id = p_kot_id; end if;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 12. Served: the table captain confirms the plates reached the guest.
--     p_undo true takes it back (tapped by mistake).
-- ---------------------------------------------------------------------
create or replace function ms_serve(p_kot_ids uuid[], p_undo boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_undo then
    update kots set served_at = null, status = 'open'
     where id = any(p_kot_ids) and kind = 'order' and status = 'delivered';
    get diagnostics v_n = row_count;
    update ms_items set served_at = null where kot_id = any(p_kot_ids) and state = 'fired';
    return v_n;
  end if;
  update kots set served_at = coalesce(served_at, now()), status = 'delivered',
                  delivered_at = coalesce(delivered_at, now()),
                  stage = 'dispatched',
                  received_at = coalesce(received_at, now()),
                  in_prep_at = coalesce(in_prep_at, now()),
                  ready_at = coalesce(ready_at, now()),
                  dispatched_at = coalesce(dispatched_at, now())
   where id = any(p_kot_ids) and kind = 'order' and status = 'open';
  get diagnostics v_n = row_count;
  update ms_items set served_at = coalesce(served_at, now())
   where kot_id = any(p_kot_ids) and state = 'fired';
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 13. Cancel dishes. Held: simply cancelled. Fired: taken off their KOT,
--     and if that KOT already printed, the kitchen gets a CANCEL slip.
--     A KOT left with no dishes is cancelled.
-- ---------------------------------------------------------------------
create or replace function ms_cancel(p_item_ids uuid[], p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_held int := 0;
  v_fired int := 0;
  k record;
  v_gone jsonb;
  v_left jsonb;
begin
  update ms_items set state = 'cancelled', cancelled_at = now()
   where id = any(p_item_ids) and state = 'held';
  get diagnostics v_held = row_count;

  for k in
    select distinct t.* from kots t join ms_items i on i.kot_id = t.id
     where i.id = any(p_item_ids) and i.state = 'fired' and i.served_at is null
       and t.kind = 'order' and t.status = 'open'
  loop
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_gone
      from jsonb_array_elements(k.items) x where (x->>'item_id')::uuid = any(p_item_ids);
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_left
      from jsonb_array_elements(k.items) x where not ((x->>'item_id')::uuid = any(p_item_ids));

    if k.print_status in ('printing', 'printed') and jsonb_array_length(v_gone) > 0 then
      insert into kots (event_id, kitchen_id, kind, kot_no, table_number, chairs, captain_name, kitchen_name,
                        items, cover_no, barker, barker_name, course, firing_id, firing_no, fired_at, status, stage)
      values (k.event_id, k.kitchen_id, 'cancel', k.kot_no, k.table_number, k.chairs, coalesce(p_by, k.captain_name),
              k.kitchen_name, v_gone, k.cover_no, k.barker, k.barker_name, k.course, k.firing_id, k.firing_no,
              now(), 'cancelled', 'new');
    end if;

    if jsonb_array_length(v_left) = 0 then
      update kots set items = v_left, status = 'cancelled', cancelled_at = now(),
                      print_status = case when print_status in ('queued', 'failed') then 'skipped' else print_status end
       where id = k.id;
    else
      update kots set items = v_left where id = k.id;
    end if;
  end loop;

  update ms_items set state = 'cancelled', cancelled_at = now()
   where id = any(p_item_ids) and state = 'fired' and served_at is null;
  get diagnostics v_fired = row_count;

  return jsonb_build_object('held', v_held, 'fired', v_fired);
end $$;

-- ---------------------------------------------------------------------
-- 14. Remake: a dish sent back is fired again for the same cover, as a
--     REMAKE KOT shown first on the barker's screen.
-- ---------------------------------------------------------------------
create or replace function ms_remake(p_item_ids uuid[], p_captain_id uuid, p_client_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_event uuid;
  v_table int;
  v_cap text;
begin
  if nullif(btrim(coalesce(p_client_ref, '')), '') is not null
     and exists (select 1 from ms_firings where client_ref = p_client_ref) then
    return ms_fire(null, null, '{}'::uuid[], p_captain_id, p_client_ref, true);
  end if;
  select event_id, table_number into v_event, v_table from ms_items where id = p_item_ids[1];
  if v_event is null then raise exception 'NOTHING_TO_REMAKE'; end if;
  select name into v_cap from captains where id = p_captain_id;
  with ins as (
    insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, note, veg,
                          kitchen_id, barker, held_by, held_by_name, remake_of)
    select event_id, table_number, cover_no, menu_item_id, name, course, qty, note, veg,
           kitchen_id, barker, p_captain_id, v_cap, id
      from ms_items where id = any(p_item_ids) and state = 'fired'
    returning id
  )
  select array_agg(id) into v_ids from ins;
  if v_ids is null then raise exception 'NOTHING_TO_REMAKE: only dishes already sent can be remade'; end if;
  return ms_fire(v_event, v_table, v_ids, p_captain_id, p_client_ref, true);
end $$;

-- ---------------------------------------------------------------------
-- 15. Sold out (marked by a barker; undone by a barker or the desk)
-- ---------------------------------------------------------------------
create or replace function ms_sold_out(p_menu_item_id uuid, p_sold_out boolean, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row menu_items;
begin
  update menu_items set is_available = not p_sold_out,
                        sold_out_at = case when p_sold_out then now() else null end,
                        sold_out_by = case when p_sold_out then p_by else null end
   where id = p_menu_item_id
   returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'is_available', v_row.is_available,
                            'sold_out_by', v_row.sold_out_by);
end $$;

-- ---------------------------------------------------------------------
-- 16. Barker sign-in on the Kitchen Display. The PIN is checked here and
--     never sent to the screen.
-- ---------------------------------------------------------------------
create or replace function ms_barker_login(p_event_id uuid, p_name text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record;
begin
  select bk.id, bk.name, bk.side, bk.kitchen_id, k.name as kitchen_name, k.prefix
    into b
    from barkers bk left join kitchens k on k.id = bk.kitchen_id
   where bk.event_id = p_event_id and bk.is_active
     and coalesce(bk.pin, '') <> '' and bk.pin = btrim(p_pin)
     and lower(btrim(bk.name)) = lower(btrim(p_name))
   limit 1;
  if b.id is null then return null; end if;
  update barkers set last_seen_at = now() where id = b.id;
  return jsonb_build_object('id', b.id, 'name', b.name, 'side', b.side, 'kitchen_id', b.kitchen_id,
                            'kitchen_name', b.kitchen_name, 'prefix', b.prefix);
end $$;

-- The Kitchen Display checks in every 30 seconds while it is open.
create or replace function ms_barker_ping(p_barker_id uuid)
returns void language sql security definer set search_path = public as $$
  update barkers set last_seen_at = now() where id = p_barker_id;
$$;

-- ---------------------------------------------------------------------
-- 17. Reprint from the Control Desk: the KOT goes back to the Print Hub
--     and prints with REPRINT on it.
-- ---------------------------------------------------------------------
create or replace function ms_reprint(p_kot_id uuid, p_printer_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row kots;
begin
  update kots set print_status = 'queued', is_reprint = true, last_error = null,
                  printer_ip = coalesce(nullif(btrim(coalesce(p_printer_ip, '')), ''), printer_ip)
   where id = p_kot_id
   returning * into v_row;
  return to_jsonb(v_row);
end $$;

grant execute on function ms_route(uuid, uuid)                                  to anon, authenticated;
grant execute on function ms_hold(uuid, int, int, uuid, jsonb, text)            to anon, authenticated;
grant execute on function ms_fire(uuid, int, uuid[], uuid, text, boolean)       to anon, authenticated;
grant execute on function ms_seat(uuid, int, int[], uuid, boolean)              to anon, authenticated;
grant execute on function ms_kot_stage(uuid, text, text)                        to anon, authenticated;
grant execute on function ms_serve(uuid[], boolean)                             to anon, authenticated;
grant execute on function ms_cancel(uuid[], text)                               to anon, authenticated;
grant execute on function ms_remake(uuid[], uuid, text)                         to anon, authenticated;
grant execute on function ms_sold_out(uuid, boolean, text)                      to anon, authenticated;
grant execute on function ms_barker_login(uuid, text, text)                     to anon, authenticated;
grant execute on function ms_barker_ping(uuid)                                  to anon, authenticated;
grant execute on function ms_reprint(uuid, text)                                to anon, authenticated;

commit;

-- Ask the API to pick up the new tables and functions straight away
notify pgrst, 'reload schema';

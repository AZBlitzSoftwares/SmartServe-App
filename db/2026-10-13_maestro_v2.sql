-- =====================================================================
-- Smart Serve Maestro v2 - per-dish firing, notes and allergies, VIP guests
--
-- Builds on 2026-10-08_maestro.sql and 2026-10-10_maestro_covers.sql.
--
-- ADDITIVE ONLY and safe for the app already in use: new columns (all with
-- defaults or empty), one new table, new functions. ms_fire and ms_seat get
-- one extra optional parameter (p_per_item, default false = as before), so a
-- tablet still on the earlier version keeps working exactly as before.
--
--   ms_items.allergy        an allergy for one dish (printed clearly on the KOT)
--   ms_covers.guest_note    a note for everything this guest orders (less spicy ...)
--   ms_covers.guest_allergy an allergy for everything this guest orders
--   ms_covers.vip_guest_id  the VIP guest seated on this cover
--   ms_vip_guests           VIP guests of the event: preferences, allergies,
--                           preferred dishes, optionally a fixed table and cover
--   menu_items.vip_only     special dishes shown only for a VIP guest's cover
--   kots.guest_note / guest_allergy / vip_name   printed on every KOT of the cover
--   events.served_hide_minutes   delivered dishes leave the captain's order
--                                after this many minutes (default 3)
--
-- Safe to run more than once. Runs as one transaction: if any line fails,
-- nothing is applied.
--
-- Run in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Settings, dishes, VIP guests
-- ---------------------------------------------------------------------
alter table events add column if not exists served_hide_minutes int not null default 3;
-- a KOT not delivered this long after firing flashes on the kitchen screen (new events: 3 min)
alter table events alter column late_minutes set default 3;

alter table menu_items add column if not exists vip_only boolean not null default false;

create table if not exists ms_vip_guests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  name          text not null,
  label         text,                              -- VIP, VVIP, Host family ... (shown and printed)
  table_number  int,                               -- fixed seat, if known in advance
  cover_no      int,
  allergies     text,
  likes         text,
  dislikes      text,
  notes         text,
  dishes        jsonb not null default '[]'::jsonb, -- preferred dishes: [{"menu_item_id": "...", "note": "..."}]
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists ms_vip_guests_event_idx on ms_vip_guests(event_id);

-- ---------------------------------------------------------------------
-- 2. The guest on a cover, dish allergy, what the KOT prints
-- ---------------------------------------------------------------------
alter table ms_covers add column if not exists guest_note    text;
alter table ms_covers add column if not exists guest_allergy text;
alter table ms_covers add column if not exists vip_guest_id  uuid;
alter table ms_covers add column if not exists vip_done      boolean not null default false; -- a fixed VIP was loaded (or turned away) once

alter table ms_items add column if not exists allergy      text;
alter table ms_items add column if not exists vip_guest_id uuid;

alter table kots add column if not exists guest_note    text;
alter table kots add column if not exists guest_allergy text;
alter table kots add column if not exists vip_name      text;

-- ---------------------------------------------------------------------
-- 3. Access and live updates, as every other Maestro table
-- ---------------------------------------------------------------------
do $$
declare t text := 'ms_vip_guests';
begin
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
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
    execute format('alter publication supabase_realtime add table public.%I', t);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Hold: as before, plus a dish allergy and the VIP the dish is for.
--    p_items: [{"menu_item_id": "...", "qty": 1, "note": "Less spicy", "allergy": "Nuts"}]
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
    insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, note, allergy, veg,
                          kitchen_id, barker, held_by, held_by_name, client_ref, vip_guest_id)
    select p_event_id, p_table_number, p_cover_no, m.id, m.name, m.course,
           greatest(1, coalesce((s.x->>'qty')::int, (s.x->>'quantity')::int, 1)),
           nullif(btrim(coalesce(s.x->>'note', '')), ''),
           nullif(btrim(coalesce(s.x->>'allergy', '')), ''),
           m.is_veg,
           r.kitchen_id, r.barker, p_captain_id, v_cap,
           case when nullif(btrim(coalesce(p_client_ref, '')), '') is null then null
                else p_client_ref || ':' || s.ord end,
           nullif(s.x->>'vip_guest_id', '')::uuid
      from src s
      join menu_items m on m.id = (s.x->>'menu_item_id')::uuid
      cross join lateral ms_route(p_event_id, m.id) r
    returning id
  )
  select array_agg(id) into v_ids from ins;

  return jsonb_build_object('ids', to_jsonb(coalesce(v_ids, '{}'::uuid[])));
end $$;

-- ---------------------------------------------------------------------
-- 5. Fire. p_per_item true: one KOT per dish (each dish is fired, printed,
--    numbered and delivered on its own). false: one KOT per cover per kitchen
--    barker, as before. Every KOT carries the guest's note, allergy and VIP
--    name from the cover, as they are at the moment of firing.
-- ---------------------------------------------------------------------
drop function if exists ms_fire(uuid, int, uuid[], uuid, text, boolean);
create or replace function ms_fire(p_event_id uuid, p_table_number int, p_item_ids uuid[],
                                   p_captain_id uuid, p_client_ref text default null,
                                   p_remake boolean default false, p_per_item boolean default false)
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
  v_ts      timestamptz;
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
                                        'note', i.note, 'allergy', i.allergy, 'veg', i.veg, 'course', i.course)
                     order by array_position(ev.courses, i.course) nulls last, i.held_at, i.name) as items,
           string_agg(distinct i.course, ' + ') as course,
           min(i.held_at) as first_held
      from ms_items i
      join events ev on ev.id = i.event_id
     where i.id = any(p_item_ids) and i.state = 'held'
     group by i.cover_no, i.kitchen_id, coalesce(i.barker, 'A'), (case when p_per_item then i.id end)
     order by i.cover_no, min(array_position(ev.courses, i.course)) nulls last, min(i.held_at), i.kitchen_id
  loop
    if r.barker = 'B' then
      update kitchens set kot_seq_b = kot_seq_b + 1 where id = r.kitchen_id
        returning kot_seq_b, prefix, name into v_seq, v_prefix, v_kname;
    else
      update kitchens set kot_seq = kot_seq + 1 where id = r.kitchen_id
        returning kot_seq, prefix, name into v_seq, v_prefix, v_kname;
    end if;
    v_kot_no := upper(coalesce(nullif(v_prefix, ''), 'K')) || '-' || r.barker || ' ' || lpad(v_seq::text, 3, '0');
    -- The time is taken after the kitchen's number is (the kitchen row stays locked until this
    -- firing commits), so KOT times follow the serial numbers even when captains fire at the
    -- same moment: the kitchen screen and the printer both go in serial order.
    v_ts := clock_timestamp();

    select b.name into v_bname from barkers b
     where b.kitchen_id = r.kitchen_id and b.side = r.barker and b.is_active
     order by b.created_at limit 1;

    insert into kots (event_id, kitchen_id, kind, kot_no, table_number, chairs, captain_name, kitchen_name,
                      items, cover_no, barker, barker_name, course, firing_id, firing_no, fired_at, created_at,
                      stage, is_remake, priority, guest_note, guest_allergy, vip_name)
    select p_event_id, r.kitchen_id, 'order', v_kot_no, p_table_number, array[r.cover_no], v_cap, v_kname,
           r.items, r.cover_no, r.barker, v_bname, r.course, v_firing, v_no, v_ts, v_ts,
           'new', p_remake, p_remake,
           nullif(btrim(coalesce(c.guest_note, '')), ''),
           nullif(btrim(coalesce(c.guest_allergy, '')), ''),
           case when g.id is not null
                then coalesce(nullif(btrim(coalesce(g.label, '')), '') || ' - ', '') || g.name end
      from (select 1) one
      left join ms_covers c on c.event_id = p_event_id and c.table_number = p_table_number and c.cover_no = r.cover_no
      left join ms_vip_guests g on g.id = c.vip_guest_id
    returning id into v_kot;

    update ms_items set state = 'fired', kot_id = v_kot, firing_id = v_firing, fired_at = v_ts
     where id = any(r.ids);

    v_out := v_out || jsonb_build_object('kot_id', v_kot, 'kot_no', v_kot_no, 'kitchen', v_kname,
                                         'cover_no', r.cover_no, 'barker', r.barker);
  end loop;

  return jsonb_build_object('firing_id', v_firing, 'firing_no', v_no, 'kots', v_out);
end $$;

-- ---------------------------------------------------------------------
-- 6. Seat covers: as before; p_per_item passes on to the automatic First
--    Course firing.
-- ---------------------------------------------------------------------
drop function if exists ms_seat(uuid, int, int[], uuid, boolean);
create or replace function ms_seat(p_event_id uuid, p_table_number int, p_covers int[],
                                   p_captain_id uuid, p_seated boolean default true,
                                   p_per_item boolean default false)
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
       where m.category_id in (select mc.id from menu_categories mc where mc.event_id = p_event_id)
         and m.course = v_first and coalesce(m.is_available, true) and not coalesce(m.vip_only, false)
      returning id
    )
    select array_agg(id) into v_ids from ins;
    if v_ids is not null and cardinality(v_ids) > 0 then
      v_fire := ms_fire(p_event_id, p_table_number, v_ids, p_captain_id, null, false, p_per_item);
    end if;
  end if;

  return jsonb_build_object('seated', to_jsonb(v_new), 'first_course', v_fire);
end $$;

-- ---------------------------------------------------------------------
-- 7. Remake: as before, the allergy and VIP of the dish go with it.
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
    return ms_fire(null, null, '{}'::uuid[], p_captain_id, p_client_ref, true, true);
  end if;
  select event_id, table_number into v_event, v_table from ms_items where id = p_item_ids[1];
  if v_event is null then raise exception 'NOTHING_TO_REMAKE'; end if;
  select name into v_cap from captains where id = p_captain_id;
  with ins as (
    insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, note, allergy, veg,
                          kitchen_id, barker, held_by, held_by_name, remake_of, vip_guest_id)
    select event_id, table_number, cover_no, menu_item_id, name, course, qty, note, allergy, veg,
           kitchen_id, barker, p_captain_id, v_cap, id, vip_guest_id
      from ms_items where id = any(p_item_ids) and state = 'fired'
    returning id
  )
  select array_agg(id) into v_ids from ins;
  if v_ids is null then raise exception 'NOTHING_TO_REMAKE: only dishes already sent can be remade'; end if;
  return ms_fire(v_event, v_table, v_ids, p_captain_id, p_client_ref, true, true);
end $$;

-- ---------------------------------------------------------------------
-- 8. Note and allergy of one dish not fired yet
-- ---------------------------------------------------------------------
create or replace function ms_item_note(p_item_id uuid, p_note text, p_allergy text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row ms_items;
begin
  update ms_items set note = nullif(btrim(coalesce(p_note, '')), ''),
                      allergy = nullif(btrim(coalesce(p_allergy, '')), '')
   where id = p_item_id and state = 'held'
   returning * into v_row;
  if v_row.id is null then
    raise exception 'ALREADY_SENT: this dish was already sent to the kitchen, its note cannot change';
  end if;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 9. The guest on a cover: a note and an allergy for everything they order.
--    Printed on every KOT of the cover fired from now on.
-- ---------------------------------------------------------------------
create or replace function ms_cover_guest(p_event_id uuid, p_table_number int, p_cover_no int,
                                          p_guest_note text, p_guest_allergy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row ms_covers;
begin
  insert into ms_covers (event_id, table_number, cover_no, guest_note, guest_allergy)
  values (p_event_id, p_table_number, p_cover_no,
          nullif(btrim(coalesce(p_guest_note, '')), ''), nullif(btrim(coalesce(p_guest_allergy, '')), ''))
  on conflict (event_id, table_number, cover_no)
  do update set guest_note = excluded.guest_note, guest_allergy = excluded.guest_allergy
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 10. A new guest sits on the cover: the last guest's note, allergy and VIP
--     go, and their dishes not fired yet are cancelled. Dishes already sent
--     stay in the history.
-- ---------------------------------------------------------------------
create or replace function ms_cover_reset(p_event_id uuid, p_table_number int, p_cover_no int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update ms_covers set guest_note = null, guest_allergy = null, vip_guest_id = null, vip_done = true
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no;
  update ms_items set state = 'cancelled', cancelled_at = now()
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no and state = 'held';
  get diagnostics v_n = row_count;
  return jsonb_build_object('cancelled', v_n);
end $$;

-- ---------------------------------------------------------------------
-- 11. VIP guest on a cover. Their allergies and dislikes become the
--     cover's guest note and allergy (printed on every KOT), their preferred
--     dishes are added to the cover's order (held, the captain fires them),
--     and the cover is seated. A VIP sits on one cover at a time: moved
--     here, the other cover loses the VIP and their dishes not fired yet.
--     Loading again adds nothing twice.
-- ---------------------------------------------------------------------
create or replace function ms_vip_apply(p_event_id uuid, p_table_number int, p_cover_no int,
                                        p_vip_id uuid, p_captain_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g        ms_vip_guests;
  v_cap    text;
  v_note   text;
  v_ids    uuid[];
  v_seat   jsonb;
begin
  select * into g from ms_vip_guests where id = p_vip_id and event_id = p_event_id and is_active;
  if g.id is null then raise exception 'NO_VIP: this VIP guest is not on the list'; end if;
  if p_cover_no is null or p_cover_no < 1 then raise exception 'NO_COVER: choose the cover first'; end if;
  select name into v_cap from captains where id = p_captain_id;

  -- one cover at a time
  update ms_items set state = 'cancelled', cancelled_at = now()
   where event_id = p_event_id and vip_guest_id = g.id and state = 'held'
     and not (table_number = p_table_number and cover_no = p_cover_no);
  update ms_covers set vip_guest_id = null, guest_note = null, guest_allergy = null
   where event_id = p_event_id and vip_guest_id = g.id
     and not (table_number = p_table_number and cover_no = p_cover_no);

  v_note := nullif(concat_ws(' | ', nullif(btrim(coalesce(g.notes, '')), ''),
                             case when nullif(btrim(coalesce(g.dislikes, '')), '') is not null
                                  then 'Dislikes: ' || btrim(g.dislikes) end), '');

  insert into ms_covers (event_id, table_number, cover_no, guest_note, guest_allergy, vip_guest_id, vip_done)
  values (p_event_id, p_table_number, p_cover_no, v_note, nullif(btrim(coalesce(g.allergies, '')), ''), g.id, true)
  on conflict (event_id, table_number, cover_no)
  do update set guest_note = excluded.guest_note, guest_allergy = excluded.guest_allergy,
                vip_guest_id = excluded.vip_guest_id, vip_done = true;

  with src as (
    select x, ord from jsonb_array_elements(coalesce(g.dishes, '[]'::jsonb)) with ordinality as t(x, ord)
  ), ins as (
    insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, note, veg,
                          kitchen_id, barker, held_by, held_by_name, vip_guest_id)
    select p_event_id, p_table_number, p_cover_no, m.id, m.name, m.course, 1,
           nullif(btrim(coalesce(s.x->>'note', '')), ''), m.is_veg,
           r.kitchen_id, r.barker, p_captain_id, v_cap, g.id
      from src s
      join menu_items m on m.id = (s.x->>'menu_item_id')::uuid
      cross join lateral ms_route(p_event_id, m.id) r
     where coalesce(m.is_available, true)
       and not exists (select 1 from ms_items i
                        where i.event_id = p_event_id and i.table_number = p_table_number
                          and i.cover_no = p_cover_no and i.menu_item_id = m.id
                          and i.vip_guest_id = g.id and i.state <> 'cancelled')
     order by s.ord
    returning id
  )
  select array_agg(id) into v_ids from ins;

  v_seat := ms_seat(p_event_id, p_table_number, array[p_cover_no], p_captain_id, true, true);

  return jsonb_build_object('vip', g.name, 'held', coalesce(cardinality(v_ids), 0),
                            'ids', to_jsonb(coalesce(v_ids, '{}'::uuid[])), 'seat', v_seat);
end $$;

-- The VIP leaves the cover (seated here by mistake, or the seat changes):
-- their dishes not fired yet are cancelled, the note and allergy go.
create or replace function ms_vip_clear(p_event_id uuid, p_table_number int, p_cover_no int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_vip uuid; v_n int := 0;
begin
  select vip_guest_id into v_vip from ms_covers
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no;
  if v_vip is not null then
    update ms_items set state = 'cancelled', cancelled_at = now()
     where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no
       and vip_guest_id = v_vip and state = 'held';
    get diagnostics v_n = row_count;
  end if;
  update ms_covers set vip_guest_id = null, guest_note = null, guest_allergy = null, vip_done = true
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no;
  return jsonb_build_object('cancelled', v_n);
end $$;

-- ---------------------------------------------------------------------
-- Delivered on the kitchen screen: one call (it used to take three), safe to
-- send again on a weak connection. Says which KOTs someone else had already
-- delivered; the barker's name goes on the ones delivered now.
-- ---------------------------------------------------------------------
create or replace function ms_deliver(p_kot_ids uuid[], p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_already jsonb;
begin
  perform 1 from kots where id = any(p_kot_ids) and kind = 'order' and status = 'open' for update;
  select coalesce(array_agg(id), '{}') into v_ids from kots
   where id = any(p_kot_ids) and kind = 'order' and status = 'open';
  select coalesce(jsonb_agg(kot_no), '[]'::jsonb) into v_already from kots
   where id = any(p_kot_ids) and kind = 'order' and status <> 'open';
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    perform ms_serve(v_ids, false);
    update kots set stage_by = coalesce(nullif(btrim(coalesce(p_by, '')), ''), stage_by) where id = any(v_ids);
  end if;
  return jsonb_build_object('delivered', coalesce(array_length(v_ids, 1), 0), 'already', v_already);
end $$;

grant execute on function ms_deliver(uuid[], text)                                 to anon, authenticated;
grant execute on function ms_hold(uuid, int, int, uuid, jsonb, text)               to anon, authenticated;
grant execute on function ms_fire(uuid, int, uuid[], uuid, text, boolean, boolean) to anon, authenticated;
grant execute on function ms_seat(uuid, int, int[], uuid, boolean, boolean)        to anon, authenticated;
grant execute on function ms_remake(uuid[], uuid, text)                            to anon, authenticated;
grant execute on function ms_item_note(uuid, text, text)                           to anon, authenticated;
grant execute on function ms_cover_guest(uuid, int, int, text, text)               to anon, authenticated;
grant execute on function ms_cover_reset(uuid, int, int)                           to anon, authenticated;
grant execute on function ms_vip_apply(uuid, int, int, uuid, uuid)                 to anon, authenticated;
grant execute on function ms_vip_clear(uuid, int, int)                             to anon, authenticated;

commit;

-- Ask the API to pick up the new table and functions straight away
notify pgrst, 'reload schema';

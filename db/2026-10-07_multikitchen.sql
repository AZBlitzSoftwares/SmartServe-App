-- =====================================================================
-- Captain Multi-Kitchen Service - database changes (v1, 7 Oct 2026)
--
-- ADDITIVE ONLY. New tables, new nullable/defaulted columns and new
-- functions. Nothing existing is renamed, dropped or changed in meaning,
-- so guest events and current captain events behave exactly as before.
--
-- Safe to run more than once. Runs as one transaction: if any line
-- fails, nothing is applied.
--
-- Run in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Event switch and chairs
-- ---------------------------------------------------------------------
alter table events add column if not exists multi_kitchen boolean not null default false;
alter table events add column if not exists chairs_per_table int not null default 10;

-- ---------------------------------------------------------------------
-- 2. Kitchens (one per cuisine, each with its own KOT printer)
-- ---------------------------------------------------------------------
create table if not exists kitchens (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  name                text not null,
  prefix              text not null,                 -- KOT series, e.g. IT -> IT-001
  printer_ip          text,                          -- e.g. 192.168.1.104
  printer_port        int  not null default 9100,
  backup_printer_ip   text,
  kot_seq             int  not null default 0,       -- last KOT number used
  sort_order          int  not null default 0,
  is_default          boolean not null default false,-- catches dishes with no kitchen mapped
  is_active           boolean not null default true,
  printer_status      text,                          -- online | offline | paper_out | paper_low | unknown
  printer_checked_at  timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists kitchens_event_idx on kitchens(event_id);

-- ---------------------------------------------------------------------
-- 3. Links: category/dish -> kitchen, captain -> table, waiter -> kitchen
-- ---------------------------------------------------------------------
alter table menu_categories add column if not exists kitchen_id uuid references kitchens(id) on delete set null;
alter table menu_items      add column if not exists kitchen_id uuid references kitchens(id) on delete set null; -- optional dish-level override
alter table captains        add column if not exists table_number int;   -- the table this captain serves
alter table waiters         add column if not exists kitchen_id uuid references kitchens(id) on delete set null;
alter table waiters         add column if not exists pin text;           -- 4-digit PIN for the waiter phone app

-- ---------------------------------------------------------------------
-- 4. Orders: chairs, and a note per dish (Jain, less spicy...)
-- ---------------------------------------------------------------------
alter table orders      add column if not exists chairs int[];
alter table orders      add column if not exists client_ref text;  -- one id per "Send", so a retry on a slow network never creates a second order
alter table order_items add column if not exists note text;
create unique index if not exists orders_client_ref_uq on orders(client_ref) where client_ref is not null;

-- ---------------------------------------------------------------------
-- 5. KOTs - one row per kitchen per order. Also used for test prints
--    and cancel slips. Items are a snapshot so the Print Hub and the
--    waiter phone need no joins.
-- ---------------------------------------------------------------------
create table if not exists kots (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  order_id           uuid references orders(id) on delete cascade,
  kitchen_id         uuid references kitchens(id) on delete set null,
  kind               text not null default 'order',   -- order | test | cancel
  kot_no             text,                            -- IT-014
  table_number       int,
  chairs             int[],
  captain_name       text,
  kitchen_name       text,
  items              jsonb not null default '[]'::jsonb,  -- [{name, qty, note, veg}]
  -- delivery life-cycle
  status             text not null default 'open',    -- open | delivered | cancelled
  delivered_at       timestamptz,
  delivered_by       uuid references waiters(id) on delete set null,
  delivered_by_name  text,
  cancelled_at       timestamptz,
  -- printing life-cycle
  print_status       text not null default 'queued',  -- queued | printing | printed | failed | skipped
  print_attempts     int  not null default 0,
  print_claimed_by   text,
  print_claimed_at   timestamptz,
  printer_ip         text,                            -- set only to redirect to another printer
  printed_at         timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists kots_event_print_idx   on kots(event_id, print_status);
create index if not exists kots_kitchen_status_idx on kots(kitchen_id, status);
create index if not exists kots_order_idx         on kots(order_id);

-- ---------------------------------------------------------------------
-- 6. Access - same open policy style as every other table in this app
-- ---------------------------------------------------------------------
alter table kitchens enable row level security;
alter table kots     enable row level security;

drop policy if exists kitchens_select on kitchens;
drop policy if exists kitchens_insert on kitchens;
drop policy if exists kitchens_update on kitchens;
drop policy if exists kitchens_delete on kitchens;
create policy kitchens_select on kitchens for select using (true);
create policy kitchens_insert on kitchens for insert with check (true);
create policy kitchens_update on kitchens for update using (true) with check (true);
create policy kitchens_delete on kitchens for delete using (true);

drop policy if exists kots_select on kots;
drop policy if exists kots_insert on kots;
drop policy if exists kots_update on kots;
drop policy if exists kots_delete on kots;
create policy kots_select on kots for select using (true);
create policy kots_insert on kots for insert with check (true);
create policy kots_update on kots for update using (true) with check (true);
create policy kots_delete on kots for delete using (true);

grant select, insert, update, delete on kitchens, kots to anon, authenticated;

-- Live updates for the captain, waiter phone, desk and Print Hub
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kots') then
      execute 'alter publication supabase_realtime add table public.kots';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kitchens') then
      execute 'alter publication supabase_realtime add table public.kitchens';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Place an order: one call does everything, in one transaction.
--    Order + dishes saved, split by kitchen, one KOT per kitchen with
--    that kitchen's next number. Returns the KOTs for the captain screen.
--    p_items: [{"menu_item_id": "...", "quantity": 2, "note": "Jain"}]
--    p_client_ref: the tablet's id for this Send. Sending again with the
--    same id (lost reply on a slow network) returns the first order instead
--    of creating a duplicate.
-- ---------------------------------------------------------------------
drop function if exists mk_place_order(uuid, int, uuid, int[], jsonb);
create or replace function mk_place_order(
  p_event_id uuid, p_table_number int, p_captain_id uuid, p_chairs int[], p_items jsonb,
  p_client_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table_id   uuid;
  v_order_id   uuid;
  v_captain    text;
  v_default    uuid;
  v_prefix     text;
  v_kname      text;
  v_seq        int;
  v_no         text;
  v_items      jsonb;
  v_out        jsonb := '[]'::jsonb;
  r            record;
begin
  if nullif(btrim(coalesce(p_client_ref, '')), '') is not null then
    select id into v_order_id from orders where client_ref = p_client_ref;
    if v_order_id is not null then
      return jsonb_build_object('order_id', v_order_id, 'duplicate', true, 'kots',
        coalesce((select jsonb_agg(jsonb_build_object('kitchen', k.kitchen_name, 'kot_no', k.kot_no,
                                                      'kitchen_id', k.kitchen_id) order by k.created_at)
                    from kots k where k.order_id = v_order_id and k.kind = 'order'), '[]'::jsonb));
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER: the cart is empty';
  end if;
  if p_chairs is null or cardinality(p_chairs) = 0 then
    raise exception 'NO_CHAIRS: select at least one chair';
  end if;
  if not exists (select 1 from kitchens where event_id = p_event_id and is_active) then
    raise exception 'NO_KITCHENS: no kitchens are set up for this event';
  end if;

  -- default kitchen for dishes whose category has no kitchen
  select id into v_default from kitchens
   where event_id = p_event_id and is_active
   order by is_default desc, sort_order, created_at limit 1;

  select id into v_table_id from tables
   where event_id = p_event_id and table_number = p_table_number limit 1;
  if v_table_id is null then
    insert into tables (event_id, table_number, is_active)
    values (p_event_id, p_table_number, true) returning id into v_table_id;
  end if;

  select name into v_captain from captains where id = p_captain_id;

  insert into orders (event_id, table_id, status, captain_id, chairs, client_ref)
  values (p_event_id, v_table_id, 'pending', p_captain_id,
          (select array_agg(distinct c order by c) from unnest(p_chairs) c),
          nullif(btrim(coalesce(p_client_ref, '')), ''))
  returning id into v_order_id;

  insert into order_items (order_id, menu_item_id, quantity, note)
  select v_order_id, (x->>'menu_item_id')::uuid, greatest(1, coalesce((x->>'quantity')::int, 1)),
         nullif(btrim(coalesce(x->>'note', '')), '')
    from jsonb_array_elements(p_items) x;

  for r in
    select coalesce(k_item.id, k_cat.id, v_default) as kitchen_id,
           jsonb_agg(jsonb_build_object('name', mi.name, 'qty', oi.quantity,
                                        'note', oi.note, 'veg', mi.is_veg)
                     order by mc.sort_order nulls last, mi.name) as items
      from order_items oi
      join menu_items mi on mi.id = oi.menu_item_id
      left join menu_categories mc on mc.id = mi.category_id
      left join kitchens k_item on k_item.id = mi.kitchen_id and k_item.is_active
      left join kitchens k_cat  on k_cat.id  = mc.kitchen_id and k_cat.is_active
     where oi.order_id = v_order_id
     group by 1
  loop
    update kitchens set kot_seq = kot_seq + 1
     where id = r.kitchen_id
     returning kot_seq, prefix, name into v_seq, v_prefix, v_kname;
    v_no := upper(coalesce(nullif(v_prefix, ''), 'K')) || '-' || lpad(v_seq::text, 3, '0');

    insert into kots (event_id, order_id, kitchen_id, kind, kot_no, table_number, chairs,
                      captain_name, kitchen_name, items)
    values (p_event_id, v_order_id, r.kitchen_id, 'order', v_no, p_table_number,
            (select array_agg(distinct c order by c) from unnest(p_chairs) c),
            v_captain, v_kname, r.items);

    v_out := v_out || jsonb_build_object('kitchen', v_kname, 'kot_no', v_no, 'kitchen_id', r.kitchen_id);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'kots', v_out);
end $$;

-- ---------------------------------------------------------------------
-- 8. Keep the order's status in step with its KOTs
--    all KOTs delivered (or cancelled) -> order delivered
--    a delivery undone                 -> order open again
-- ---------------------------------------------------------------------
create or replace function mk_sync_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_open int; v_done int;
begin
  if new.order_id is null or new.kind <> 'order' then return new; end if;
  select count(*) filter (where status = 'open'),
         count(*) filter (where status = 'delivered')
    into v_open, v_done
    from kots where order_id = new.order_id and kind = 'order';

  if v_open = 0 and v_done > 0 then
    update orders set status = 'delivered', delivered_at = coalesce(delivered_at, now())
     where id = new.order_id and status not in ('delivered', 'cancelled');
  elsif v_open > 0 then
    update orders set status = 'pending', delivered_at = null
     where id = new.order_id and status = 'delivered';
  end if;
  return new;
end $$;

drop trigger if exists kots_sync_order on kots;
create trigger kots_sync_order after update of status on kots
  for each row when (old.status is distinct from new.status)
  execute function mk_sync_order_status();

create or replace function mk_touch_kot() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists kots_touch on kots;
create trigger kots_touch before update on kots for each row execute function mk_touch_kot();

-- ---------------------------------------------------------------------
-- 9. Order cancelled -> its open KOTs are cancelled, and every kitchen
--    that already printed one gets a CANCEL slip.
-- ---------------------------------------------------------------------
create or replace function mk_on_order_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into kots (event_id, order_id, kitchen_id, kind, kot_no, table_number, chairs,
                    captain_name, kitchen_name, items, status)
  select k.event_id, k.order_id, k.kitchen_id, 'cancel', k.kot_no, k.table_number, k.chairs,
         k.captain_name, k.kitchen_name, k.items, 'cancelled'
    from kots k
   where k.order_id = new.id and k.kind = 'order' and k.status = 'open'
     and k.print_status in ('printing', 'printed');

  update kots set status = 'cancelled', cancelled_at = now(),
                  -- never print a KOT for an order that is already cancelled
                  print_status = case when print_status in ('queued', 'failed') then 'skipped' else print_status end
   where order_id = new.id and kind = 'order' and status = 'open';
  return new;
end $$;

drop trigger if exists orders_mk_cancel on orders;
create trigger orders_mk_cancel after update of status on orders
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function mk_on_order_cancel();

-- ---------------------------------------------------------------------
-- 10. Waiter phone: sign-in (PIN checked here, never sent to the phone),
--     mark delivered, undo within 2 minutes
-- ---------------------------------------------------------------------
create or replace function mk_waiter_login(p_event_id uuid, p_name text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select wt.id, wt.name, wt.waiter_number, wt.kitchen_id, k.name as kitchen_name
    into w
    from waiters wt left join kitchens k on k.id = wt.kitchen_id
   where wt.event_id = p_event_id and wt.is_active
     and coalesce(wt.pin, '') <> '' and wt.pin = btrim(p_pin)
     and (lower(btrim(wt.name)) = lower(btrim(p_name))
          -- names are stored as "Ravi (07)": the bare name works too
          or lower(btrim(regexp_replace(wt.name, '\s*\([^)]*\)\s*$', ''))) = lower(btrim(p_name))
          -- waiter number with or without leading zeros: "07" or "7"
          or (coalesce(wt.waiter_number::text, '') <> ''
              and (lower(btrim(wt.waiter_number::text)) = lower(btrim(p_name))
                   or (btrim(p_name) ~ '^[0-9]+$' and btrim(wt.waiter_number::text) ~ '^[0-9]+$'
                       and btrim(wt.waiter_number::text)::bigint = btrim(p_name)::bigint))))
   limit 1;
  if w.id is null then return null; end if;
  return jsonb_build_object('id', w.id, 'name', w.name, 'waiter_number', w.waiter_number,
                            'kitchen_id', w.kitchen_id, 'kitchen_name', w.kitchen_name);
end $$;

create or replace function mk_mark_delivered(p_kot_id uuid, p_waiter_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_row kots;
begin
  select name into v_name from waiters where id = p_waiter_id;
  update kots set status = 'delivered', delivered_at = now(),
                  delivered_by = p_waiter_id, delivered_by_name = coalesce(v_name, 'Desk')
   where id = p_kot_id and kind = 'order' and status = 'open'
   returning * into v_row;
  if v_row.id is null then
    select * into v_row from kots where id = p_kot_id;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function mk_undo_delivered(p_kot_id uuid, p_waiter_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row kots;
begin
  update kots set status = 'open', delivered_at = null, delivered_by = null, delivered_by_name = null
   where id = p_kot_id and status = 'delivered'
     and (p_waiter_id is null or delivered_by = p_waiter_id)
     and delivered_at > now() - interval '2 minutes'
   returning * into v_row;
  if v_row.id is null then select * into v_row from kots where id = p_kot_id; end if;
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- 11. Print Hub: claim jobs (two laptops can never print the same KOT),
--     report the result, report printer health
-- ---------------------------------------------------------------------
create or replace function hub_claim_kots(p_event_id uuid, p_hub text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select k.id from kots k
     where k.event_id = p_event_id
       and (k.print_status = 'queued'
            or (k.print_status = 'printing' and k.print_claimed_at < now() - interval '45 seconds'))
     order by k.created_at
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  ), upd as (
    update kots k set print_status = 'printing', print_claimed_by = p_hub,
                      print_claimed_at = now(), print_attempts = k.print_attempts + 1
      from picked where k.id = picked.id
    returning k.*
  )
  select coalesce(jsonb_agg(to_jsonb(u) || jsonb_build_object(
           'target_ip',   coalesce(nullif(u.printer_ip, ''), kt.printer_ip),
           'target_port', coalesce(kt.printer_port, 9100),
           'backup_ip',   kt.backup_printer_ip,
           'event_name',  e.name) order by u.created_at), '[]'::jsonb)
    into v
    from upd u
    left join kitchens kt on kt.id = u.kitchen_id
    left join events e on e.id = u.event_id;
  return v;
end $$;

create or replace function hub_report(p_kot_id uuid, p_ok boolean, p_error text, p_hub text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update kots set print_status = 'printed', printed_at = now(), last_error = null
     where id = p_kot_id;
  else
    update kots set print_status = 'failed', last_error = left(coalesce(p_error, 'print failed'), 300)
     where id = p_kot_id;
  end if;
end $$;

-- Printer health, per printer = IP + port. Several printers can share one
-- IP (Virtual Printers on one laptop, a print server with several ports),
-- so with p_printer_port only the kitchens on that exact printer change.
-- Read like the Print Hub reads it: an IP field written "ip:port" means
-- that port; otherwise the kitchen's printer_port. A KOT's printer is its
-- redirect (kots.printer_ip, may be "ip:port") or else its kitchen's IP,
-- with the kitchen's port. p_printer_port null = old match on the IP text.
-- (The old 3-argument version is dropped so the API never sees two.)
drop function if exists hub_printer_status(uuid, text, text);
create or replace function hub_printer_status(p_event_id uuid, p_printer_ip text, p_status text,
                                              p_printer_port int default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_requeued int := 0;
  v_ip       text := btrim(p_printer_ip, E' \t\r\n');
begin
  if p_printer_port is null then
    update kitchens set printer_status = p_status, printer_checked_at = now()
     where event_id = p_event_id and printer_ip = p_printer_ip;
  else
    update kitchens set printer_status = p_status, printer_checked_at = now()
     where id in (
       select kt.id
         from kitchens kt
        cross join lateral (select btrim(kt.printer_ip, E' \t\r\n') as s) t
        where kt.event_id = p_event_id
          and case when t.s ~ '^[^:\s]+:[0-9]{1,5}$' then split_part(t.s, ':', 1) else t.s end = v_ip
          and case when t.s ~ '^[^:\s]+:[0-9]{1,5}$' then split_part(t.s, ':', 2)::int
                   else coalesce(nullif(kt.printer_port, 0), 9100) end = p_printer_port);
  end if;
  -- printer is back (paper low still prints): anything that failed on it goes out again by itself
  if p_status in ('online', 'paper_low') then
    update kots set print_status = 'queued', last_error = null
     where id in (
       select k.id
         from kots k
         join kitchens kt on kt.id = k.kitchen_id
        cross join lateral (select btrim(coalesce(nullif(k.printer_ip, ''), kt.printer_ip), E' \t\r\n') as s) t
        where k.event_id = p_event_id
          and k.print_status = 'failed' and not (k.kind = 'order' and k.status = 'cancelled')
          and case when p_printer_port is null
                   then coalesce(nullif(k.printer_ip, ''), kt.printer_ip) = p_printer_ip
                   else case when t.s ~ '^[^:\s]+:[0-9]{1,5}$' then split_part(t.s, ':', 1) else t.s end = v_ip
                    and case when t.s ~ '^[^:\s]+:[0-9]{1,5}$' then split_part(t.s, ':', 2)::int
                             else coalesce(nullif(kt.printer_port, 0), 9100) end = p_printer_port
              end);
    get diagnostics v_requeued = row_count;
  end if;
  return v_requeued;
end $$;

grant execute on function mk_place_order(uuid, int, uuid, int[], jsonb, text) to anon, authenticated;
grant execute on function mk_waiter_login(uuid, text, text)            to anon, authenticated;
grant execute on function mk_mark_delivered(uuid, uuid)                to anon, authenticated;
grant execute on function mk_undo_delivered(uuid, uuid)                to anon, authenticated;
grant execute on function hub_claim_kots(uuid, text, int)              to anon, authenticated;
grant execute on function hub_report(uuid, boolean, text, text)        to anon, authenticated;
grant execute on function hub_printer_status(uuid, text, text, int)    to anon, authenticated;

commit;

-- Ask the API to pick up the new tables and functions straight away
notify pgrst, 'reload schema';

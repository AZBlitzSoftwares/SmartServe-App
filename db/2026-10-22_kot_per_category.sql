-- =====================================================================
-- One KOT per category (Guest Self-Service and Captain Service events).
-- Additive and safe to run twice; events without the switch work exactly as
-- before (one order card, one KOT printed at the desk).
--
-- With "One KOT per category" on (Control › KOT printing):
--   * every order is split into one KOT per menu category (Starters, Mains,
--     Desserts ...), each with its own number, waiter and Delivered;
--   * a category is linked to one of the event's printers (kitchens table:
--     name, KOT letters, printer address). Its KOTs print there through the
--     Print Hub when the desk assigns a waiter; a category without a printer
--     (or an event with no printers) prints at the desk, as today;
--   * the order turns "Waiter on the way" when its first KOT is assigned and
--     Delivered when all its KOTs are delivered (cancelled ones aside).
-- =====================================================================

alter table events add column if not exists kot_per_category boolean not null default false;

alter table kots add column if not exists category_id   uuid references menu_categories(id) on delete set null;
alter table kots add column if not exists category_name text;
alter table kots add column if not exists waiter_id     uuid references waiters(id) on delete set null;
alter table kots add column if not exists waiter_label  text;          -- the number on the slip ("07")
alter table kots add column if not exists assigned_at   timestamptz;
create index if not exists kots_order_cat_idx on kots(order_id, category_id);
-- print_status 'held': the KOT waits for its waiter; 'desk': printed at the desk (no printer)

-- ---------------------------------------------------------------------
-- 1. New dishes on an order -> one KOT per category (statement trigger,
--    so it works for every way an order is saved: tablet, captain, the
--    tablet's offline queue, the laptop server)
-- ---------------------------------------------------------------------
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
    select ni.order_id, o.event_id, mi.category_id, coalesce(nullif(btrim(c.name), ''), 'Other') as cat_name,
           c.kitchen_id as cat_kitchen,
           jsonb_agg(jsonb_build_object(
             'name', mi.name || case when coalesce(mi.is_live_counter, false) then ' [LIVE]' else '' end,
             'qty', ni.quantity, 'note', ni.note, 'veg', mi.is_veg) order by mi.name) as items,
           min(c.sort_order) as srt
      from new_rows ni
      join orders o     on o.id = ni.order_id
      join events e     on e.id = o.event_id
      join menu_items mi on mi.id = ni.menu_item_id
      left join menu_categories c on c.id = mi.category_id
     where coalesce(e.kot_per_category, false) and not coalesce(e.multi_kitchen, false)
       and not coalesce(e.maestro, false) and o.status <> 'cancelled'
     group by ni.order_id, o.event_id, mi.category_id, c.name, c.kitchen_id
     order by ni.order_id, min(c.sort_order) nulls last
  loop
    -- dishes added to an order whose KOT for this category has no waiter yet: same KOT
    v_id := null;
    update kots set items = items || r.items
     where order_id = r.order_id and kind = 'order' and status = 'open' and print_status = 'held'
       and category_id is not distinct from r.category_id
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

-- ---------------------------------------------------------------------
-- 2. The desk assigns a waiter to a KOT: the KOT goes to its printer
--    (Print Hub) or is printed at the desk. Returns where it prints.
-- ---------------------------------------------------------------------
create or replace function ss_kot_assign(p_kot_id uuid, p_waiter_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k       kots;
  v_label text;
  v_hub   boolean;
begin
  select * into k from kots where id = p_kot_id;
  if k.id is null then raise exception 'NO_KOT: this KOT is not there any more'; end if;
  if k.status <> 'open' then raise exception 'KOT_CLOSED: this KOT is already %', k.status; end if;

  select coalesce(nullif(btrim(w.waiter_number), ''), substring(w.name from '\(([^)]+)\)\s*$'), w.name)
    into v_label from waiters w where w.id = p_waiter_id;

  select coalesce(nullif(btrim(coalesce(kt.printer_ip, '')), '') is not null
               or nullif(btrim(coalesce(kt.cloud_print_id, '')), '') is not null, false)
    into v_hub from kitchens kt where kt.id = k.kitchen_id and kt.is_active;
  v_hub := coalesce(v_hub, false);

  update kots set waiter_id = p_waiter_id, waiter_label = v_label,
                  assigned_at = case when waiter_id is distinct from p_waiter_id or assigned_at is null then now() else assigned_at end,
                  -- first assignment: print now; a change of waiter: print again with the new number
                  print_status = case when v_hub then 'queued' else 'desk' end,
                  print_attempts = 0, last_error = null
   where id = p_kot_id;

  -- the order: "waiter on the way" from its first assigned KOT
  update orders set status = 'in_progress', waiter_id = coalesce(waiter_id, p_waiter_id),
                    assigned_at = coalesce(assigned_at, now())
   where id = k.order_id and status in ('pending', 'placed');

  return jsonb_build_object('print', case when v_hub then 'hub' else 'desk' end, 'kot_no', k.kot_no, 'waiter', v_label);
end $$;

-- ---------------------------------------------------------------------
-- 3. Delivered / cancel one KOT (the order follows: all delivered ->
--    delivered, by the existing kots_sync_order trigger; all cancelled ->
--    cancelled, below)
-- ---------------------------------------------------------------------
create or replace function ss_kot_deliver(p_kot_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update kots set status = 'delivered', delivered_at = now(), delivered_by = waiter_id,
                  delivered_by_name = waiter_label
   where id = p_kot_id and status = 'open';
end $$;

create or replace function ss_kot_cancel(p_kot_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k kots;
begin
  select * into k from kots where id = p_kot_id and status = 'open';
  if k.id is null then return; end if;
  -- already printed on a kitchen printer: a CANCEL slip there
  if k.print_status in ('printing', 'printed') and k.kitchen_id is not null then
    insert into kots (event_id, order_id, kitchen_id, kind, kot_no, table_number, captain_name, kitchen_name,
                      items, category_id, category_name, waiter_label, status)
    values (k.event_id, k.order_id, k.kitchen_id, 'cancel', k.kot_no, k.table_number, k.captain_name, k.kitchen_name,
            k.items, k.category_id, k.category_name, k.waiter_label, 'cancelled');
  end if;
  update kots set status = 'cancelled', cancelled_at = now(),
                  print_status = case when print_status in ('held', 'queued', 'failed') then 'skipped' else print_status end
   where id = p_kot_id;
end $$;

create or replace function ss_cat_kot_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_open int; v_done int; v_off int;
begin
  if new.order_id is null or new.kind <> 'order' or new.category_id is null and new.category_name is null then return new; end if;
  select count(*) filter (where status = 'open'), count(*) filter (where status = 'delivered'),
         count(*) filter (where status = 'cancelled')
    into v_open, v_done, v_off
    from kots where order_id = new.order_id and kind = 'order';
  if v_open = 0 and v_done = 0 and v_off > 0 then
    update orders set status = 'cancelled', cancel_reason = coalesce(cancel_reason, 'All KOTs cancelled')
     where id = new.order_id and status not in ('delivered', 'cancelled');
  end if;
  return new;
end $$;

drop trigger if exists kots_cat_sync on kots;
create trigger kots_cat_sync after update of status on kots
  for each row when (old.status is distinct from new.status and new.status = 'cancelled')
  execute function ss_cat_kot_sync();

-- Print again: on the kitchen printer (Print Hub) - the desk prints its own
create or replace function ss_kot_reprint(p_kot_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare k kots; v_hub boolean;
begin
  select * into k from kots where id = p_kot_id;
  if k.id is null then return 'none'; end if;
  select coalesce(nullif(btrim(coalesce(kt.printer_ip, '')), '') is not null
               or nullif(btrim(coalesce(kt.cloud_print_id, '')), '') is not null, false)
    into v_hub from kitchens kt where kt.id = k.kitchen_id and kt.is_active;
  if coalesce(v_hub, false) then
    update kots set print_status = 'queued', print_attempts = 0, last_error = null where id = p_kot_id;
    return 'hub';
  end if;
  return 'desk';
end $$;

grant execute on function ss_kot_assign(uuid, uuid)  to anon, authenticated;
grant execute on function ss_kot_deliver(uuid)       to anon, authenticated;
grant execute on function ss_kot_cancel(uuid)        to anon, authenticated;
grant execute on function ss_kot_reprint(uuid)       to anon, authenticated;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows)
select 'One KOT per category' as change,
       case when exists (select 1 from information_schema.columns where table_name = 'events' and column_name = 'kot_per_category')
             and exists (select 1 from pg_trigger where tgname = 'order_items_cat_kots')
             and exists (select 1 from pg_proc where proname = 'ss_kot_assign')
            then 'OK' else 'NOT APPLIED' end as status;

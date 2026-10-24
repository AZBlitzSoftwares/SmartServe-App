-- =====================================================================
-- Assign waiters automatically (Guest Self-Service and Captain Service).
-- Additive and safe to run twice. Events with the switch off work exactly
-- as before: the desk picks the waiter.
--
-- With "Assign waiters automatically" on (Control › Waiters):
--   * each new KOT (one per category, or one per order when "One KOT per
--     category" is off) and each help request gets a waiter by itself;
--   * the waiter chosen is the least busy one: fewest open jobs (KOTs,
--     orders and help requests not yet delivered / resolved), then the one
--     whose last job was longest ago, then the lowest waiter number. Two
--     categories of the same order therefore go to two different runners;
--   * it runs on ONE desk only - the desk where the switch was turned on
--     (events.auto_assign_device). That desk prints the KOTs, exactly as if
--     its operator had assigned them, so printing stays on one system.
--     Several events can run on the same desk (guest + captain on one laptop).
--   * the desk can still change a waiter by hand at any time.
-- =====================================================================

alter table events add column if not exists auto_assign_waiter boolean not null default false;
alter table events add column if not exists auto_assign_device text;   -- device id of the desk that assigns and prints

-- ---------------------------------------------------------------------
-- The least busy active waiter of an event (null when it has none)
-- ---------------------------------------------------------------------
create or replace function ss_pick_waiter(p_event_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select w.id
    from waiters w
   where w.event_id = p_event_id and w.is_active
   order by
     -- open jobs
     (select count(*) from kots k
       where k.waiter_id = w.id and k.kind = 'order' and k.status = 'open')
   + (select count(*) from orders o
       where o.waiter_id = w.id and o.status = 'in_progress'
         and not exists (select 1 from kots k2 where k2.order_id = o.id and k2.kind = 'order'))
   + (select count(*) from sos_requests s
       where s.waiter_id = w.id and s.status in ('in_progress', 'acknowledged')) asc,
     -- longest since the last job
     greatest(
       coalesce((select max(k.assigned_at) from kots k where k.waiter_id = w.id), '-infinity'::timestamptz),
       coalesce((select max(o.assigned_at) from orders o where o.waiter_id = w.id), '-infinity'::timestamptz),
       coalesce((select max(s.assigned_at) from sos_requests s where s.waiter_id = w.id), '-infinity'::timestamptz)) asc,
     -- then 01, 02, 03 ...
     case when btrim(coalesce(w.waiter_number, '')) ~ '^[0-9]+$' then btrim(w.waiter_number)::int end nulls last,
     w.name
   limit 1
$$;

-- ---------------------------------------------------------------------
-- One category KOT: assigned only if it still has no waiter (so two desks,
-- or a desk and a person, can never both assign it). Returns what
-- ss_kot_assign returns ({print, kot_no, waiter}), or null when skipped.
-- ---------------------------------------------------------------------
create or replace function ss_auto_assign_kot(p_kot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k    kots;
  v_on boolean;
  v_w  uuid;
begin
  select * into k from kots where id = p_kot_id for update;
  if k.id is null or k.kind <> 'order' or k.status <> 'open' or k.waiter_id is not null then return null; end if;
  select auto_assign_waiter into v_on from events where id = k.event_id;
  if not coalesce(v_on, false) then return null; end if;
  v_w := ss_pick_waiter(k.event_id);
  if v_w is null then return null; end if;
  return ss_kot_assign(p_kot_id, v_w);
end $$;

-- ---------------------------------------------------------------------
-- A whole order ("One KOT per category" off): same rule. Returns the
-- waiter id, or null when skipped.
-- ---------------------------------------------------------------------
create or replace function ss_auto_assign_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o    orders;
  v_on boolean;
  v_w  uuid;
begin
  select * into o from orders where id = p_order_id for update;
  if o.id is null or o.waiter_id is not null or o.status not in ('pending', 'placed') then return null; end if;
  -- an order split into category KOTs is assigned KOT by KOT
  if exists (select 1 from kots where order_id = o.id and kind = 'order') then return null; end if;
  select auto_assign_waiter into v_on from events where id = o.event_id;
  if not coalesce(v_on, false) then return null; end if;
  v_w := ss_pick_waiter(o.event_id);
  if v_w is null then return null; end if;
  update orders set status = 'in_progress', waiter_id = v_w, assigned_at = now() where id = o.id;
  return v_w;
end $$;

-- ---------------------------------------------------------------------
-- A help request: same rule. Returns the waiter id, or null when skipped.
-- ---------------------------------------------------------------------
create or replace function ss_auto_assign_sos(p_sos_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s    sos_requests;
  v_on boolean;
  v_w  uuid;
begin
  select * into s from sos_requests where id = p_sos_id for update;
  if s.id is null or s.waiter_id is not null or s.status not in ('open', 'acknowledged') then return null; end if;
  select auto_assign_waiter into v_on from events where id = s.event_id;
  if not coalesce(v_on, false) then return null; end if;
  v_w := ss_pick_waiter(s.event_id);
  if v_w is null then return null; end if;
  update sos_requests set status = 'in_progress', waiter_id = v_w, assigned_at = now() where id = s.id;
  return v_w;
end $$;

grant execute on function ss_pick_waiter(uuid)       to anon, authenticated;
grant execute on function ss_auto_assign_kot(uuid)   to anon, authenticated;
grant execute on function ss_auto_assign_order(uuid) to anon, authenticated;
grant execute on function ss_auto_assign_sos(uuid)   to anon, authenticated;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): the two new columns
select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'events' and column_name in ('auto_assign_waiter', 'auto_assign_device');

-- =====================================================================
-- Place an order exactly once (guest tablets and captain tablets).
-- Additive and safe to run twice. Run it in the Supabase SQL Editor; the
-- Offline Kit applies the same file on the event laptop at Prepare Event.
--
-- Why: on a slow network a tablet sent the same order again and again
-- (Place Order tapped while the first send was still on its way, and the
-- offline queue re-sending), so one table got 10-24 copies of one order and
-- the order limit was passed (every copy was checked before any was saved).
--
-- ss_place_order(p_order_id, ...) - the tablet makes the order id ONCE, when
-- Place Order is tapped, and sends that same id on every retry:
--   * an id already saved is answered "ok, repeat" and nothing is added;
--   * the order and all its dishes are saved together (all or nothing), so
--     KOTs come out exactly as before (the order_items trigger);
--   * the order limit is checked here, with the table locked, so two sends
--     at the same moment cannot both pass it. Answer: {ok:false, reason:'LIMIT'}.
-- =====================================================================

create or replace function ss_place_order(
  p_order_id   uuid,
  p_event_id   uuid,
  p_table_id   uuid,
  p_items      jsonb,               -- [{menu_item_id, quantity, note?}]
  p_captain_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit int;
  v_live  int;
begin
  if p_order_id is null or p_event_id is null or p_table_id is null then
    return jsonb_build_object('ok', false, 'reason', 'BAD_REQUEST');
  end if;

  -- the same order sent again (double tap, retry, offline queue): nothing new
  if exists (select 1 from orders where id = p_order_id) then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'repeat', true);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY');
  end if;

  -- one order at a time per table: the limit check and the save cannot interleave
  perform 1 from tables where id = p_table_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_TABLE');
  end if;

  -- a copy that arrived while this one waited for the table
  if exists (select 1 from orders where id = p_order_id) then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'repeat', true);
  end if;

  -- 0 = no limit; empty = the default of 1 (as the tablet reads it)
  select coalesce(max_orders_per_table, 1) into v_limit from events where id = p_event_id;
  if coalesce(v_limit, 0) > 0 then
    select count(*) into v_live from orders
     where table_id = p_table_id and status in ('pending', 'placed', 'in_progress');
    if v_live >= v_limit then
      return jsonb_build_object('ok', false, 'reason', 'LIMIT', 'limit', v_limit, 'live', v_live);
    end if;
  end if;

  begin
    insert into orders (id, event_id, table_id, status, captain_id)
    values (p_order_id, p_event_id, p_table_id, 'pending', p_captain_id);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'repeat', true);
  end;

  insert into order_items (order_id, menu_item_id, quantity, note)
  select p_order_id, (x->>'menu_item_id')::uuid, greatest(1, coalesce((x->>'quantity')::int, 1)), nullif(btrim(coalesce(x->>'note', '')), '')
    from jsonb_array_elements(p_items) x
   where nullif(x->>'menu_item_id', '') is not null;

  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end $$;

grant execute on function ss_place_order(uuid, uuid, uuid, jsonb, uuid) to anon, authenticated;

-- Speeds up the order-limit count and the desk's "active orders" list
create index if not exists orders_table_status_idx on orders (table_id, status);
create index if not exists orders_event_status_idx on orders (event_id, status);
create index if not exists kots_event_status_idx on kots (event_id, kind, status);

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows)
select 'Place order once' as change,
       case when exists (select 1 from pg_proc where proname = 'ss_place_order') then 'OK' else 'NOT APPLIED' end as status;

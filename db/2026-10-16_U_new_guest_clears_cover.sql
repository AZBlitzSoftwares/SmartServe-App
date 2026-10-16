-- =====================================================================
-- New guest clears the cover: the previous guest's dishes not picked up are
-- removed (as before) AND their dishes picked up but not delivered are voided
-- (a VOID slip prints in the kitchen, the KOT leaves the kitchen screen).
-- Delivered dishes stay in the records. Same function, same arguments: the
-- tablets need no other change to use it. Safe to run twice.
-- Back to the old behaviour: 2026-10-13_maestro_v2.sql has the old function.
-- =====================================================================
create or replace function ms_cover_reset(p_event_id uuid, p_table_number int, p_cover_no int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n    int;
  v_ids  uuid[];
  v_void jsonb;
begin
  update ms_covers set guest_note = null, guest_allergy = null, vip_guest_id = null, vip_done = true
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no;
  update ms_items set state = 'cancelled', cancelled_at = now()
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no and state = 'held';
  get diagnostics v_n = row_count;

  -- the previous guest's dishes still in the kitchen: voided like the desk's Void
  select array_agg(id) into v_ids from ms_items
   where event_id = p_event_id and table_number = p_table_number and cover_no = p_cover_no
     and state = 'fired' and served_at is null;
  if v_ids is not null then
    v_void := ms_cancel(v_ids, null);
  end if;

  return jsonb_build_object('cancelled', v_n, 'voided', coalesce((v_void ->> 'fired')::int, 0));
end $$;
grant execute on function ms_cover_reset(uuid, int, int) to anon, authenticated;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): the new New guest is in place
select 'New guest voids the dishes still in the kitchen' as change,
       case when pg_get_functiondef('ms_cover_reset(uuid,int,int)'::regprocedure) like '%ms_cancel(v_ids%' then 'OK' else 'NOT APPLIED' end as status;

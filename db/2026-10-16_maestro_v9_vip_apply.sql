-- =====================================================================
-- Smart Serve Maestro: seating a VIP guest adds no dishes to the order (the
-- captain's tablet shows the guest's own menu). The function part of
-- events/2026-10-16_maestro_v9_vip_menus.sql (already run on the cloud on
-- 16 Oct), kept here on its own so every laptop database gets it too.
-- Safe to run again: the same definition.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Seating a VIP guest: the guest on the cover, nothing added to the order
-- ---------------------------------------------------------------------
create or replace function ms_vip_apply(p_event_id uuid, p_table_number int, p_cover_no int,
                                        p_vip_id uuid, p_captain_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g        ms_vip_guests;
  v_note   text;
  v_seat   jsonb;
begin
  select * into g from ms_vip_guests where id = p_vip_id and event_id = p_event_id and is_active;
  if g.id is null then raise exception 'NO_VIP: this VIP guest is not on the list'; end if;
  if p_cover_no is null or p_cover_no < 1 then raise exception 'NO_COVER: choose the cover first'; end if;

  -- one cover at a time: a guest moved to another cover leaves the old one
  update ms_items set state = 'cancelled', cancelled_at = now()
   where event_id = p_event_id and vip_guest_id = g.id and state = 'held'
     and not (table_number = p_table_number and cover_no = p_cover_no);
  update ms_covers set vip_guest_id = null, guest_note = null, guest_allergy = null
   where event_id = p_event_id and vip_guest_id = g.id
     and not (table_number = p_table_number and cover_no = p_cover_no);

  v_note := nullif(concat_ws(', ', nullif(btrim(coalesce(g.notes, '')), ''),
                             case when nullif(btrim(coalesce(g.likes, '')), '') is not null
                                  then 'Likes: ' || replace(btrim(g.likes), ',', ' /') end,
                             case when nullif(btrim(coalesce(g.dislikes, '')), '') is not null
                                  then 'Dislikes: ' || replace(btrim(g.dislikes), ',', ' /') end), '');

  insert into ms_covers (event_id, table_number, cover_no, guest_note, guest_allergy, vip_guest_id, vip_done)
  values (p_event_id, p_table_number, p_cover_no, v_note, nullif(btrim(coalesce(g.allergies, '')), ''), g.id, true)
  on conflict (event_id, table_number, cover_no)
  do update set guest_note = excluded.guest_note, guest_allergy = excluded.guest_allergy,
                vip_guest_id = excluded.vip_guest_id, vip_done = true;

  -- (no dishes are added: the captain's tablet shows the guest's own menu)
  v_seat := ms_seat(p_event_id, p_table_number, array[p_cover_no], p_captain_id, true, true);

  return jsonb_build_object('vip', g.name, 'held', 0, 'ids', '[]'::jsonb, 'seat', v_seat);
end $$;

grant execute on function ms_vip_apply(uuid, int, int, uuid, uuid) to anon, authenticated;


-- =====================================================================
-- Smart Serve Maestro v4: allergy for one VIP dish. Run after 2026-10-13_maestro_v3.sql.
-- Safe to run twice; the app already live keeps working after it.
--
-- A VIP guest's preferred dish can now carry its own allergy (Event set-up ›
-- VIP guests, "Allergy for this dish", kept in ms_vip_guests.dishes as
-- {menu_item_id, note, allergy}). When the captain seats the VIP guest, the dish
-- is added to the cover with that allergy, and its KOT prints it on a black band.
-- Only ms_vip_apply changes; no table changes.
-- =====================================================================

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

  -- one comma between the parts (the tablet shows each part as its own chip); a list of
  -- likes or dislikes stays in one chip: "Likes: Mild Italian / thin-crust pizza"
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

  with src as (
    select x, ord from jsonb_array_elements(coalesce(g.dishes, '[]'::jsonb)) with ordinality as t(x, ord)
  ), ins as (
    insert into ms_items (event_id, table_number, cover_no, menu_item_id, name, course, qty, note, allergy, veg,
                          kitchen_id, barker, held_by, held_by_name, vip_guest_id)
    select p_event_id, p_table_number, p_cover_no, m.id, m.name, m.course, 1,
           nullif(btrim(coalesce(s.x->>'note', '')), ''), nullif(btrim(coalesce(s.x->>'allergy', '')), ''), m.is_veg,
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

grant execute on function ms_vip_apply(uuid, int, int, uuid, uuid) to anon, authenticated;

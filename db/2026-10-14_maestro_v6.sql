-- =====================================================================
-- Smart Serve Maestro v6: virtual printers, and one printing laptop per event.
-- Run after 2026-10-13_maestro_v5_cloud_print.sql. Additive and safe to run twice.
--
-- 1. Virtual printers in the cloud, for demos and training, with nothing to
--    start on any laptop: a kitchen whose printer is VIRTUAL-1 … VIRTUAL-5
--    (Event set-up › Kitchens & printers › Edit › Printer) has every KOT
--    "printed" the moment it is made, and the slip shows on the Virtual
--    printers screen (/printers?event=…) like on real paper. Reprint and Test
--    print work the same way.
--
-- 2. One printing laptop per event. Many laptops and tablets may run the
--    Control Desk and the set-up at the same time; only one of them prints.
--    The laptop (Print from this laptop, or a Print Hub) that is printing
--    holds the event while it keeps working (print_stations). Another laptop
--    cannot switch printing on while that one answers; it can take printing
--    over only with an admin PIN. A printing laptop that has been silent for
--    90 seconds (switched off, asleep, out of Wi-Fi) can be replaced without
--    the PIN, so a dead laptop never blocks the event.
-- =====================================================================

-- A KOT for a kitchen on a virtual printer is printed at once
create or replace function kots_virtual_print() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kit text;
  v_kot text := upper(btrim(coalesce(new.printer_ip, '')));
begin
  if new.kitchen_id is null or new.print_status not in ('queued', 'failed') then return new; end if;
  if tg_op = 'UPDATE' and new.print_status is not distinct from old.print_status then return new; end if;
  select upper(btrim(coalesce(printer_ip, ''))) into v_kit from kitchens where id = new.kitchen_id;
  -- a KOT sent to another printer (redirect) follows that printer
  if v_kot <> '' then
    if v_kot !~ '^VIRTUAL-[0-9]+$' then return new; end if;
  elsif coalesce(v_kit, '') !~ '^VIRTUAL-[0-9]+$' then
    return new;
  end if;
  new.print_status := 'printed';
  new.printed_at := now();
  new.print_claimed_by := 'virtual';
  new.print_claimed_at := now();
  new.last_error := null;
  update kitchens set printer_status = 'online', printer_checked_at = now()
   where id = new.kitchen_id
     and (printer_status is distinct from 'online' or printer_checked_at is null or printer_checked_at < now() - interval '30 seconds');
  return new;
end $$;

drop trigger if exists kots_virtual_print on kots;
create trigger kots_virtual_print before insert or update of print_status on kots
  for each row execute function kots_virtual_print();

-- A kitchen put on a virtual printer is online at once, and its waiting or failed KOTs print
create or replace function kitchens_virtual_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if upper(btrim(coalesce(new.printer_ip, ''))) ~ '^VIRTUAL-[0-9]+$'
     and (tg_op = 'INSERT' or upper(btrim(coalesce(old.printer_ip, ''))) is distinct from upper(btrim(new.printer_ip))) then
    new.printer_status := 'online';
    new.printer_checked_at := now();
  end if;
  return new;
end $$;

drop trigger if exists kitchens_virtual_status on kitchens;
create trigger kitchens_virtual_status before insert or update of printer_ip on kitchens
  for each row execute function kitchens_virtual_status();

create or replace function kitchens_virtual_catch_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if upper(btrim(coalesce(new.printer_ip, ''))) ~ '^VIRTUAL-[0-9]+$'
     and upper(btrim(coalesce(old.printer_ip, ''))) is distinct from upper(btrim(new.printer_ip)) then
    update kots set print_status = 'printed', printed_at = now(), print_claimed_by = 'virtual',
                    print_claimed_at = now(), last_error = null
     where kitchen_id = new.id
       and print_status in ('queued', 'failed', 'printing')
       and nullif(btrim(coalesce(printer_ip, '')), '') is null
       and created_at > now() - interval '12 hours';
  end if;
  return null;
end $$;

drop trigger if exists kitchens_virtual_catch_up on kitchens;
create trigger kitchens_virtual_catch_up after update of printer_ip on kitchens
  for each row execute function kitchens_virtual_catch_up();

-- ---------------------------------------------------------------------
-- 2. One printing laptop per event
-- ---------------------------------------------------------------------
create table if not exists print_stations (
  event_id  uuid primary key references events(id) on delete cascade,
  station   text not null,                   -- the laptop's id (browser-xxxx) or a Print Hub's name
  label     text,                            -- what people see: "Desk laptop", "Print Hub desk-laptop"
  taken_at  timestamptz not null default now(),
  seen_at   timestamptz not null default now()
);
-- read and written only through the functions below
alter table print_stations enable row level security;

-- Who prints for the event: {station, label, taken_at, seen_at, active}; {} when nobody
create or replace function ps_status(p_event_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('station', station, 'label', label, 'taken_at', taken_at,
                                             'seen_at', seen_at, 'active', seen_at > now() - interval '90 seconds')
                     from print_stations where event_id = p_event_id), '{}'::jsonb);
$$;

-- Switch printing on at this laptop. Free, or held by this laptop, or the holder silent for
-- 90 seconds: taken. Held by another laptop that is working: only with an admin PIN.
create or replace function ps_take(p_event_id uuid, p_station text, p_label text, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r       print_stations;
  v_busy  boolean;
  v_pin   text := nullif(btrim(coalesce(p_pin, '')), '');
begin
  if nullif(btrim(coalesce(p_station, '')), '') is null then raise exception 'NO_STATION'; end if;
  select * into r from print_stations where event_id = p_event_id for update;
  v_busy := r.event_id is not null and r.station <> p_station and r.seen_at > now() - interval '90 seconds';
  if v_busy and not (v_pin is not null and exists (select 1 from admins a where a.is_active and a.pin::text = v_pin)) then
    return jsonb_build_object('ok', false, 'station', r.station, 'label', r.label, 'taken_at', r.taken_at,
                              'seen_at', r.seen_at, 'wrong_pin', v_pin is not null);
  end if;
  insert into print_stations (event_id, station, label, taken_at, seen_at)
  values (p_event_id, p_station, coalesce(nullif(btrim(coalesce(p_label, '')), ''), p_station), now(), now())
  on conflict (event_id) do update
     set station  = excluded.station,
         label    = excluded.label,
         taken_at = case when print_stations.station = excluded.station then print_stations.taken_at else now() end,
         seen_at  = now();
  return jsonb_build_object('ok', true, 'took_over', case when v_busy then r.label end);
end $$;

-- Switch printing off at this laptop (only its own hold)
create or replace function ps_release(p_event_id uuid, p_station text)
returns void language sql security definer set search_path = public as $$
  delete from print_stations where event_id = p_event_id and station = p_station;
$$;

grant execute on function ps_status(uuid) to anon, authenticated;
grant execute on function ps_take(uuid, text, text, text) to anon, authenticated;
grant execute on function ps_release(uuid, text) to anon, authenticated;

-- The claim of the Print Hub and of "Print from this laptop": it gets KOTs only while it is the
-- event's printing laptop (and keeps that hold fresh by asking). Cloud-printed kitchens are left
-- to their printers (v5).
create or replace function hub_claim_kots(p_event_id uuid, p_hub text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v         jsonb;
  v_station text;
  v_seen    timestamptz;
begin
  select station, seen_at into v_station, v_seen from print_stations where event_id = p_event_id;
  if v_station is not null and v_station <> p_hub and v_seen > now() - interval '90 seconds' then
    return '[]'::jsonb;   -- another laptop prints for this event
  end if;
  if v_station is distinct from p_hub or v_seen < now() - interval '10 seconds' then
    insert into print_stations (event_id, station, label, taken_at, seen_at)
    values (p_event_id, p_hub, p_hub, now(), now())
    on conflict (event_id) do update
       set station  = excluded.station,
           label    = case when print_stations.station = excluded.station then print_stations.label else excluded.label end,
           taken_at = case when print_stations.station = excluded.station then print_stations.taken_at else now() end,
           seen_at  = now();
  end if;

  with picked as (
    select k.id from kots k
     where k.event_id = p_event_id
       and (k.print_status = 'queued'
            or (k.print_status = 'printing' and k.print_claimed_at < now() - interval '45 seconds'))
       and not exists (select 1 from kitchens c
                        where c.id = k.kitchen_id and nullif(btrim(coalesce(c.cloud_print_id, '')), '') is not null
                          and nullif(btrim(coalesce(k.printer_ip, '')), '') is null)
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

grant execute on function hub_claim_kots(uuid, text, int) to anon, authenticated;

-- =====================================================================
-- Smart Serve Maestro v7: a KOT printer for Barker B; Amuse Bouche as one dish.
-- Run in the Supabase SQL Editor. Safe to run twice. Nothing is deleted.
-- To undo the printing part: 2026-10-16_maestro_v7_REVERT.sql (puts the three
-- printing functions back exactly as they were before this file ran).
--
-- 1. Barker B printer. A kitchen with two barkers can have a second printer:
--    kitchens.printer_ip_b. KOTs of Barker B (the dishes given to B under
--    Dishes) print there; Barker A's stay on the kitchen printer. If one of the
--    two printers is down, its KOTs come out on the other one (unless a
--    backup printer is set, which then comes first). A kitchen without a B
--    printer prints both on its one printer, exactly as before.
-- 2. Amuse Bouche: kitchen, cuisine and dish all "Amuse Bouche" (one dish,
--    first course), in today's and tomorrow's Maestro events.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Backup of the printing functions as they are now (kept once)
-- ---------------------------------------------------------------------
create table if not exists ss_fn_backup (
  tag      text not null,
  fn       text not null,
  def      text not null,
  saved_at timestamptz not null default now(),
  primary key (tag, fn)
);
alter table ss_fn_backup enable row level security;   -- not readable through the app's API
insert into ss_fn_backup (tag, fn, def)
select 'before_v7', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('hub_claim_kots', 'hub_printer_status', 'kots_virtual_print')
on conflict (tag, fn) do nothing;

-- ---------------------------------------------------------------------
-- 1. The Barker B printer
-- ---------------------------------------------------------------------
alter table kitchens add column if not exists printer_ip_b         text;
alter table kitchens add column if not exists printer_port_b       int;
alter table kitchens add column if not exists printer_b_status     text;
alter table kitchens add column if not exists printer_b_checked_at timestamptz;

-- Print Hub / Print from this laptop: which printer a KOT goes to
create or replace function hub_claim_kots(p_event_id uuid, p_hub text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v         jsonb;
  v_station text;
  v_seen    timestamptz;
begin
  -- one printing laptop per event (v6), unchanged; skipped on a database without it
  if to_regclass('public.print_stations') is not null then
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
           'target_ip',   coalesce(nullif(u.printer_ip, ''), case when bp.on_b then kt.printer_ip_b else kt.printer_ip end),
           'target_port', case when nullif(u.printer_ip, '') is null and bp.on_b
                               then coalesce(nullif(kt.printer_port_b, 0), 9100)
                               else coalesce(kt.printer_port, 9100) end,
           -- the backup printer first; otherwise the other barker's printer
           'backup_ip',   case when nullif(u.printer_ip, '') is not null then kt.backup_printer_ip
                               when bp.on_b then coalesce(nullif(btrim(coalesce(kt.backup_printer_ip, '')), ''), kt.printer_ip)
                               when bp.has_b then coalesce(nullif(btrim(coalesce(kt.backup_printer_ip, '')), ''), kt.printer_ip_b)
                               else kt.backup_printer_ip end,
           'event_name',  e.name) order by u.created_at), '[]'::jsonb)
    into v
    from upd u
    left join kitchens kt on kt.id = u.kitchen_id
    left join events e on e.id = u.event_id
    cross join lateral (
      select coalesce(nullif(btrim(coalesce(kt.printer_ip_b, '')), '') is not null, false) as has_b,
             coalesce(u.barker = 'B' and nullif(btrim(coalesce(kt.printer_ip_b, '')), '') is not null, false) as on_b
    ) bp;
  return v;
end $$;
grant execute on function hub_claim_kots(uuid, text, int) to anon, authenticated;

-- Printer health from the Print Hub / Print from this laptop: the B printer gets its own status,
-- and a printer that is back sends again what failed on it (B KOTs included)
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
  -- the Barker B printer, matched on its address
  update kitchens set printer_b_status = p_status, printer_b_checked_at = now()
   where event_id = p_event_id
     and split_part(btrim(coalesce(printer_ip_b, ''), E' \t\r\n'), ':', 1) = split_part(v_ip, ':', 1)
     and btrim(coalesce(printer_ip_b, '')) <> '';
  -- printer is back (paper low still prints): anything that failed on it goes out again by itself
  if p_status in ('online', 'paper_low') then
    update kots set print_status = 'queued', last_error = null
     where id in (
       select k.id
         from kots k
         join kitchens kt on kt.id = k.kitchen_id
        cross join lateral (select case when nullif(k.printer_ip, '') is null and k.barker = 'B'
                                             and nullif(btrim(coalesce(kt.printer_ip_b, '')), '') is not null
                                        then true else false end as on_b) b
        cross join lateral (select btrim(coalesce(nullif(k.printer_ip, ''),
                                                  case when b.on_b then kt.printer_ip_b else kt.printer_ip end), E' \t\r\n') as s) t
        where k.event_id = p_event_id
          and k.print_status = 'failed' and not (k.kind = 'order' and k.status = 'cancelled')
          and case when p_printer_port is null
                   then coalesce(nullif(k.printer_ip, ''), case when b.on_b then kt.printer_ip_b else kt.printer_ip end) = p_printer_ip
                   else case when t.s ~ '^[^:\s]+:[0-9]{1,5}$' then split_part(t.s, ':', 1) else t.s end = v_ip
                    and case when t.s ~ '^[^:\s]+:[0-9]{1,5}$' then split_part(t.s, ':', 2)::int
                             when b.on_b then coalesce(nullif(kt.printer_port_b, 0), 9100)
                             else coalesce(nullif(kt.printer_port, 0), 9100) end = p_printer_port
              end);
    get diagnostics v_requeued = row_count;
  end if;
  return v_requeued;
end $$;
grant execute on function hub_printer_status(uuid, text, text, int) to anon, authenticated;

-- Virtual printers (demos): a Barker B KOT follows the B printer when the kitchen has one
create or replace function kots_virtual_print() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kit text;
  v_kot text := upper(btrim(coalesce(new.printer_ip, '')));
begin
  if new.kitchen_id is null or new.print_status not in ('queued', 'failed') then return new; end if;
  if tg_op = 'UPDATE' and new.print_status is not distinct from old.print_status then return new; end if;
  select upper(btrim(coalesce(case when new.barker = 'B' and nullif(btrim(coalesce(printer_ip_b, '')), '') is not null
                                   then printer_ip_b else printer_ip end, '')))
    into v_kit from kitchens where id = new.kitchen_id;
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

-- ---------------------------------------------------------------------
-- 2. Amuse Bouche: one kitchen, one cuisine, one dish, all "Amuse Bouche"
--    (today's and tomorrow's Maestro events; Dry Run 1 left alone)
-- ---------------------------------------------------------------------
do $$
declare
  e record;
  v_k  uuid;
  v_c  uuid;
begin
  for e in select id, courses from events
            where maestro and date in ('2026-10-15', '2026-10-16') and name not ilike '%dry run 1%' loop
    -- the kitchen: the existing Amuse Bouche kitchen switched on (one barker), or a new one
    select id into v_k from kitchens where event_id = e.id and name ilike 'amuse%' order by created_at limit 1;
    if v_k is null then
      insert into kitchens (event_id, name, prefix, is_active, sort_order)
      values (e.id, 'Amuse Bouche', 'AB', true, 0) returning id into v_k;
    end if;
    update kitchens set name = 'Amuse Bouche', is_active = true, barkers = 1 where id = v_k;
    -- its Barker A login, if one was set up before
    update barkers set is_active = true where kitchen_id = v_k and side = 'A';

    -- the course, first in the event's course list
    -- (an event without its own list uses the app's standard one, so that list is written out first)
    if not ('Amuse Bouche' = any(coalesce(e.courses, '{}'))) then
      update events set courses = array_prepend('Amuse Bouche',
               case when coalesce(array_length(courses, 1), 0) = 0
                    then array['First Course', 'Soup', 'Starters', 'Mains', 'Dessert'] else courses end)
       where id = e.id;
    end if;

    -- the cuisine (menu category), routed to the kitchen
    select id into v_c from menu_categories where event_id = e.id and name ilike 'amuse%' order by created_at limit 1;
    if v_c is null then
      insert into menu_categories (event_id, name, sort_order, is_visible, kitchen_id)
      values (e.id, 'Amuse Bouche', 0, true, v_k) returning id into v_c;
    end if;
    update menu_categories set name = 'Amuse Bouche', is_visible = true, kitchen_id = v_k where id = v_c;

    -- the one dish
    if not exists (select 1 from menu_items where category_id = v_c and name = 'Amuse Bouche') then
      insert into menu_items (category_id, name, description, is_veg, is_available, sort_order, course, barker)
      values (v_c, 'Amuse Bouche', null, true, true, 1, 'Amuse Bouche', 'A');
    end if;
    update menu_items set is_available = true, course = 'Amuse Bouche', barker = 'A', kitchen_id = null
     where category_id = v_c and name = 'Amuse Bouche';
    -- only one Amuse Bouche product: any other old dish in that cuisine is hidden (not deleted)
    update menu_items set is_available = false where category_id = v_c and name <> 'Amuse Bouche';
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Check: kitchens with their printers (A and B) and cuisines
-- ---------------------------------------------------------------------
select e.name as event, e.date, k.name as kitchen, k.is_active as on, k.barkers,
       coalesce(k.printer_ip, '-') as printer_a, coalesce(k.printer_ip_b, '-') as printer_b,
       (select string_agg(c.name, ', ') from menu_categories c where c.kitchen_id = k.id) as cuisines,
       (select count(*) from menu_items i join menu_categories c on c.id = i.category_id
         where c.kitchen_id = k.id and i.is_available) as dishes
  from events e join kitchens k on k.event_id = e.id
 where e.maestro and e.date >= '2026-10-15'
 order by e.date, e.name, k.sort_order;

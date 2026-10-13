-- =====================================================================
-- Smart Serve Maestro v5: cloud printing (no laptop). Run after 2026-10-13_maestro_v4.sql.
-- Additive and safe to run twice; the app already live keeps working after it.
--
-- Epson Server Direct Print: the kitchen printer itself asks the Smart Serve
-- server for its KOTs every few seconds (https://<app>/api/sdp) and prints
-- them, so no Print Hub, laptop or open browser is needed, only internet on
-- the printers' network. Each printer is given a Printer ID in its own
-- settings page; the kitchens that print there get the same ID in Event
-- set-up › Kitchens & printers › Cloud printing.
--
--   kitchens.cloud_print_id   the Printer ID of the printer this kitchen uses
--   sdp_claim(id, limit)      the queued KOTs of every kitchen on that printer
--                             (also marks the printer online, and puts a KOT
--                             that failed on it back in the queue a few times)
--   hub_claim_kots            unchanged, except it leaves cloud-printed kitchens
--                             alone, so a Print Hub or "Print from this laptop"
--                             left running never prints them twice
-- The result of every KOT comes back through the existing hub_report.
-- =====================================================================

alter table kitchens add column if not exists cloud_print_id text;
create index if not exists kitchens_cloud_print_id_idx on kitchens (cloud_print_id) where cloud_print_id is not null;

create or replace function sdp_claim(p_id text, p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id  text := upper(btrim(coalesce(p_id, '')));
  v     jsonb;
begin
  if v_id = '' then return '[]'::jsonb; end if;

  -- the printer is asking, so it is on and connected
  update kitchens set printer_status = 'online', printer_checked_at = now()
   where upper(btrim(cloud_print_id)) = v_id and is_active
     and (printer_status is distinct from 'online' or printer_checked_at < now() - interval '20 seconds');

  -- a KOT that failed on this printer (paper out, cover open) is tried again, a few times,
  -- at most every 20 seconds
  update kots k set print_status = 'queued'
    from kitchens kt
   where kt.id = k.kitchen_id and upper(btrim(kt.cloud_print_id)) = v_id and kt.is_active
     and k.print_status = 'failed' and k.print_attempts < 6
     and k.print_claimed_at < now() - interval '20 seconds'
     and k.created_at > now() - interval '18 hours'
     and coalesce(k.last_error, '') not ilike '%SchemaError%';

  with picked as (
    select k.id
      from kots k
      join kitchens kt on kt.id = k.kitchen_id
     where upper(btrim(kt.cloud_print_id)) = v_id and kt.is_active
       and k.created_at > now() - interval '18 hours'
       and nullif(btrim(coalesce(k.printer_ip, '')), '') is null
       and (k.print_status = 'queued'
            or (k.print_status = 'printing' and k.print_claimed_at < now() - interval '45 seconds'))
     order by k.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 20))
     for update of k skip locked
  ), upd as (
    update kots k set print_status = 'printing', print_claimed_by = 'cloud:' || v_id,
                      print_claimed_at = now(), print_attempts = k.print_attempts + 1
      from picked where k.id = picked.id
    returning k.*
  )
  select coalesce(jsonb_agg(to_jsonb(u) || jsonb_build_object('event_name', e.name) order by u.created_at), '[]'::jsonb)
    into v
    from upd u
    left join events e on e.id = u.event_id;
  return v;
end $$;

grant execute on function sdp_claim(text, int) to anon, authenticated;

-- The Print Hub / "Print from this laptop" claim, now leaving cloud-printed kitchens alone
create or replace function hub_claim_kots(p_event_id uuid, p_hub text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
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

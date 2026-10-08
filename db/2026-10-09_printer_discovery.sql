-- =====================================================================
-- Smart Serve - printer discovery and "follow the printer" (v1)
--
-- Builds on 2026-10-07_multikitchen.sql. ADDITIVE ONLY: one new table,
-- new nullable columns, new functions. Safe to run more than once; runs as
-- one transaction.
--
-- Why
--   Kitchen printers are reached by IP address. A venue router that hands
--   out addresses itself (DHCP) can give a printer a new address after a
--   restart, and printing to the old address stops. The Print Hub now
--     1. looks for printers on its own network (TCP port 9100) and reads each
--        one's hardware (MAC) address, which never changes;
--     2. reports them here (found_printers), so the desk can pick a printer
--        from a list instead of typing an IP, and print a slip to see which
--        physical printer is which;
--     3. remembers each kitchen printer's MAC, and when that printer turns up
--        at a new address the kitchen follows it automatically.
--   The desk asks for a search by setting events.printer_scan_at.
--
-- Run in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- =====================================================================
begin;

alter table kitchens add column if not exists printer_mac         text;        -- learned by the Print Hub
alter table kitchens add column if not exists backup_printer_mac  text;
alter table kitchens add column if not exists printer_moved_from  text;        -- last automatic move, for the desk
alter table kitchens add column if not exists printer_moved_at    timestamptz;
alter table events   add column if not exists printer_scan_at     timestamptz; -- desk: "Find printers" pressed

create table if not exists found_printers (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  ip        text not null,                 -- "192.168.1.23", or "host:port" when the port is not 9100
  mac       text,                          -- aa:bb:cc:dd:ee:ff when the laptop could read it
  status    text,                          -- online | paper_low | paper_out | unknown
  hub       text,                          -- which laptop saw it
  seen_at   timestamptz not null default now(),
  unique (event_id, ip)
);
create index if not exists found_printers_event_idx on found_printers(event_id, seen_at desc);

-- Same open policy style as every other table in this app
do $$
declare t text := 'found_printers';
begin
  execute format('alter table %I enable row level security', t);
  execute format('drop policy if exists %I on %I', t || '_select', t);
  execute format('drop policy if exists %I on %I', t || '_insert', t);
  execute format('drop policy if exists %I on %I', t || '_update', t);
  execute format('drop policy if exists %I on %I', t || '_delete', t);
  execute format('create policy %I on %I for select using (true)', t || '_select', t);
  execute format('create policy %I on %I for insert with check (true)', t || '_insert', t);
  execute format('create policy %I on %I for update using (true) with check (true)', t || '_update', t);
  execute format('create policy %I on %I for delete using (true)', t || '_delete', t);
  execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
end $$;

-- A printer address as the hub writes it: host, plus ":port" when not 9100
create or replace function ss_printer_key(p_ip text, p_port int default null)
returns text language sql immutable as $$
  select case
    when nullif(trim(p_ip), '') is null then null
    when trim(p_ip) ~ ':\d+$' then
      case when split_part(trim(p_ip), ':', 2) = '9100' then split_part(trim(p_ip), ':', 1) else trim(p_ip) end
    when coalesce(p_port, 9100) <> 9100 then trim(p_ip) || ':' || p_port
    else trim(p_ip)
  end
$$;

/* The Print Hub reports the printers it found (one scan). For each kitchen:
     - a printer answering at the kitchen's address whose MAC is not known
       yet: its MAC is remembered;
     - a kitchen whose remembered MAC now answers at another address, while
       its own address is silent or answered by a different printer: the
       kitchen moves to the new address.
   Returns {"moved":[{kitchen, from, to}], "learned": n}. */
create or replace function hub_found_printers(p_event_id uuid, p_hub text, p_printers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f        jsonb;
  k        record;
  v_seen   jsonb := '[]'::jsonb;
  v_moved  jsonb := '[]'::jsonb;
  v_learn  int := 0;
  v_key    text;
  v_at     jsonb;
  v_new    jsonb;
begin
  for f in select * from jsonb_array_elements(coalesce(p_printers, '[]'::jsonb)) loop
    v_key := ss_printer_key(f->>'ip');
    continue when v_key is null;
    v_seen := v_seen || jsonb_build_array(jsonb_build_object('ip', v_key, 'mac', nullif(lower(trim(f->>'mac')), '')));
    insert into found_printers(event_id, ip, mac, status, hub, seen_at)
    values (p_event_id, v_key, nullif(lower(trim(f->>'mac')), ''), coalesce(f->>'status', 'unknown'), p_hub, clock_timestamp())
    on conflict (event_id, ip) do update
      set mac = coalesce(excluded.mac, found_printers.mac), status = excluded.status, hub = excluded.hub, seen_at = clock_timestamp();
  end loop;

  -- one MAC is one printer: a row from an EARLIER scan with the same MAC at another address
  -- is out of date. Not when this scan saw that MAC at several addresses (a Wi-Fi bridge or
  -- extender can answer for several printers with its own MAC): those rows all stay.
  delete from found_printers o
   using found_printers n
   where o.event_id = p_event_id and n.event_id = p_event_id
     and o.mac is not null and o.mac = n.mac and o.ip <> n.ip
     and o.seen_at < now() and n.seen_at >= now()
     and (select count(*) from jsonb_array_elements(v_seen) e where e->>'mac' = o.mac) = 1;

  for k in select * from kitchens where event_id = p_event_id loop
    -- main printer
    v_key := ss_printer_key(k.printer_ip, k.printer_port);
    if v_key is not null then
      select e into v_at from jsonb_array_elements(v_seen) e where e->>'ip' = v_key limit 1;
      if k.printer_mac is null then
        if v_at->>'mac' is not null then
          update kitchens set printer_mac = v_at->>'mac' where id = k.id;
          v_learn := v_learn + 1;
        end if;
      elsif v_at is null or (v_at->>'mac' is not null and v_at->>'mac' <> k.printer_mac) then
        select e into v_new from jsonb_array_elements(v_seen) e where e->>'mac' = k.printer_mac and e->>'ip' <> v_key limit 1;
        -- only a printer that is unmistakable, and never onto an address another kitchen prints to
        if v_new is not null and ((select count(*) from jsonb_array_elements(v_seen) e where e->>'mac' = k.printer_mac) <> 1
           or exists (select 1 from kitchens o where o.event_id = p_event_id
                        -- another physical printer already lives there (kitchens sharing this
                        -- same printer have the same MAC and follow it together)
                        and ((o.id <> k.id and ss_printer_key(o.printer_ip, o.printer_port) = v_new->>'ip'
                              and o.printer_mac is distinct from k.printer_mac)
                             or (ss_printer_key(o.backup_printer_ip) = v_new->>'ip'
                              and o.backup_printer_mac is distinct from k.printer_mac)))) then
          v_new := null;
        end if;
        if v_new is not null then
          update kitchens set printer_ip = v_new->>'ip', printer_port = case when v_new->>'ip' ~ ':\d+$' then printer_port else 9100 end,
                              printer_moved_from = v_key, printer_moved_at = now()
           where id = k.id;
          v_moved := v_moved || jsonb_build_array(jsonb_build_object('kitchen', k.name, 'from', v_key, 'to', v_new->>'ip'));
        end if;
      end if;
    end if;
    v_at := null; v_new := null;

    -- backup printer
    v_key := ss_printer_key(k.backup_printer_ip);
    if v_key is not null then
      select e into v_at from jsonb_array_elements(v_seen) e where e->>'ip' = v_key limit 1;
      if k.backup_printer_mac is null then
        if v_at->>'mac' is not null then
          update kitchens set backup_printer_mac = v_at->>'mac' where id = k.id;
          v_learn := v_learn + 1;
        end if;
      elsif v_at is null or (v_at->>'mac' is not null and v_at->>'mac' <> k.backup_printer_mac) then
        select e into v_new from jsonb_array_elements(v_seen) e where e->>'mac' = k.backup_printer_mac and e->>'ip' <> v_key limit 1;
        if v_new is not null and ((select count(*) from jsonb_array_elements(v_seen) e where e->>'mac' = k.backup_printer_mac) <> 1
           or exists (select 1 from kitchens o where o.event_id = p_event_id
                        and ((ss_printer_key(o.printer_ip, o.printer_port) = v_new->>'ip'
                              and o.printer_mac is distinct from k.backup_printer_mac)
                             or (o.id <> k.id and ss_printer_key(o.backup_printer_ip) = v_new->>'ip'
                              and o.backup_printer_mac is distinct from k.backup_printer_mac)))) then
          v_new := null;
        end if;
        if v_new is not null then
          update kitchens set backup_printer_ip = v_new->>'ip' where id = k.id;
          v_moved := v_moved || jsonb_build_array(jsonb_build_object('kitchen', k.name || ' (backup)', 'from', v_key, 'to', v_new->>'ip'));
        end if;
      end if;
    end if;
    v_at := null; v_new := null;
  end loop;

  return jsonb_build_object('moved', v_moved, 'learned', v_learn);
end $$;

grant execute on function ss_printer_key(text, int)                 to anon, authenticated;
grant execute on function hub_found_printers(uuid, text, jsonb)     to anon, authenticated;

-- the desk sees found printers appear without reloading
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = 'found_printers') then
    alter publication supabase_realtime add table public.found_printers;
  end if;
end $$;

commit;

-- make the API see the new table and functions at once
notify pgrst, 'reload schema';

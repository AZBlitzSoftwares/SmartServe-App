-- =====================================================================
-- Why do Hutong KOTs also print on the printer ending .112?
-- Takes .112 off Hutong (Barker A, Barker B, backup) in Dry Run 2 and the main
-- event, keeps Hutong A .88 / B .89, and lists every place .112 is still set
-- plus the last Hutong KOTs. Safe to run any time, twice too. Nothing is deleted.
-- =====================================================================
update kitchens k
   set backup_printer_ip = null
  from events e
 where e.id = k.event_id and e.maestro and k.name ilike 'hutong%'
   and btrim(coalesce(k.backup_printer_ip, '')) like '%.112%';
update kitchens k
   set printer_ip = '192.168.103.88', printer_port = 9100
  from events e
 where e.id = k.event_id and e.maestro and k.is_active and k.name ilike 'hutong%'
   and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
   and btrim(coalesce(k.printer_ip, '')) like '%.112%';
update kitchens k
   set printer_ip_b = '192.168.103.89', printer_port_b = 9100
  from events e
 where e.id = k.event_id and e.maestro and k.is_active and k.name ilike 'hutong%'
   and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
   and btrim(coalesce(k.printer_ip_b, '')) like '%.112%';

notify pgrst, 'reload schema';

-- Check (the one result the SQL Editor shows)
select what, event, kitchen, detail from (
  -- every kitchen (any event dated from 14 Oct) where .112 is set: A, B, backup or cloud ID
  select 1 as s, 'Uses .112' as what, e.name as event, k.name as kitchen,
         concat_ws('  ·  ', 'A ' || coalesce(k.printer_ip, '-'), 'B ' || coalesce(k.printer_ip_b, '-'),
                   'backup ' || coalesce(k.backup_printer_ip, '-'),
                   case when k.is_active then 'kitchen ON' else 'kitchen off' end) as detail, k.name as o
    from kitchens k join events e on e.id = k.event_id
   where e.date >= '2026-10-14'
     and (coalesce(k.printer_ip, '') like '%.112%' or coalesce(k.printer_ip_b, '') like '%.112%'
          or coalesce(k.backup_printer_ip, '') like '%.112%')
  union all
  -- Hutong's printers now
  select 2, 'Hutong now', e.name, k.name,
         concat_ws('  ·  ', 'A ' || coalesce(k.printer_ip, '-'), 'B ' || coalesce(k.printer_ip_b, '-'),
                   'backup ' || coalesce(k.backup_printer_ip, '-'), 'cloud ' || coalesce(k.cloud_print_id, '-')), k.name
    from kitchens k join events e on e.id = k.event_id
   where e.maestro and k.is_active and k.name ilike 'hutong%' and e.date >= '2026-10-14'
  union all
  -- who prints for each event (Print Hub or a laptop) and when it was last seen
  select 3, 'Printing for', e.name, ps.station, 'last seen ' || to_char(ps.seen_at at time zone 'Asia/Kolkata', 'HH24:MI:SS'), ps.station
    from print_stations ps join events e on e.id = ps.event_id
   where e.date >= '2026-10-14' and ps.seen_at > now() - interval '3 hours'
  union all
  -- the last 12 Hutong KOTs: which event, A or B, printed by whom, sent to which printer
  select 4, 'Hutong KOT', e.name, t.kot_no || ' · Barker ' || coalesce(t.barker, '?'),
         concat_ws('  ·  ', to_char(t.created_at at time zone 'Asia/Kolkata', 'HH24:MI'), t.print_status,
                   'by ' || coalesce(t.print_claimed_by, '-'),
                   case when nullif(t.printer_ip, '') is not null then 'sent to ' || t.printer_ip end,
                   t.last_error), to_char(t.created_at, 'YYYYMMDDHH24MISS')
    from (select * from kots where kitchen_id in (select id from kitchens where name ilike 'hutong%')
           order by created_at desc limit 12) t
    join events e on e.id = t.event_id
) x
order by s, o desc;

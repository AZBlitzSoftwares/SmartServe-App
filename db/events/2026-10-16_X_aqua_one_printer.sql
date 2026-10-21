-- =====================================================================
-- Aqua Italian on ONE printer: 192.168.103.92 prints Barker A and Barker B
-- (the KOT still says Barker A / Barker B). Dry Run 2 and the main event.
-- The printer learned for Aqua is forgotten so the Print Hub learns .92 again.
-- Safe to run twice. Nothing is deleted.
-- =====================================================================
update kitchens k
   set printer_ip = '192.168.103.92', printer_port = 9100, printer_ip_b = null
  from events e
 where e.id = k.event_id and e.maestro and k.is_active and k.name ilike 'aqua%'
   and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run%');
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'kitchens' and column_name = 'printer_mac') then
    execute 'update kitchens k set printer_mac = null from events e
              where e.id = k.event_id and e.maestro and k.is_active and k.name ilike ''aqua%''
                and ((e.name not ilike ''%dry run%'' and e.date in (''2026-10-16'', ''2026-10-17'')) or e.name ilike ''%dry run%'')';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): Aqua prints A and B on .92; no other kitchen uses .92
select e.name as event, k.name as kitchen,
       'A ' || coalesce(k.printer_ip, '-') || '  ·  B ' || coalesce(nullif(k.printer_ip_b, ''), 'same as A') as printers
  from kitchens k join events e on e.id = k.event_id
 where e.maestro and k.is_active and e.date >= '2026-10-14'
   and (k.name ilike 'aqua%' or coalesce(k.printer_ip, '') like '%.92' or coalesce(k.printer_ip_b, '') like '%.92'
        or coalesce(k.backup_printer_ip, '') like '%.92')
 order by e.name, k.name;

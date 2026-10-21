-- =====================================================================
-- Hutong Oriental printers, in Dry Run 2 and the main event:
--   Barker A = 192.168.103.88   Barker B = 192.168.103.89   (port 9100)
-- The printer learned for Hutong is forgotten so the Print Hub learns the
-- printer at .88 again (otherwise it could move Barker A back to .89).
-- Safe to run twice. Nothing is deleted.
-- =====================================================================
do $$
declare
  n int;
begin
  update kitchens k
     set printer_ip = '192.168.103.88', printer_port = 9100,
         printer_ip_b = '192.168.103.89', printer_port_b = 9100
    from events e
   where e.id = k.event_id and e.maestro and k.is_active and k.name ilike 'hutong%'
     and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No Hutong kitchen found (switched on) in Dry Run 2 or the main event. Nothing changed.'; end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'kitchens' and column_name = 'printer_mac') then
    execute 'update kitchens k set printer_mac = null
               from events e
              where e.id = k.event_id and e.maestro and k.is_active and k.name ilike ''hutong%''
                and ((e.name not ilike ''%dry run%'' and e.date in (''2026-10-16'', ''2026-10-17'')) or e.name ilike ''%dry run 2%'')';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows): every printer of the two events.
-- Hutong: A 192.168.103.88, B 192.168.103.89. "used_twice" must be empty on every row.
with p as (
  select e.name as event, k.name as kitchen, 'A' as side, btrim(coalesce(k.printer_ip, '')) as ip
    from kitchens k join events e on e.id = k.event_id
   where e.maestro and k.is_active
     and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
  union all
  select e.name, k.name, 'B', btrim(coalesce(k.printer_ip_b, ''))
    from kitchens k join events e on e.id = k.event_id
   where e.maestro and k.is_active and k.barkers >= 2
     and ((e.name not ilike '%dry run%' and e.date in ('2026-10-16', '2026-10-17')) or e.name ilike '%dry run 2%')
)
select event, kitchen, side, coalesce(nullif(ip, ''), '— NOT SET —') as printer,
       case when ip <> '' and count(*) over (partition by event, ip) > 1 then 'USED TWICE' else '' end as used_twice
  from p
 order by event, kitchen, side;

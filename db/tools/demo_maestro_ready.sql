-- Smart Serve Maestro demo: ready for a new day.
-- Dates the demo event today (India time), clears its test service (orders on covers, KOTs,
-- chat, help requests, sold-out marks) and restarts the KOT numbers at 001.
-- Keeps the whole set-up: kitchens, printers, barkers, captains, tables and the menu.
-- Safe to run more than once. Supabase > SQL Editor > paste > Run.
-- (Kept in db/tools so the laptop's "prepare --dev" never runs it.)
begin;

update events
   set date = (now() at time zone 'Asia/Kolkata')::date, is_closed = false
 where id = '00000000-0000-4000-8000-0000000de304';

delete from ms_items      where event_id = '00000000-0000-4000-8000-0000000de304';
delete from ms_firings    where event_id = '00000000-0000-4000-8000-0000000de304';
delete from ms_covers     where event_id = '00000000-0000-4000-8000-0000000de304';
delete from kots          where event_id = '00000000-0000-4000-8000-0000000de304';
delete from sos_request_items where sos_request_id in
       (select id from sos_requests where event_id = '00000000-0000-4000-8000-0000000de304');
delete from sos_requests  where event_id = '00000000-0000-4000-8000-0000000de304';
delete from chat_messages where event_id = '00000000-0000-4000-8000-0000000de304';

update kitchens set kot_seq = 0, kot_seq_b = 0
 where event_id = '00000000-0000-4000-8000-0000000de304';

update menu_items set is_available = true, sold_out_at = null, sold_out_by = null
 where category_id in (select id from menu_categories where event_id = '00000000-0000-4000-8000-0000000de304')
   and (is_available = false or sold_out_at is not null);

commit;

-- check: the event's date should be today
select name, date, is_closed from events where id = '00000000-0000-4000-8000-0000000de304';

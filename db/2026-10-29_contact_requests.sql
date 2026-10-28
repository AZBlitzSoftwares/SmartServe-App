-- =====================================================================
-- Contact us (guest tablet): a guest leaves their name, WhatsApp number
-- and/or email to get Janu's Smart Serve's details (mobile or email is
-- required). The admin sees them under Feedback › Contact requests and
-- downloads them as CSV.
-- Additive and safe to run twice. Nothing else changes.
-- =====================================================================

create table if not exists contact_requests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references events(id) on delete set null,
  table_id     uuid,
  table_number int,
  phone        text,
  email        text,
  name         text,
  created_at   timestamptz not null default now()
);

-- (safe if an earlier copy of this file created the table)
alter table contact_requests add column if not exists email text;
alter table contact_requests alter column phone drop not null;

create index if not exists contact_requests_event_idx on contact_requests (event_id, created_at);

-- Access - same open policy style as every other table in this app
alter table contact_requests enable row level security;
drop policy if exists contact_requests_select on contact_requests;
drop policy if exists contact_requests_insert on contact_requests;
drop policy if exists contact_requests_update on contact_requests;
drop policy if exists contact_requests_delete on contact_requests;
create policy contact_requests_select on contact_requests for select using (true);
create policy contact_requests_insert on contact_requests for insert with check (true);
create policy contact_requests_update on contact_requests for update using (true) with check (true);
-- nobody deletes guests' details from the app
revoke delete on contact_requests from anon, authenticated;
grant select, insert, update on contact_requests to anon, authenticated;

notify pgrst, 'reload schema';

-- Check (the result the SQL Editor shows)
select 'Contact requests' as change,
       case when to_regclass('public.contact_requests') is not null then 'OK' else 'NOT APPLIED' end as status;

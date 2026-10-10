-- Janu's Smart Serve - the base database structure carried by the local server kit.
--
-- The Smart Serve tables as they are in the cloud BEFORE the multi-kitchen update
-- (every column checked against the cloud's API); the dated ../db/*.sql updates
-- are applied on top of it. Used by:
--   - "Prepare Event" without a database password (the Offline Kit), which then
--     also adds any column the cloud has gained since (from the rows it sends);
--   - "node ss-local.mjs prepare --dev --standin" (a test database, no cloud at all).
-- When a column is added in the cloud outside ../db/*.sql, add it here too.
--
-- Roles (anon, authenticated, authenticator), grants and the extensions are
-- made by the local server kit itself; the realtime publication does not
-- exist on the laptop.

create table admins (id uuid primary key default gen_random_uuid(), username text, name text, email text, pin text, is_active boolean default true, created_at timestamptz default now());
create table events (id uuid primary key default gen_random_uuid(), name text, date date, venue text, status text, catering_company text, catering_logo_url text,
  number_of_tables int, max_orders_per_table int default 1, call_waiter_enabled boolean default true, service_mode text default 'self', welcome_note text,
  banner_image_url text, video_url text, is_closed boolean default false, ai_enabled boolean default false, created_at timestamptz default now(),
  video_sound_enabled boolean default true);
create table supervisors (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, name text, pin text, mobile text, is_active boolean default true, created_at timestamptz default now(),
  role text default 'supervisor');
create table tables (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, table_number int, is_active boolean default true,
  claimed_by_device text, claimed_at timestamptz, last_seen_at timestamptz, created_at timestamptz default now(), qr_code_url text);
create table captains (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, name text, pin text, mobile text, is_active boolean default true, created_at timestamptz default now());
create table waiters (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, waiter_number text, name text, mobile text, is_active boolean default true, created_at timestamptz default now(),
  table_numbers text);
create table menu_categories (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, name text, sort_order int, is_visible boolean default true, created_at timestamptz default now());
create table menu_items (id uuid primary key default gen_random_uuid(), category_id uuid references menu_categories(id) on delete cascade, name text, description text,
  is_veg boolean default true, is_available boolean default true, photo_url text, is_live_counter boolean default false, sort_order int, created_at timestamptz default now(), photo_source text);
create table orders (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, table_id uuid references tables(id), status text default 'pending',
  captain_id uuid references captains(id), waiter_id uuid references waiters(id), assigned_at timestamptz, delivered_at timestamptz, cancel_reason text, created_at timestamptz default now(),
  modified_at timestamptz, cancelled_at timestamptz, assigned_waiter_name text, delivered_by text);
create table order_items (id uuid primary key default gen_random_uuid(), order_id uuid references orders(id) on delete cascade, menu_item_id uuid references menu_items(id), quantity int default 1, created_at timestamptz default now(),
  customization_note text);
create table table_carts (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, table_number int, items jsonb, captain_id uuid references captains(id), updated_at timestamptz default now(),
  created_at timestamptz default now(), unique(event_id, table_number));
create table chat_messages (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, captain_id uuid references captains(id), sender text, sender_name text, body text,
  read_by_captain boolean default false, read_by_supervisor boolean default false, created_at timestamptz default now());
create table sos_requests (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade, table_id uuid references tables(id), captain_id uuid references captains(id), waiter_id uuid references waiters(id),
  request_type text, table_number int, status text default 'open', assigned_at timestamptz, acknowledged_at timestamptz, resolved_at timestamptz, created_at timestamptz default now());
create table sos_request_items (id uuid primary key default gen_random_uuid(), sos_request_id uuid references sos_requests(id) on delete cascade, item_name text, quantity int,
  help_item_id uuid, created_at timestamptz default now());
create table help_items (id uuid primary key default gen_random_uuid(), event_id uuid, name text, has_quantity boolean, is_active boolean default true, sort_order int, created_at timestamptz default now());
create table feedback (id uuid primary key default gen_random_uuid(), event_id uuid, order_id uuid, table_number int, rating int, food_rating int, service_rating int, guest_name text, guest_mobile text, comment text, created_at timestamptz default now(),
  presentation_rating int, guest_email text, app_experience_rating int, sentiment text);
create table food_master (id uuid primary key default gen_random_uuid(), name text, category text, description text, is_veg boolean, photo_url text, created_at timestamptz default now());

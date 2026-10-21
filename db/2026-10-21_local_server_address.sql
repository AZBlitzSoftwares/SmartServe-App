-- =====================================================================
-- Offline mode: the cloud keeps the event laptop's address.
-- Additive and safe to run twice. Nothing existing is changed.
--
-- When "Start Local Server" runs on the event laptop and there is any
-- internet, the laptop tells the cloud its address on the event Wi-Fi
-- (for example http://192.168.1.10:8080) every minute, for each event it
-- carries. Tablets still on the cloud then offer that laptop with one tap
-- and fill in its address, so nobody types an IP, even when the laptop got
-- a different address at this venue. When the server is stopped (Ctrl+C)
-- the laptop says so and the tablets stop offering it.
--
-- local_servers: one row per event (one laptop per event). RLS on and no
-- policies: the app and the laptop reach it only through the two functions.
-- =====================================================================

create table if not exists public.local_servers (
  event_id   uuid primary key references public.events(id) on delete cascade,
  base_url   text not null,                     -- http://192.168.1.10:8080
  addresses  text[] not null default '{}',      -- every address of the laptop, first = base_url
  port       integer not null default 8080,
  label      text,                              -- the laptop's name
  started_at timestamptz,                       -- when its server started
  seen_at    timestamptz not null default now(),-- last time it told the cloud
  stopped_at timestamptz                        -- set when the server was stopped
);
alter table public.local_servers enable row level security;

-- Only a plain http address on a private network is ever stored
-- (http://10.0.5.23:8080): 10.x, 172.16-31.x, 192.168.x, 100.64-127.x, 127.x.
-- Nobody can point tablets at a server on the internet through this table.
create or replace function public.ls_is_local_base(p text) returns boolean
language sql immutable as $$
  select coalesce(p ~ ('^http://('
      || '(10|127)(\.[0-9]{1,3}){3}'
      || '|192\.168(\.[0-9]{1,3}){2}'
      || '|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}'
      || '|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])(\.[0-9]{1,3}){2}'
      || '):[0-9]{1,5}$'), false)
$$;

-- Called by the laptop every minute (and once with p_stopped when it stops).
-- p_events: the events the laptop carries; only events that exist are kept.
-- Returns how many events now point at this laptop. One laptop per event:
-- while another laptop's entry is live (told the cloud in the last 3 minutes,
-- not stopped), it is kept and this call returns 0 for that event. A server
-- that said it stopped stays stopped (a late "running" from it is ignored).
create or replace function public.ls_announce(
  p_events uuid[], p_base text, p_addresses text[] default '{}', p_port integer default 8080,
  p_label text default null, p_started timestamptz default null, p_stopped boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not ls_is_local_base(p_base) then
    raise exception 'not a laptop address (http://<IP>:<port>): %', p_base;
  end if;
  if coalesce(p_stopped, false) then
    -- only this laptop's own entry: a laptop stopping never hides another one
    update local_servers set stopped_at = now()
     where event_id = any(p_events) and base_url = p_base and stopped_at is null
       and (p_started is null or started_at is not distinct from p_started);
    get diagnostics n = row_count;
    return n;
  end if;
  insert into local_servers as l (event_id, base_url, addresses, port, label, started_at, seen_at, stopped_at)
  select e.id, p_base,
         coalesce((select array_agg(a) from unnest(p_addresses) a where ls_is_local_base(a)), array[p_base]),
         coalesce(p_port, 8080), left(p_label, 80), p_started, now(), null
    from events e
   where e.id = any(p_events)
  on conflict (event_id) do update
     set base_url = excluded.base_url, addresses = excluded.addresses, port = excluded.port,
         label = excluded.label, started_at = excluded.started_at, seen_at = now(), stopped_at = null
   where (l.stopped_at is null or l.started_at is distinct from excluded.started_at)   -- stopped stays stopped
     and (l.started_at is not distinct from excluded.started_at                       -- the same server (new address)
          or l.base_url = excluded.base_url                                            -- the same laptop, restarted
          or l.stopped_at is not null                                                  -- the old one stopped
          or l.seen_at < now() - interval '3 minutes');                                -- the old one went silent
  get diagnostics n = row_count;
  return n;
end $$;

-- Called by the tablets: the laptops running now (told the cloud in the last
-- 3 minutes, not stopped) for the events dated on the given days.
create or replace function public.ls_find(p_dates date[])
returns table (event_id uuid, event_name text, base_url text, addresses text[], label text,
               seen_at timestamptz, age_seconds integer)
language sql stable security definer set search_path = public as $$
  select l.event_id, e.name, l.base_url, l.addresses, l.label, l.seen_at,
         greatest(0, extract(epoch from now() - l.seen_at))::integer
    from local_servers l
    join events e on e.id = l.event_id
   where e.date = any(p_dates)
     and l.stopped_at is null
     and l.seen_at > now() - interval '3 minutes'
   order by l.seen_at desc
$$;

revoke all on public.local_servers from anon, authenticated;
grant execute on function public.ls_announce(uuid[], text, text[], integer, text, timestamptz, boolean) to anon, authenticated;
grant execute on function public.ls_find(date[]) to anon, authenticated;
grant execute on function public.ls_is_local_base(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- Check: the table and both functions exist (expect 3 rows).
select 'table local_servers' as item, to_regclass('public.local_servers') is not null as ok
union all select 'function ls_announce', to_regprocedure('public.ls_announce(uuid[],text,text[],integer,text,timestamptz,boolean)') is not null
union all select 'function ls_find', to_regprocedure('public.ls_find(date[])') is not null;

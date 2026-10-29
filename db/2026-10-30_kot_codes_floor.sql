-- =====================================================================
-- Fix for 2026-10-30_kot_codes.sql: KOT numbers must carry on from the
-- event's last KOT number. A kot_series row made by Control › KOT printing
-- (or a set-up script) started at 0, so the next KOT was 001 again
-- (seen on Demo · Captain Service: BE-001 after C1-011).
--   * a new kot_series row starts at the event's highest KOT number so far;
--   * a row still at 0 is moved up to it before the next number is given;
--   * existing rows are put right now.
-- Safe to run twice. The Offline Kit applies it after 2026-10-30_kot_codes.sql.
-- =====================================================================

-- the highest KOT number the event has used so far (any letters, printer counters too)
create or replace function ss_kot_floor(p_event uuid)
returns int language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce((select max(nullif(substring(k.kot_no from '(\d+)\s*$'), '')::int)
                from kots k where k.event_id = p_event and k.kind = 'order'), 0),
    coalesce((select max(kt.kot_seq) from kitchens kt where kt.event_id = p_event), 0))
$$;

create or replace function ss_kot_no(p_event uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_seq int;
begin
  insert into kot_series (event_id, seq) values (p_event, ss_kot_floor(p_event))
  on conflict (event_id) do nothing;
  v_code := ss_kot_code(p_event, p_name);
  update kot_series
     set seq = (case when seq = 0 then ss_kot_floor(p_event) else seq end) + 1, updated_at = now()
   where event_id = p_event returning seq into v_seq;
  return v_code || '-' || lpad(v_seq::text, 3, '0');
end $$;

-- ss_kot_code / ss_kot_code_set: same as before, but a row they make starts at the floor too
create or replace function ss_kot_code(p_event uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_key   text := lower(btrim(coalesce(p_name, '')));
  v_codes jsonb;
  v_have  text;
  v_base  text;
  v_words text[];
  v_all   text;
  v_c     text;
  v_cands text[] := '{}';
  i       int;
begin
  insert into kot_series (event_id, seq) values (p_event, ss_kot_floor(p_event)) on conflict (event_id) do nothing;
  select codes into v_codes from kot_series where event_id = p_event for update;
  v_have := nullif(btrim(v_codes ->> v_key), '');
  if v_have is not null then return upper(v_have); end if;

  v_base := regexp_replace(btrim(coalesce(p_name, '')),
    '^\s*(dinner|lunch|breakfast|brunch|all\s*day|high\s*tea|evening|snacks?)\s*[-–:|]\s*', '', 'i');
  v_words := array(select w from unnest(regexp_split_to_array(upper(regexp_replace(v_base, '[^A-Za-z ]', ' ', 'g')), '\s+')) w
                    where w <> '' and w not in ('AND', 'OF', 'THE', 'WITH', 'N'));
  v_all := array_to_string(v_words, '');

  if v_all <> '' then
    v_c := split_part(upper(regexp_replace(btrim(v_base), '[^A-Za-z -]', '', 'g')), ' ', 1);
    if v_c ~ '^[A-Z]+-[A-Z]' then v_cands := v_cands || (left(split_part(v_c, '-', 1), 1) || left(split_part(v_c, '-', 2), 1)); end if;
    if length(v_words[1]) >= 2 then v_cands := v_cands || left(v_words[1], 2); end if;
    if array_length(v_words, 1) >= 2 then v_cands := v_cands || (left(v_words[1], 1) || left(v_words[2], 1)); end if;
    if array_length(v_words, 1) >= 3 then v_cands := v_cands || (left(v_words[1], 1) || left(v_words[3], 1)); end if;
    for i in 2 .. length(v_all) loop v_cands := v_cands || (left(v_all, 1) || substr(v_all, i, 1)); end loop;
    for i in 2 .. 9 loop v_cands := v_cands || (left(v_all, 1) || i::text); end loop;
  end if;
  for i in 1 .. 99 loop v_cands := v_cands || ('K' || i::text); end loop;

  foreach v_c in array v_cands loop
    if not exists (select 1 from jsonb_each_text(v_codes) x where upper(x.value) = v_c) then
      update kot_series set codes = codes || jsonb_build_object(v_key, v_c), updated_at = now() where event_id = p_event;
      return v_c;
    end if;
  end loop;
  return 'K';
end $$;

create or replace function ss_kot_code_set(p_event uuid, p_name text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text := lower(btrim(coalesce(p_name, ''))); v_code text := upper(btrim(coalesce(p_code, ''))); v_codes jsonb;
begin
  if v_code !~ '^[A-Z0-9]{1,4}$' then raise exception 'BAD_CODE: use 1 to 4 letters or digits'; end if;
  insert into kot_series (event_id, seq) values (p_event, ss_kot_floor(p_event)) on conflict (event_id) do nothing;
  select codes into v_codes from kot_series where event_id = p_event for update;
  if exists (select 1 from jsonb_each_text(v_codes) x where upper(x.value) = v_code and x.key <> v_key) then
    raise exception 'CODE_TAKEN: % is already used by another course or category', v_code;
  end if;
  update kot_series set codes = codes || jsonb_build_object(v_key, v_code), updated_at = now()
   where event_id = p_event returning codes into v_codes;
  return v_codes;
end $$;

grant execute on function ss_kot_floor(uuid)               to anon, authenticated;
grant execute on function ss_kot_no(uuid, text)            to anon, authenticated;
grant execute on function ss_kot_code(uuid, text)          to anon, authenticated;
grant execute on function ss_kot_code_set(uuid, text, text) to anon, authenticated;

-- put existing rows right: never below the event's highest KOT number
update kot_series s set seq = ss_kot_floor(s.event_id), updated_at = now()
 where s.seq < ss_kot_floor(s.event_id);

notify pgrst, 'reload schema';

-- Check (what the SQL Editor shows): the next KOT number of each event that has a series
select e.name as event, s.seq + 1 as next_kot_number
  from kot_series s join events e on e.id = s.event_id
 order by e.date desc, e.name
 limit 20;

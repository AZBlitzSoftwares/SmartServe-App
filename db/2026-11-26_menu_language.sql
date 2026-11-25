-- =====================================================================
-- Menu in a second language (v2.18)
--
-- An event can show its menu in English plus one more language
-- (Gujarati, Hindi, Marathi, Tamil, Arabic, Chinese, Japanese…).
-- Guests and captains see both on every dish; KOTs stay English.
--
--   events.menu_lang       'gu', 'hi', 'ja' … (empty = English only)
--   events.i18n            { "gu": { "courses": { "Soup": "સૂપ" } } }
--   menu_items.i18n        { "gu": { "name": "…", "description": "…" } }
--   menu_categories.i18n   { "gu": { "name": "…" } }
--   food_master.i18n       the same as menu_items, for the dish library
--
-- Only adds empty columns: the app as it is today ignores them, so this is
-- safe to run before the update is deployed, at any time, and twice.
-- Run once in the Supabase SQL Editor.
-- The Offline Kit copies the columns to the laptop at Prepare Event.
-- =====================================================================

alter table events          add column if not exists menu_lang text;
alter table events          add column if not exists i18n jsonb;
alter table menu_items      add column if not exists i18n jsonb;
alter table menu_categories add column if not exists i18n jsonb;
alter table food_master     add column if not exists i18n jsonb;

-- PostgREST caches the table shapes: tell it about the new columns now
notify pgrst, 'reload schema';

-- Check: five rows, one per column
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'events' and column_name in ('menu_lang', 'i18n'))
     or (table_name in ('menu_items', 'menu_categories', 'food_master') and column_name = 'i18n'))
 order by table_name, column_name;

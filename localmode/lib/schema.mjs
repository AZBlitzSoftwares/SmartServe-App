// Rebuilds the cloud's "public" schema in the laptop's database without
// pg_dump (which embedded-postgres does not ship): read the catalog of the
// cloud database, generate CREATE statements, run them one by one here.
//
// Row level security policies are deliberately NOT copied: on the laptop the
// API is only reachable on the event router, and every table is open to the
// anon role, which is what the app's policies amount to anyway.
import fs from 'node:fs'
import { P, DB_NAME, qi } from './common.mjs'
import { connectLocal } from './runtime.mjs'

// Objects that belong to an extension are recreated by the extension itself.
const notExt = (catalog, oid) =>
  `not exists (select 1 from pg_depend d where d.classid = '${catalog}'::regclass and d.objid = ${oid} and d.deptype = 'e')`

// Supabase platform extensions: meaningless (or not available) on the laptop.
const SKIP_EXTENSIONS = new Set(['plpgsql', 'pg_graphql', 'pg_net', 'pgsodium', 'supabase_vault',
  'pg_stat_statements', 'pgjwt', 'pg_cron', 'index_advisor', 'hypopg'])

// Schemas that only exist on Supabase. A function that mentions one can be
// created locally (plpgsql is only checked when called) but fails if used.
const SUPABASE_ONLY = /\b(auth|storage|realtime|vault|graphql|graphql_public|net|pgsodium|supabase_functions|cron)\s*\.\s*"?[a-z_]/i

const Q = {
  extensions: `select e.extname as name, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1`,

  enums: `
    select t.typname as name,
           format('create type public.%I as enum (%s)', t.typname,
                  (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)
                     from pg_enum e where e.enumtypid = t.oid)) as sql
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'e' and ${notExt('pg_type', 't.oid')}
     order by 1`,

  domains: `
    select t.typname as name,
           format('create domain public.%I as %s%s%s%s', t.typname, format_type(t.typbasetype, t.typtypmod),
                  case when t.typdefault is not null then ' default ' || t.typdefault else '' end,
                  case when t.typnotnull then ' not null' else '' end,
                  coalesce((select string_agg(format(' constraint %I %s', c.conname, pg_get_constraintdef(c.oid)), '' order by c.conname)
                              from pg_constraint c where c.contypid = t.oid and c.contype = 'c'), '')) as sql
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'd' and ${notExt('pg_type', 't.oid')}
     order by 1`,

  composites: `
    select t.typname as name,
           format('create type public.%I as (%s)', t.typname,
                  (select string_agg(format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' order by a.attnum)
                     from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped)) as sql
      from pg_type t join pg_class c on c.oid = t.typrelid join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'c' and c.relkind = 'c' and ${notExt('pg_type', 't.oid')}
     order by 1`,

  // Identity sequences are made by their column, so only the others here.
  sequences: `
    select c.relname as name,
           format('create sequence public.%I as %s increment by %s minvalue %s maxvalue %s start with %s cache %s%s',
                  c.relname, format_type(s.seqtypid, null), s.seqincrement, s.seqmin, s.seqmax, s.seqstart, s.seqcache,
                  case when s.seqcycle then ' cycle' else '' end) as sql,
           (select format('alter sequence public.%I owned by public.%I.%I', c.relname, tc.relname, a.attname)
              from pg_depend d join pg_class tc on tc.oid = d.refobjid
              join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
             where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_class'::regclass
               and d.deptype = 'a' limit 1) as owned_sql
      from pg_sequence s join pg_class c on c.oid = s.seqrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and ${notExt('pg_class', 'c.oid')}
       and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'i')
     order by 1`,

  tables: `
    select c.relname as name, c.relpersistence as persistence, c.relkind as kind, c.relispartition as is_partition
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and ${notExt('pg_class', 'c.oid')}
     order by 1`,

  columns: `
    select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
           a.attidentity as identity, a.attgenerated as generated, pg_get_expr(d.adbin, d.adrelid) as def
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`,

  constraints: `
    select c.relname as tbl, k.conname as name, k.contype as type, pg_get_constraintdef(k.oid) as def
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and k.contype in ('p', 'u', 'x', 'c', 'f') and k.coninhcount = 0
       and ${notExt('pg_class', 'c.oid')}
     order by case k.contype when 'p' then 1 when 'u' then 2 when 'x' then 3 when 'c' then 4 else 5 end, c.relname, k.conname`,

  // Indexes that back a primary key / unique / exclusion constraint come with the constraint.
  indexes: `
    select ic.relname as name, c.relname as tbl, pg_get_indexdef(i.indexrelid) as sql
      from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and ${notExt('pg_class', 'c.oid')}
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.conrelid = i.indrelid and k.contype in ('p', 'u', 'x'))
     order by 2, 1`,

  views: `
    select c.relname as name,
           format('create %sview public.%I%s as %s%s',
                  case when c.relkind = 'm' then 'materialized ' else '' end, c.relname,
                  case when c.reloptions is not null then ' with (' || array_to_string(c.reloptions, ', ') || ')' else '' end,
                  rtrim(pg_get_viewdef(c.oid), E'; \\n'),
                  case when c.relkind = 'm' then ' with data' else '' end) as sql
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm') and ${notExt('pg_class', 'c.oid')}
     order by 1`,

  functions: `
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
           pg_get_functiondef(p.oid) as sql, p.prosrc as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p') and ${notExt('pg_proc', 'p.oid')}
     order by 1`,

  triggers: `
    select t.tgname as trg, c.relname as tbl, pg_get_triggerdef(t.oid) as sql, t.tgenabled as enabled
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and ${notExt('pg_class', 'c.oid')}
     order by 2, 1`,
}

// Read the cloud schema and turn it into statements (nothing is run here).
export async function readCloudSchema(cloud) {
  const r = {}
  await cloud.query('begin isolation level repeatable read read only')
  try {
    // With only pg_catalog on the path, every name in the generated SQL
    // carries its schema (public.orders, extensions.uuid_generate_v4()...).
    await cloud.query('set local search_path = pg_catalog')
    for (const [k, sql] of Object.entries(Q)) r[k] = (await cloud.query(sql)).rows
    await cloud.query('commit')
  } catch (e) {
    await cloud.query('rollback').catch(() => {})
    throw e
  }

  const st = []
  const add = (kind, name, sql) => st.push({ kind, name, sql })
  const unsupported = []

  for (const e of r.extensions) {
    if (SKIP_EXTENSIONS.has(e.name)) continue
    if (e.name === 'uuid-ossp' || e.name === 'pgcrypto') continue // always made, see setupStatements()
    if (e.schema === 'public' || e.schema === 'extensions') {
      add('extension', e.name, `create extension if not exists ${qi(e.name)} schema ${qi(e.schema)}`)
    }
  }
  for (const t of r.enums) add('type', `type ${t.name}`, t.sql)
  for (const t of r.domains) add('type', `domain ${t.name}`, t.sql)
  for (const t of r.composites) add('type', `type ${t.name}`, t.sql)
  for (const s of r.sequences) add('sequence', `sequence ${s.name}`, s.sql)

  const tables = new Map()
  for (const t of r.tables) {
    if (t.kind !== 'r' || t.is_partition) { unsupported.push(`table ${t.name} (partitioned tables are not supported)`); continue }
    const cols = r.columns.filter((c) => c.tbl === t.name)
    tables.set(t.name, cols.map((c) => ({ name: c.col, type: c.type, generated: c.generated === 's', identity: c.identity || '' })))
    const defs = cols.map((c) => {
      let s = `${qi(c.col)} ${c.type}`
      if (c.generated === 's') s += ` generated always as (${c.def}) stored`
      else if (c.identity === 'a') s += ' generated always as identity'
      else if (c.identity === 'd') s += ' generated by default as identity'
      else if (c.def != null) s += ` default ${c.def}`
      if (c.notnull) s += ' not null'
      return s
    })
    add('table', `table ${t.name}`, `create ${t.persistence === 'u' ? 'unlogged ' : ''}table public.${qi(t.name)} (\n  ${defs.join(',\n  ')}\n)`)
  }
  for (const f of r.functions) add('function', `function ${f.name}`, f.sql)
  for (const k of r.constraints) {
    const kind = k.type === 'f' ? 'foreign key' : 'constraint'
    add(kind, `${kind} ${k.name} on ${k.tbl}`, `alter table public.${qi(k.tbl)} add constraint ${qi(k.name)} ${k.def}`)
  }
  for (const i of r.indexes) add('index', `index ${i.name} on ${i.tbl}`, i.sql)
  for (const v of r.views) add('view', `view ${v.name}`, v.sql)
  for (const t of r.triggers) add('trigger', `trigger ${t.trg} on ${t.tbl}`, t.sql)

  const final = []
  for (const s of r.sequences) if (s.owned_sql) final.push({ kind: 'sequence', name: `sequence ${s.name} ownership`, sql: s.owned_sql })
  for (const t of r.triggers) {
    if (t.enabled === 'D') final.push({ kind: 'trigger', name: `trigger ${t.trg} (disabled)`, sql: `alter table public.${qi(t.tbl)} disable trigger ${qi(t.trg)}` })
  }

  const srcByName = new Map(r.functions.map((f) => [`function ${f.name}`, f.src || '']))
  return { statements: st, final, tables, unsupported, srcByName }
}

// Roles PostgREST uses; same names as on Supabase so function grants still make sense.
const rolesSql = (apiPassword) => [
  `do $$ begin
     if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
     if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
     if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
     if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
   end $$`,
  `alter role authenticator with login password '${apiPassword}'`, // hex only, safe to inline
  'grant anon, authenticated, service_role to authenticator',
]

export const setupStatements = () => [
  { kind: 'setup', name: 'schema extensions', sql: 'create schema if not exists extensions' },
  { kind: 'setup', name: 'extension uuid-ossp', sql: 'create extension if not exists "uuid-ossp" schema extensions' },
  { kind: 'setup', name: 'extension pgcrypto', sql: 'create extension if not exists pgcrypto schema extensions' },
  // The uploader's memory of what the cloud already has (not visible through the API).
  { kind: 'setup', name: 'schema ss_local', sql: 'create schema if not exists ss_local' },
  { kind: 'setup', name: 'table ss_local.uploaded', sql: 'create table if not exists ss_local.uploaded (tbl text not null, id text not null, hash text not null, primary key (tbl, id))' },
]

export const grantStatements = () => [
  'grant usage on schema public, extensions to anon, authenticated, service_role',
  'grant all on all tables in schema public to anon, authenticated, service_role',
  'grant all on all sequences in schema public to anon, authenticated, service_role',
  'grant all on all routines in schema public to anon, authenticated, service_role',
].map((sql) => ({ kind: 'grant', name: 'grants', sql }))

// Run statements; whatever fails is tried again after the others, until
// nothing more succeeds. That settles dependencies without sorting them
// (a view that uses a function, a default that calls a function...).
export async function runUntilSettled(db, list) {
  let pending = list
  let relaxed = false
  for (;;) {
    const failed = []
    for (const s of pending) {
      try { await db.query(s.sql); s.error = null } catch (e) { s.error = e.message; failed.push(s) }
    }
    if (failed.length === 0) return []
    if (failed.length < pending.length) { pending = failed; continue }
    // Stuck. A table and an SQL function that need each other can only be
    // made by creating the function without checking its body first.
    if (!relaxed && failed.some((s) => s.kind === 'table')) {
      relaxed = true
      await db.query('set check_function_bodies = off')
      pending = failed
      continue
    }
    return failed
  }
}

// Drop and recreate the local database "smartserve" (empty) and the API roles.
export async function freshDatabase(local) {
  const admin = await connectLocal(local, 'postgres')
  try {
    await admin.query(`drop database if exists ${DB_NAME} with (force)`)
    await admin.query(`create database ${DB_NAME} template template0 encoding 'UTF8'`)
    for (const sql of rolesSql(local.apiPassword)) await admin.query(sql)
  } finally {
    await admin.end().catch(() => {})
  }
  const db = await connectLocal(local)
  try {
    await db.query(`alter database ${DB_NAME} set search_path = "$user", public, extensions`)
  } finally {
    await db.end().catch(() => {})
  }
}

// Every table/function made later (../db/*.sql in test mode) is open to the app too.
export async function grantAll(db) {
  for (const s of grantStatements()) await db.query(s.sql)
}

// Recreate the local database "smartserve" from scratch and build the schema.
export async function buildLocalDatabase(local, schema, cloudLabel) {
  await freshDatabase(local)

  const db = await connectLocal(local)
  try {
    await db.query('set search_path = "$user", public, extensions')
    const all = [...setupStatements(), ...schema.statements]
    const failed = await runUntilSettled(db, all)
    const finals = [...schema.final, ...grantStatements()]
    for (const s of finals) {
      try { await db.query(s.sql); s.error = null } catch (e) { s.error = e.message; failed.push(s) }
    }

    const warnings = []
    for (const s of schema.statements) {
      if (s.kind === 'function' && !s.error && SUPABASE_ONLY.test(schema.srcByName.get(s.name) || '')) {
        const m = (schema.srcByName.get(s.name) || '').match(SUPABASE_ONLY)
        warnings.push(`${s.name} uses ${m[1]}.* (Supabase only) - fails if it is called on the local server`)
      }
    }

    const text = [
      `-- Janu's Smart Serve local server: schema copied from ${cloudLabel} on ${new Date().toISOString()}`,
      '-- Generated by "ss-local.mjs prepare" (for inspection only). Failed statements are commented out.',
      '',
      ...[...all, ...finals].map((s) => s.error
        ? `-- [${s.kind}] ${s.name} -- FAILED LOCALLY: ${s.error}\n${s.sql.split('\n').map((l) => '-- ' + l).join('\n')}\n`
        : `-- [${s.kind}] ${s.name}\n${s.sql};\n`),
    ].join('\n')
    fs.writeFileSync(P.schemaSql, text)

    const ok = (kind) => schema.statements.filter((s) => s.kind === kind && !s.error).length
    const counts = { tables: ok('table'), views: ok('view'), functions: ok('function'), triggers: ok('trigger'), indexes: ok('index'), types: ok('type') }
    return { failed, warnings, counts }
  } finally {
    await db.end().catch(() => {})
  }
}

// Table -> column names, for comparing the cloud and the laptop on a refresh.
export async function tableColumns(client) {
  const { rows } = await client.query(`
    select c.relname as tbl, a.attname as col, a.attgenerated as generated
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`)
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.tbl)) m.set(r.tbl, [])
    m.get(r.tbl).push({ name: r.col, generated: r.generated === 's' })
  }
  return m
}

export function schemaDrift(cloudTables, localTables) {
  const out = []
  for (const [t, cols] of cloudTables) {
    if (!localTables.has(t)) { out.push(`table ${t} is new in the cloud`); continue }
    const have = new Set(localTables.get(t).map((c) => c.name))
    for (const c of cols) if (!have.has(c.name)) out.push(`column ${t}.${c.name} is new in the cloud`)
  }
  for (const t of localTables.keys()) if (!cloudTables.has(t)) out.push(`table ${t} no longer exists in the cloud`)
  return out
}

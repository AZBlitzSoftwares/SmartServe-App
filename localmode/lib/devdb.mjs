// Test mode ("prepare --dev"): database changes that are not in the cloud yet
// (../db/*.sql) are tried out on the LAPTOP's database only. This file never
// connects to the cloud - every function here gets the local database.
import fs from 'node:fs'
import path from 'node:path'
import { REPO, HERE } from './common.mjs'
import { runUntilSettled } from './schema.mjs'

export const DB_DIR = path.join(REPO, 'db')
export const STANDIN_SQL = path.join(HERE, 'dev', 'standin-schema.sql')

// Lines that only make sense on Supabase. If one of them fails locally it is
// reported as "skipped", not as a problem.
const SUPABASE_ONLY = /supabase_realtime|pg_publication|\bpublication\b|notify\s+pgrst|\b(auth|storage|realtime|vault|net|pgsodium|supabase_functions|cron)\s*\.|\bsupabase_admin\b|\bpgsodium\b|\bpg_net\b/i

// Split an SQL script into statements. Knows about 'strings', "names",
// $tag$ bodies $tag$, -- comments and /* comments */, so the semicolons inside
// a function body do not end the statement.
export function splitSql(text) {
  const out = []
  let start = 0
  let i = 0
  const n = text.length
  const push = (end) => { const s = text.slice(start, end).trim(); if (s && !commentsOnly(s)) out.push(s) }
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '-' && d === '-') { const e = text.indexOf('\n', i); i = e < 0 ? n : e + 1; continue }
    if (c === '/' && d === '*') {
      let depth = 1; i += 2
      while (i < n && depth) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2 } else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2 } else i++
      }
      continue
    }
    if (c === "'") {
      const escapes = /[eE]/.test(text[i - 1] || '') && !/[A-Za-z0-9_]/.test(text[i - 2] || '')
      i++
      while (i < n) {
        if (escapes && text[i] === '\\') { i += 2; continue }
        if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue } i++; break }
        i++
      }
      continue
    }
    if (c === '"') {
      i++
      while (i < n) { if (text[i] === '"') { if (text[i + 1] === '"') { i += 2; continue } i++; break } i++ }
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64))
      if (m && !/[A-Za-z0-9_]/.test(text[i - 1] || '')) {
        const tag = m[0]
        const e = text.indexOf(tag, i + tag.length)
        i = e < 0 ? n : e + tag.length
        continue
      }
    }
    if (c === ';') { push(i); start = i + 1 }
    i++
  }
  push(n)
  return out
}

// Line by line on purpose: a regex over "-- -----" comment lines can take forever.
const COMMENT_LINE = /^\s*(--.*)?$/
function commentsOnly(s) { return s.split('\n').every((l) => COMMENT_LINE.test(l)) }
const label = (sql) => sql.split('\n').filter((l) => !COMMENT_LINE.test(l)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 90)
const isTxControl = (sql) => /^(begin|commit|end|rollback|start\s+transaction)(\s+(work|transaction))?\s*$/i.test(label(sql))

// Run one SQL file on the local database. First as written (one transaction
// if the file has begin/commit). If that fails, the transaction is rolled
// back and the statements are run one by one (begin/commit left out), each
// failure retried after the others; whatever still fails is reported and the
// run carries on.
export async function runSqlFile(db, file) {
  const name = path.basename(file)
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  if (/^\s*\\[a-z]/im.test(text)) {
    // psql commands (\i, \set ...) only work in psql; take them out.
    return runSqlText(db, name, text.split(/\r?\n/).filter((l) => !/^\s*\\[a-z]/i.test(l)).join('\n'), 'psql commands (\\...) were left out')
  }
  return runSqlText(db, name, text)
}

export async function runSqlText(db, name, text, note = '') {
  const res = { file: name, ok: false, mode: 'as written', statements: 0, failed: [], skipped: [], note }
  const stmts = splitSql(text).filter((s) => !isTxControl(s))
  res.statements = stmts.length
  try {
    await db.query(text)
    await db.query('rollback').catch(() => {}) // a file with "begin;" and no "commit;" would leave one open
    res.ok = true
    return res
  } catch (e) {
    await db.query('rollback').catch(() => {})
    res.firstError = e.message
  }
  res.mode = 'one by one'
  const list = stmts.map((sql) => ({ kind: 'sql', name: label(sql), sql }))
  const failed = await runUntilSettled(db, list)
  await db.query('set check_function_bodies = on').catch(() => {})
  for (const s of failed) (SUPABASE_ONLY.test(s.sql) ? res.skipped : res.failed).push({ name: s.name, error: s.error })
  res.ok = res.failed.length === 0
  return res
}

// migrationsOnly: just the dated database updates (2026-10-08_maestro.sql ...),
// never the demo files - used when an event is prepared without the database
// password (Offline Kit), where the structure comes from this kit.
export function dbFiles(dir = DB_DIR, { migrationsOnly = false } = {}) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /\.sql$/i.test(f) && (!migrationsOnly || /^\d{4}-\d{2}-\d{2}_[^/]+\.sql$/i.test(f)))
    .sort().map((f) => path.join(dir, f))
}

// Every ../db/*.sql file in name order, on the LOCAL database.
export async function applyDbFiles(db, opts = {}) {
  const out = []
  for (const f of dbFiles(DB_DIR, opts)) out.push(await runSqlFile(db, f))
  return out
}

// Report lines (and a short console summary) for applyDbFiles' results.
export function describeDbFiles(results, rep, log) {
  if (!results.length) { rep('  No .sql files in ../db.'); log('  No .sql files in ../db.'); return }
  for (const r of results) {
    const head = r.ok && !r.skipped.length
      ? `OK (${r.statements} statements${r.mode === 'one by one' ? ', run one by one' : ''})`
      : r.ok ? `OK, ${r.skipped.length} Supabase-only statement(s) skipped` : `${r.failed.length} statement(s) FAILED`
    rep(`  ${r.file}: ${head}${r.note ? ` - ${r.note}` : ''}`)
    log(`  ${r.file}: ${head}`)
    if (r.mode === 'one by one' && r.firstError) rep(`    (as one transaction it stopped at: ${r.firstError})`)
    for (const s of r.skipped) rep(`    - skipped (Supabase only): ${s.name}: ${s.error}`)
    for (const s of r.failed) { rep(`    - FAILED: ${s.name}: ${s.error}`); log(`    - FAILED: ${s.name}: ${s.error}`) }
  }
}

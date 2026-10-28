// One-way upload: rows the laptop created or changed go to the cloud through
// its REST API (same anon key the app uses). Nothing is ever downloaded or
// deleted here, except carts that were cleared on the laptop.
//
// The laptop remembers, per row, a fingerprint of what the cloud already has
// (table ss_local.uploaded, filled when the event is downloaded and after
// every successful upload). Only rows whose fingerprint changed are sent, so
// running the upload again and again sends nothing new and changes nothing.
import { P, qi, readJson, writeJson, logLine } from './common.mjs'

const BATCH = 500
const EVENT = 'event_id::text = any($1::text[])'

// Upload order matters (see uploadAll). [table, filter for the prepared events]
export const UPLOAD_TABLES = [
  ['tables', EVENT],
  ['orders', EVENT],
  ['order_items', 'order_id in (select id from public.orders where event_id::text = any($1::text[]))'],
  ['kots', EVENT],
  // Smart Serve Maestro (absent on events without it; skipped when missing)
  ['ms_covers', EVENT],
  ['ms_firings', EVENT],
  ['ms_items', EVENT],
  ['sos_requests', EVENT],
  ['sos_request_items', 'sos_request_id in (select id from public.sos_requests where event_id::text = any($1::text[]))'],
  ['chat_messages', EVENT],
  ['feedback', EVENT],
  ['contact_requests', EVENT],
  ['table_carts', EVENT],
]

// Tables where one row per thing is enforced besides the id (a cover is seated
// once, a table has one cart).
const NATURAL_KEYS = { ms_covers: 'event_id,table_number,cover_no', table_carts: 'event_id,table_number' }

export const SKIPPED_NOTE = 'printed locally / not printed — uploaded from local server'

const fingerprint = 'md5(row_to_json(t)::text)'

// Which upload tables exist here, and their generated columns (never sent).
async function localInfo(db) {
  const { rows } = await db.query(`
    select c.relname as tbl, array_agg(a.attname::text) filter (where a.attgenerated = 's') as gen,
           array_agg(a.attname::text order by a.attnum) as cols,
           bool_or(a.attname = 'id') as has_id, bool_or(a.attname = 'print_status') as has_print_status
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1::text[])
     group by c.relname`, [UPLOAD_TABLES.map((t) => t[0])])
  const m = new Map()
  for (const r of rows) if (r.has_id) m.set(r.tbl, { gen: r.gen || [], cols: r.cols || [], hasPrintStatus: r.has_print_status, added: [] })
  if ((await db.query("select to_regclass('ss_local.added_columns') as r")).rows[0].r) {
    for (const r of (await db.query('select tbl, col from ss_local.added_columns')).rows) m.get(r.tbl)?.added.push(r.col)
  }
  return m
}

const dependsOnMissing = (where, info) =>
  (where.includes('public.orders') && !info.has('orders')) || (where.includes('public.sos_requests') && !info.has('sos_requests'))

// Rows of one table that the cloud does not have in this exact state.
// drop: columns never sent (generated ones, and those the cloud does not have).
// Columns this laptop added from the cloud (prepare without the database
// password) are sent only when they hold a value: an explicit null would
// override the cloud's default, or be refused where the column is NOT NULL.
async function changedRows(db, table, where, events, info, drop = info.get(table).gen) {
  const { hasPrintStatus, added } = info.get(table)
  let base = 'to_jsonb(t) - $2::text[]'
  if (added.length) {
    const list = added.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')
    base = `(to_jsonb(t) - $2::text[]) - coalesce((select array_agg(e.key) from jsonb_each(to_jsonb(t)) e
              where e.key in (${list}) and e.value = 'null'::jsonb), '{}'::text[])`
  }
  let json = base
  let extra = ''
  if (table === 'kots' && hasPrintStatus) {
    // A KOT still waiting for the printer is sent once it is final. A failed
    // one goes up as "skipped" so no Print Hub on the cloud ever prints it.
    extra = " and t.print_status not in ('queued', 'printing')"
    json = `case when t.print_status = 'failed'
                 then (${base}) || jsonb_build_object('print_status', 'skipped', 'last_error', $3::text)
                 else ${base} end`
  }
  const sql = `
    select t.id::text as id, ${fingerprint} as h, (${json})::text as j
      from public.${qi(table)} t
     where (${where})${extra}
       and not exists (select 1 from ss_local.uploaded u
                        where u.tbl = '${table}' and u.id = t.id::text and u.hash = ${fingerprint})`
  const params = table === 'kots' && hasPrintStatus ? [events, drop, SKIPPED_NOTE] : [events, drop]
  return (await db.query(sql, params)).rows
}

// Everything still to send, per table (used by status and before a refresh).
export async function countPending(db, events) {
  const info = await localInfo(db)
  const out = {}
  let total = 0
  for (const [table, where] of UPLOAD_TABLES) {
    if (!info.has(table) || dependsOnMissing(where, info)) continue
    const { rows } = await db.query(`
      select count(*)::int as n from public.${qi(table)} t
       where (${where}) and not exists (select 1 from ss_local.uploaded u
                                         where u.tbl = '${table}' and u.id = t.id::text and u.hash = ${fingerprint})`, [events])
    if (rows[0].n) { out[table] = rows[0].n; total += rows[0].n }
  }
  if (info.has('table_carts')) {
    const { rows } = await db.query(`select count(*)::int as n from ss_local.uploaded u
       where u.tbl = 'table_carts' and not exists (select 1 from public.table_carts t where t.id::text = u.id)`)
    if (rows[0].n) { out.table_carts_cleared = rows[0].n; total += rows[0].n }
  }
  return { total, byTable: out }
}

// After a download the laptop and the cloud hold the same rows: remember them.
export async function resetUploadedBaseline(db, events) {
  const info = await localInfo(db)
  await db.query('delete from ss_local.uploaded')
  for (const [table, where] of UPLOAD_TABLES) {
    if (!info.has(table) || dependsOnMissing(where, info)) continue
    await db.query(`insert into ss_local.uploaded (tbl, id, hash)
                    select '${table}', t.id::text, ${fingerprint} from public.${qi(table)} t where ${where}`, [events])
  }
}

async function markUploaded(db, table, rows) {
  if (!rows.length) return
  await db.query(`insert into ss_local.uploaded (tbl, id, hash)
                  select $1, x.id, x.h from unnest($2::text[], $3::text[]) as x(id, h)
                  on conflict (tbl, id) do update set hash = excluded.hash`,
  [table, rows.map((r) => r.id), rows.map((r) => r.h)])
}

class CloudApi {
  constructor(cloud) { this.base = cloud.url.replace(/\/+$/, '') + '/rest/v1/'; this.key = cloud.anonKey; this.missing = new Map() }

  // Columns of the laptop's table that the cloud's table does not have (a
  // column made only on the laptop, or one the cloud dropped). Asked by
  // selecting them all: the cloud names the first unknown one; repeat.
  // Anything unexpected = assume none missing (the rows say what is wrong).
  async missingColumns(table, cols) {
    if (this.missing.has(table)) return this.missing.get(table)
    const missing = []
    let rest = cols.slice()
    for (let i = 0; i < 60 && rest.length; i++) {
      try {
        await this.call('GET', `${table}?select=${rest.map(encodeURIComponent).join(',')}&limit=0`, undefined, undefined, 15000)
        break
      } catch (e) {
        if (e.offline) throw e
        const m = /column\s+(?:"?[\w]+"?\.)?"?([\w]+)"?\s+does not exist/i.exec(e.message || '')
        if (e.status !== 400 || !m || !rest.includes(m[1])) break
        missing.push(m[1])
        rest = rest.filter((c) => c !== m[1])
      }
    }
    this.missing.set(table, missing)
    if (missing.length) logLine('upload', `${table}: not in the cloud, not sent: ${missing.join(', ')}`)
    return missing
  }

  async call(method, pathq, body, prefer, timeoutMs = 30000) {
    let res
    try {
      res = await fetch(this.base + pathq, {
        method,
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const err = new Error(`cloud not reachable (${e.name === 'TimeoutError' ? 'timed out' : e.cause?.code || e.message})`)
      err.offline = true
      throw err
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 400)
      const err = new Error(res.status === 401 || res.status === 403
        ? 'the cloud refused the anon key - check "anonKey" in config.json'
        : `HTTP ${res.status} ${text}`)
      err.status = res.status
      // 400/409/422 = something wrong with these rows; anything else = stop.
      err.rowProblem = [400, 409, 422].includes(res.status)
      throw err
    }
    return method === 'GET' ? res.json() : null
  }

  // POST rows as an upsert on id. A rejected batch is retried row by row so
  // one bad row does not hold back the others.
  async push(table, rows, mode, failed) {
    const prefer = `resolution=${mode}-duplicates,return=minimal`
    const ok = []
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      try {
        await this.call('POST', `${table}?on_conflict=id`, '[' + batch.map((r) => r.j).join(',') + ']', prefer, 60000)
        ok.push(...batch)
      } catch (e) {
        if (!e.rowProblem) throw e
        for (const r of batch) {
          try {
            await this.call('POST', `${table}?on_conflict=id`, '[' + r.j + ']', prefer)
            ok.push(r)
          } catch (e2) {
            if (!e2.rowProblem) throw e2
            // The same seat or cart was also made in the cloud (under another id),
            // e.g. a cover seated there after the last refresh: merge on what it is.
            const nk = NATURAL_KEYS[table]
            if (nk && e2.status === 409 && mode === 'merge') {
              try {
                await this.call('POST', `${table}?on_conflict=${nk}`, '[' + r.j + ']', prefer)
                ok.push(r)
                continue
              } catch (e3) {
                if (!e3.rowProblem) throw e3
              }
            }
            failed.push({ table, id: r.id, error: e2.message })
          }
        }
      }
    }
    return ok
  }
}

// Quick "is there internet to the cloud?" check.
export async function cloudAnswers(cloud, timeoutMs = 5000) {
  try {
    await new CloudApi(cloud).call('GET', 'events?select=id&limit=1', undefined, undefined, timeoutMs)
    return true
  } catch {
    return false
  }
}

export async function uploadAll(db, cloud, events, { all = false } = {}) {
  const api = new CloudApi(cloud)
  const result = { at: new Date().toISOString(), ok: false, offline: false, sent: {}, total: 0, failed: [], cleared: 0, kotSeqRaised: 0, waitingToPrint: 0 }
  try {
    if (all) await db.query('delete from ss_local.uploaded') // re-send everything (technical use)
    const info = await localInfo(db)
    const has = (t) => info.has(t)
    const rowsOf = async (t) => {
      const where = UPLOAD_TABLES.find((x) => x[0] === t)[1]
      if (!has(t) || dependsOnMissing(where, info)) return []
      const rows = await changedRows(db, t, where, events, info)
      if (!rows.length) return rows
      // Never send a column the cloud does not have: it would refuse the whole row.
      const missing = await api.missingColumns(t, info.get(t).cols.filter((c) => !info.get(t).gen.includes(c)))
      return missing.length ? changedRows(db, t, where, events, info, [...info.get(t).gen, ...missing]) : rows
    }
    const send = async (t, rows, mode = 'merge') => {
      const ok = await api.push(t, rows, mode, result.failed)
      if (mode === 'merge') {
        await markUploaded(db, t, ok)
        if (ok.length) { result.sent[t] = (result.sent[t] || 0) + ok.length; result.total += ok.length }
      }
    }

    await send('tables', await rowsOf('tables'))
    // Orders: insert the new ones first (their dishes and KOTs point at them),
    // but apply status changes only after the KOTs are up to date. The cloud
    // reacts to an order turning "cancelled" by cancelling its open KOTs and
    // printing CANCEL slips; with the KOTs already uploaded as cancelled it
    // finds nothing left to do, so no slip is printed twice.
    const orders = await rowsOf('orders')
    await send('orders', orders, 'ignore')
    await send('order_items', await rowsOf('order_items'))
    await send('ms_covers', await rowsOf('ms_covers'))
    await send('ms_firings', await rowsOf('ms_firings'))
    await send('kots', await rowsOf('kots'))
    await send('ms_items', await rowsOf('ms_items'))
    await send('orders', orders, 'merge')
    for (const t of ['sos_requests', 'sos_request_items', 'chat_messages', 'feedback', 'table_carts']) await send(t, await rowsOf(t))

    // Carts are temporary: one cleared on the laptop is removed from the cloud too.
    if (has('table_carts')) {
      const gone = (await db.query(`select u.id from ss_local.uploaded u where u.tbl = 'table_carts'
                                     and not exists (select 1 from public.table_carts t where t.id::text = u.id)`)).rows.map((r) => r.id)
      for (let i = 0; i < gone.length; i += 100) {
        const ids = gone.slice(i, i + 100)
        await api.call('DELETE', `table_carts?id=in.(${ids.join(',')})`, undefined, 'return=minimal')
        await db.query("delete from ss_local.uploaded where tbl = 'table_carts' and id = any($1::text[])", [ids])
        result.cleared += ids.length
      }
    }

    // Kitchens: the cloud's next KOT number must come after the laptop's
    // (kot_seq_b is Barker B's series on Smart Serve Maestro events).
    if ((await db.query("select to_regclass('public.kitchens') as r")).rows[0].r) {
      const hasB = (await db.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'kitchens' and column_name = 'kot_seq_b'")).rowCount > 0
      const local = (await db.query(`select id::text as id, kot_seq${hasB ? ', kot_seq_b' : ''} from public.kitchens where event_id::text = any($1::text[])`, [events])).rows
      if (local.length) {
        const remote = await api.call('GET', `kitchens?select=id,kot_seq${hasB ? ',kot_seq_b' : ''}&event_id=in.(${events.join(',')})`)
        for (const k of local) {
          const c = remote.find((x) => x.id === k.id)
          const patch = {}
          if (c && Number(k.kot_seq) > Number(c.kot_seq)) patch.kot_seq = Number(k.kot_seq)
          if (c && hasB && Number(k.kot_seq_b) > Number(c.kot_seq_b)) patch.kot_seq_b = Number(k.kot_seq_b)
          if (Object.keys(patch).length) {
            await api.call('PATCH', `kitchens?id=eq.${k.id}`, JSON.stringify(patch), 'return=minimal')
            result.kotSeqRaised++
          }
        }
      }
    }

    // Contact us details (guest tablets): last, and never a reason to stop the
    // upload - a cloud that has not had db/2026-10-29_contact_requests.sql yet
    // answers 404 for the table. They stay on the laptop and go next time.
    try {
      await send('contact_requests', await rowsOf('contact_requests'))
    } catch (e) {
      if (e.offline) throw e
      logLine('upload', `contact_requests: not sent this time (${e.message})`)
    }

    if (has('kots') && info.get('kots').hasPrintStatus) {
      result.waitingToPrint = (await db.query(`select count(*)::int as n from public.kots t where ${EVENT} and print_status in ('queued', 'printing')`, [events])).rows[0].n
    }
    result.ok = result.failed.length === 0
  } catch (e) {
    result.offline = !!e.offline
    result.error = e.message
  }
  result.pending = (await countPending(db, events).catch(() => ({ total: null }))).total
  // A new order that failed shows up in both order passes: list it once.
  const seen = new Set()
  result.failed = result.failed.filter((f) => !seen.has(f.table + f.id) && seen.add(f.table + f.id))
  result.failedCount = result.failed.length
  result.failed = result.failed.slice(0, 20)
  writeJson(P.lastUpload, result)
  logLine('upload', JSON.stringify(result))
  return result
}

export function describeUpload(r) {
  if (!r) return 'no upload yet'
  if (r.error) return r.offline ? 'cloud not reachable - will try again' : `stopped: ${r.error}`
  const parts = []
  if (r.total) parts.push(`${r.total} rows sent`)
  if (r.cleared) parts.push(`${r.cleared} carts cleared`)
  if (r.kotSeqRaised) parts.push(`KOT numbers raised in ${r.kotSeqRaised} kitchen(s)`)
  if (!parts.length) parts.push('cloud already up to date')
  if (r.failedCount) parts.push(`${r.failedCount} rows FAILED`)
  if (r.waitingToPrint) parts.push(`${r.waitingToPrint} KOTs wait for the printer first`)
  return parts.join(', ')
}

export const lastUpload = () => readJson(P.lastUpload, null)

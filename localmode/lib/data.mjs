// What "prepare" copies besides the schema: the chosen events' rows, their
// pictures and videos, and the built app.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'
import { P, REPO, qi, UserError, localDate, addDays, fmtDay, saveConfig } from './common.mjs'
import { downloadFile } from './runtime.mjs'
import { tableColumns } from './schema.mjs'
import { resetUploadedBaseline } from './upload.mjs'

const EV = 'event_id::text = any($1::text[])'
const EVENT_COLS = `e.id::text as id, e.name, e.date::text as date, to_jsonb(e)->>'service_mode' as service_mode,
                    coalesce((to_jsonb(e)->>'multi_kitchen')::boolean, false) as multi_kitchen`

// ---------------------------------------------------------------- choosing events

// One reader for the whole question loop (a new one per question would lose
// lines that were already typed ahead).
// onClose: the answer when the input ends (none = stop with an error).
function lineReader(onClose) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const queue = []
  let waiting = null
  let closed = false
  const ended = () => (onClose !== undefined ? Promise.resolve(onClose) : Promise.reject(new UserError('No event was chosen.')))
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w.resolve(l) } else queue.push(l) })
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; ended().then(w.resolve, w.reject) } })
  return {
    ask(question) {
      process.stdout.write(question)
      if (queue.length) return Promise.resolve(queue.shift())
      if (closed) return ended()
      return new Promise((resolve, reject) => { waiting = { resolve, reject } })
    },
    close() { rl.close() },
  }
}

export async function eventsById(cloud, ids) {
  const { rows } = await cloud.query(`select ${EVENT_COLS} from public.events e where e.id::text = any($1::text[]) order by e.date, e.name`, [ids])
  return rows
}

// The operator picks the event(s) from the list of the coming days. The
// choice is remembered in config.json and offered again (Enter keeps it), so
// back-to-back events never download the wrong one by accident.
// Test mode (optional = true): real events are an extra, Enter = none (the
// demo events come from "ss-local.mjs demo"), and the choice is not remembered.
export async function chooseEvents(cloud, cfg, { optional = false } = {}) {
  const from = localDate(addDays(-1))
  const to = localDate(addDays(10))
  const { rows } = await cloud.query(`select ${EVENT_COLS} from public.events e where e.date between $1 and $2 order by e.date, e.name`, [from, to])
  if (!rows.length && optional) {
    console.log(`  No real events dated ${fmtDay(from)} to ${fmtDay(to)} in the cloud - fine for testing ("demo" makes test events).`)
    return []
  }
  if (!rows.length) {
    throw new UserError(`No events are dated between ${fmtDay(from)} and ${fmtDay(to)} in the cloud.\n` +
      'Check the event date in Event Manager, then run Prepare Event again.')
  }
  if (optional) {
    console.log(`\nReal events from ${fmtDay(from)} to ${fmtDay(to)} (copied READ-ONLY, only if you want them):\n`)
    rows.forEach((e, i) => {
      const mode = e.service_mode === 'captain' ? 'captain service' : 'guest self-service'
      console.log(`   ${String(i + 1).padStart(2)})  ${fmtDay(e.date)}   ${e.name.padEnd(28)}  ${mode.padEnd(18)}  ${e.multi_kitchen ? 'multi-kitchen' : ''}`)
    })
    const reader = lineReader('')
    try {
      for (;;) {
        const a = (await reader.ask('\nType the number(s) of real events to copy as well (several: 1,2), or just press Enter for none: ')).trim()
        if (!a) return []
        const nums = a.split(/[\s,;]+/).filter(Boolean).map(Number)
        if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= rows.length)) return [...new Set(nums)].map((n) => rows[n - 1])
        console.log(`Please type a number from 1 to ${rows.length}, or press Enter for none.`)
      }
    } finally {
      reader.close()
    }
  }
  const remembered = rows.map((e, i) => (cfg.events.includes(e.id) ? i + 1 : 0)).filter(Boolean)
  console.log(`\nEvents from ${fmtDay(from)} to ${fmtDay(to)}:\n`)
  rows.forEach((e, i) => {
    const mode = e.service_mode === 'captain' ? 'captain service' : 'guest self-service'
    const mark = remembered.includes(i + 1) ? '*' : ' '
    console.log(` ${mark}${String(i + 1).padStart(2)})  ${fmtDay(e.date)}   ${e.name.padEnd(28)}  ${mode.padEnd(18)}  ${e.multi_kitchen ? 'multi-kitchen' : ''}`)
  })
  console.log(remembered.length ? '\n  * = downloaded last time\n' : '')
  const question = remembered.length
    ? `Type the number of the event to download (several: 1,2), or just press Enter for ${remembered.join(',')}: `
    : 'Type the number of the event to download (several: 1,2) and press Enter: '
  const reader = lineReader()
  try {
    for (;;) {
      const a = (await reader.ask(question)).trim()
      const nums = a ? a.split(/[\s,;]+/).filter(Boolean).map(Number) : remembered
      if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= rows.length)) {
        const chosen = [...new Set(nums)].map((n) => rows[n - 1])
        cfg.events = chosen.map((e) => e.id)
        saveConfig(cfg)
        return chosen
      }
      console.log(`Please type a number from 1 to ${rows.length}.`)
    }
  } finally {
    reader.close()
  }
}

// ---------------------------------------------------------------- rows

// Which rows of which table belong to the chosen events. Tables that do not
// exist in the cloud are skipped; any other table with an event_id is copied
// by event; everything else is listed in the report as "not copied".
function copyPlan(tables) {
  const has = (t, c) => tables.has(t) && (!c || tables.get(t).some((x) => x.name === c))
  const rules = [
    ['admins', ''],
    ['food_master', ''],
    ['events', 'id::text = any($1::text[])'],
    ['help_items', `${EV} or event_id is null`, 'event_id'],
    ...['supervisors', 'tables', 'captains', 'waiters', 'kitchens', 'barkers', 'menu_categories', 'table_carts',
      'orders', 'ms_covers', 'ms_firings', 'kots', 'ms_items', 'sos_requests', 'chat_messages', 'feedback'].map((t) => [t, EV, 'event_id']),
    ['menu_items', `category_id in (select id from public.menu_categories where ${EV})`, 'category_id', 'menu_categories'],
    ['order_items', `order_id in (select id from public.orders where ${EV})`, 'order_id', 'orders'],
    ['sos_request_items', `sos_request_id in (select id from public.sos_requests where ${EV})`, 'sos_request_id', 'sos_requests'],
  ]
  const copy = []
  const done = new Set()
  for (const [t, where, col, parent] of rules) {
    if (!tables.has(t)) continue
    if ((col && !has(t, col)) || (parent && !has(parent, 'event_id'))) {
      if (!has(t, 'event_id')) continue
      copy.push({ table: t, where: EV })
    } else {
      copy.push({ table: t, where })
    }
    done.add(t)
  }
  for (const t of tables.keys()) {
    if (!done.has(t) && has(t, 'event_id')) { copy.push({ table: t, where: EV }); done.add(t) }
  }
  return { copy, notCopied: [...tables.keys()].filter((t) => !done.has(t)) }
}

// Read everything from the cloud in one consistent snapshot (nothing local changes yet).
export async function downloadEventData(cloud, eventIds, cloudTables) {
  const plan = copyPlan(cloudTables)
  // Columns the cloud has, per table. A column that exists only on the laptop
  // (test mode adds ../db/*.sql) keeps its default instead of getting NULL.
  plan.cloudCols = Object.fromEntries([...cloudTables].map(([t, cols]) => [t, cols.map((c) => c.name)]))
  await cloud.query('begin isolation level repeatable read read only')
  try {
    for (const p of plan.copy) {
      const where = p.where ? `where ${p.where}` : ''
      const { rows } = await cloud.query(
        `select count(*)::int as n, coalesce(json_agg(t), '[]')::text as j from public.${qi(p.table)} t ${where}`,
        p.where.includes('$1') ? [eventIds] : [])
      p.n = rows[0].n
      p.json = rows[0].j // kept as text: big numbers and odd types pass through untouched
    }
    plan.seqs = (await cloud.query(`
      select c.relname as name, s.last_value::text as value, tc.relname as ident_table, a.attname as ident_col
        from pg_sequences s
        join pg_class c on c.relname = s.sequencename and c.relnamespace = 'public'::regnamespace
        left join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'i'
        left join pg_class tc on tc.oid = d.refobjid
        left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
       where s.schemaname = 'public' and s.last_value is not null`)).rows
    await cloud.query('commit')
  } catch (e) {
    await cloud.query('rollback').catch(() => {})
    throw e
  }
  return plan
}

// ---------------------------------------------------------------- pictures and videos

const MEDIA_COLS = { events: ['catering_logo_url', 'banner_image_url', 'video_url'], menu_items: ['photo_url'] }
const TYPE_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
}

export function mediaUrls(plan) {
  const urls = new Set()
  for (const [t, cols] of Object.entries(MEDIA_COLS)) {
    const p = plan.copy.find((x) => x.table === t)
    if (!p) continue
    for (const row of JSON.parse(p.json)) {
      for (const c of cols) if (typeof row[c] === 'string' && /^https?:\/\//i.test(row[c].trim())) urls.add(row[c])
    }
  }
  return [...urls]
}

// Files are named after the URL (sha1), so a refresh only fetches new ones.
// On a refresh at the venue the internet may be slow: stop after budgetMs.
export async function downloadMedia(urls, { budgetMs } = {}) {
  fs.mkdirSync(P.media, { recursive: true })
  const have = new Map()
  for (const f of fs.readdirSync(P.media)) if (!f.endsWith('.part') && !f.endsWith('.download')) have.set(f.split('.')[0], f)
  const deadline = budgetMs ? Date.now() + budgetMs : Infinity
  const map = {}
  const failed = []
  let fetched = 0
  for (const url of urls) {
    const sha = crypto.createHash('sha1').update(url).digest('hex')
    if (have.has(sha)) { map[url] = '/media/' + have.get(sha); continue }
    if (Date.now() > deadline) { failed.push({ url, reason: 'skipped - out of time (refresh)' }); continue }
    const tmp = path.join(P.media, sha + '.download')
    try {
      const { type } = await downloadFile(url.trim(), tmp, 120000, 500 * 1024 * 1024)
      const ct = type.split(';')[0].trim().toLowerCase()
      if (!(ct.startsWith('image/') || ct.startsWith('video/') || /octet-stream/.test(ct))) {
        throw new Error(`not a picture or video (${ct || 'unknown type'})`)
      }
      let ext = path.extname(new URL(url.trim()).pathname).toLowerCase()
      if (!/^\.[a-z0-9]{2,5}$/.test(ext)) ext = TYPE_EXT[ct] || '.bin'
      fs.renameSync(tmp, path.join(P.media, sha + ext))
      map[url] = `/media/${sha}${ext}`
      fetched++
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      failed.push({ url, reason: e.message })
    }
  }
  return { map, fetched, failed, total: urls.length }
}

// ---------------------------------------------------------------- write locally

// Replace the local rows with the downloaded ones in ONE transaction: if
// anything fails (or the laptop dies) the previous data is still there.
export async function applyData(db, plan, mediaMap, eventIds) {
  const local = await tableColumns(db)
  const apply = plan.copy.filter((p) => local.has(p.table))
  const notHere = plan.copy.filter((p) => !local.has(p.table)).map((p) => p.table)
  await db.query('begin')
  try {
    // No triggers and no foreign-key checks while copying, so the order of tables does not matter.
    await db.query('set local session_replication_role = replica')
    if (apply.length) await db.query(`truncate ${apply.map((p) => 'public.' + qi(p.table)).join(', ')} cascade`)
    for (const p of apply) {
      if (!p.n) continue
      const sent = plan.cloudCols?.[p.table] ? new Set(plan.cloudCols[p.table]) : null
      const cols = local.get(p.table).filter((c) => !c.generated && (!sent || sent.has(c.name))).map((c) => qi(c.name)).join(', ')
      await db.query(`insert into public.${qi(p.table)} (${cols}) overriding system value
                      select ${cols} from json_populate_recordset(null::public.${qi(p.table)}, $1::json)`, [p.json])
    }
    // Sequences continue where the cloud's are (setval of a missing one is a no-op).
    for (const s of plan.seqs) {
      if (s.ident_table) {
        await db.query("select setval(pg_get_serial_sequence(format('public.%I', $1::text), $2), $3::bigint)", [s.ident_table, s.ident_col, s.value])
      } else {
        await db.query("select setval(to_regclass(format('public.%I', $1::text)), $2::bigint)", [s.name, s.value])
      }
    }
    // Pictures and videos come from the laptop: /media/<file>.
    if (Object.keys(mediaMap).length) {
      for (const [t, cols] of Object.entries(MEDIA_COLS)) {
        for (const c of cols) {
          if (!local.get(t)?.some((x) => x.name === c)) continue
          await db.query(`update public.${qi(t)} x set ${qi(c)} = m.value from json_each_text($1::json) m where x.${qi(c)} = m.key`, [JSON.stringify(mediaMap)])
        }
      }
    }
    await resetUploadedBaseline(db, eventIds)
    await db.query('commit')
  } catch (e) {
    await db.query('rollback').catch(() => {})
    throw e
  }
  return { notHere }
}

export async function kitchensOf(db, eventIds) {
  if (!(await db.query("select to_regclass('public.kitchens') as r")).rows[0].r) return []
  return (await db.query(`select id::text as id, name, prefix, kot_seq from public.kitchens where ${EV} order by sort_order, name`, [eventIds])).rows
}

// ---------------------------------------------------------------- the app

function newestMtime(p) {
  if (!fs.existsSync(p)) return 0
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  let m = 0
  for (const f of fs.readdirSync(p)) m = Math.max(m, newestMtime(path.join(p, f)))
  return m
}

function runLogged(cmd, logName) {
  fs.mkdirSync(P.logs, { recursive: true })
  const file = path.join(P.logs, logName)
  const fd = fs.openSync(file, 'w')
  const r = spawnSync(cmd, { cwd: REPO, shell: true, stdio: ['ignore', fd, fd], windowsHide: true })
  fs.closeSync(fd)
  return { ok: r.status === 0, tail: fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-12).join('\n') }
}

// Copy the built app (repo/dist) to localmode/app, building it first if the
// sources are newer than the last build.
export function prepareApp() {
  const dist = path.join(REPO, 'dist')
  const idx = path.join(dist, 'index.html')
  const newest = Math.max(...['src', 'public', 'index.html', 'vite.config.js', 'package.json'].map((f) => newestMtime(path.join(REPO, f))))
  let note = ''
  if (!fs.existsSync(idx) || fs.statSync(idx).mtimeMs < newest) {
    if (!fs.existsSync(path.join(REPO, 'node_modules'))) {
      console.log('  Installing the app\'s parts (first time only, a few minutes)...')
      const r = runLogged('npm install --no-audit --no-fund', 'npm-install.log')
      if (!r.ok) throw new UserError(`"npm install" failed in ${REPO}:\n${r.tail}`)
    }
    console.log('  Building the app...')
    const r = runLogged('npm run build', 'build.log')
    if (!r.ok) {
      if (!fs.existsSync(idx)) throw new UserError(`The app could not be built:\n${r.tail}\n(full output: data/logs/build.log)`)
      note = 'the new build failed (data/logs/build.log) - using the previous build'
    }
  }
  fs.rmSync(P.app, { recursive: true, force: true })
  fs.cpSync(dist, P.app, { recursive: true })
  return { builtAt: fs.statSync(idx).mtime.toISOString(), note }
}

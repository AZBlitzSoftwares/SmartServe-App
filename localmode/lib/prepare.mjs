// "prepare": download the event onto the laptop (the day before, with internet).
// "prepare --refresh": same data copy, schema kept - used at the venue to
// switch over while some internet still works.
// "prepare --dev": a TEST database for trying out changes before they go to
// the cloud: the cloud structure (read only) + every ../db/*.sql file applied
// on the laptop only. "--dev --standin": no cloud at all, a bundled stand-in
// structure instead. Nothing is ever written to the cloud in test mode.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import {
  P, UserError, plural, loadConfig, requireCloudApi, requireCloudDb, cloudDbOptions, ensureLocal, readJson, writeJson,
  isPrepared, serverRunning, eventLabel, fmtDateTime, isDevSnapshot,
} from './common.mjs'
import { refuseRoot, pgBins, ensureVcRuntime, ensurePostgrest, initCluster, withPostgres, connectLocal } from './runtime.mjs'
import { readCloudSchema, buildLocalDatabase, tableColumns, schemaDrift, freshDatabase, grantAll, setupStatements } from './schema.mjs'
import { chooseEvents, eventsById, downloadEventData, mediaUrls, downloadMedia, applyData, kitchensOf, prepareApp } from './data.mjs'
import { countPending, uploadAll, describeUpload } from './upload.mjs'
import { applyDbFiles, describeDbFiles, runSqlFile, STANDIN_SQL, DB_DIR } from './devdb.mjs'

const STANDIN_WARNING = [
  '!! STAND-IN STRUCTURE: this test database was NOT copied from the cloud. It is a bundled',
  '!! approximation of the Smart Serve tables (localmode/dev/standin-schema.sql) plus ../db/*.sql.',
  '!! Good for trying things out; before the event, test once more with "prepare --dev"',
  '!! (real cloud structure, needs the database connection string in config.json).',
]

function explainCloudError(e) {
  const code = e.code || ''
  const msg = String(e.message || e)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'The cloud database could not be found. Check the internet connection, and that the connection string\n' +
      'in config.json is the "Session pooler" one from Supabase.'
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) || /timeout/i.test(msg)) {
    return `Could not reach the cloud database (${code || msg}). Is there internet? Some hotel/office networks block it -\ntry a phone hotspot.`
  }
  if (code === '28P01') return 'The cloud database refused the password in the connection string (config.json, "dbUrl").'
  if (/tenant or user not found/i.test(msg)) return 'The user name in the connection string is wrong. Copy the "Session pooler" URI from Supabase again.'
  return `Could not connect to the cloud database: ${msg}`
}

// Never throw away work done on the laptop: before replacing the local data,
// upload what the cloud does not have yet - and stop if that is not possible.
// Test data (an earlier "prepare --dev") is never uploaded: it is simply replaced.
// In test mode nothing is uploaded either: real event orders still on this
// laptop stop the test prepare instead (unless --force).
async function protectLocalChanges(local, cfg, snapBefore, force, dev = false) {
  if (isDevSnapshot(snapBefore)) return
  let db
  try { db = await connectLocal(local) } catch { return } // no local database yet
  try {
    const book = (await db.query("select to_regclass('ss_local.uploaded') as r")).rows[0].r
    if (!book || !snapBefore?.events?.length) return
    const ids = snapBefore.events.map((e) => e.id)
    let p = await countPending(db, ids)
    if (!p.total) return
    if (dev) {
      if (force) { console.log(`  --force: ${p.total} change(s) from a real event on this laptop are discarded (never uploaded).`); return }
      throw new UserError(`Stopped: this laptop holds ${p.total} change(s) from a real event (${snapBefore.events.map((e) => e.name).join(', ')})\n` +
        'that are not in the cloud yet. Test mode never uploads anything. Run "Upload to Cloud" first,\n' +
        'or add --force to throw them away.')
    }
    console.log(`  This laptop has ${p.total} change(s) that are not in the cloud yet - uploading them first...`)
    const r = await uploadAll(db, cfg.cloud, ids)
    console.log(`  Upload: ${describeUpload(r)}`)
    p = await countPending(db, ids)
    if (p.total && !force) {
      throw new UserError(`Stopped, so that nothing is lost: ${p.total} change(s) made on this laptop are not in the cloud yet\n` +
        `(${Object.entries(p.byTable).map(([t, n]) => `${t}: ${n}`).join(', ')}).\n` +
        'Let the Print Hub finish printing, run "Upload to Cloud", then try again.\n' +
        'Or just start the Local Server as it is - its data is complete.')
    }
  } finally {
    await db.end().catch(() => {})
  }
}


function reporter() {
  const lines = []
  return { lines, rep: (s = '') => lines.push(s), write: () => fs.writeFileSync(P.report, lines.join('\n') + '\n') }
}

function stepper(total) {
  let n = 0
  return (s) => console.log(`${++n}/${total} ${s}`)
}

export async function prepareCommand({ refresh = false, force = false, dev = false, standin = false } = {}) {
  refuseRoot()
  if (standin) dev = true
  if (dev && refresh) {
    throw new UserError('--refresh is for event days. For fresh test data run "prepare --dev" again\n' +
      '(or "node ss-local.mjs demo" to reset just the demo events).')
  }
  if (standin) return prepareStandin({ force })
  const cfg = loadConfig()
  if (!dev) requireCloudApi(cfg) // the anon key is only used to upload, which test mode never does
  requireCloudDb(cfg)
  if (await serverRunning(cfg)) {
    throw new UserError('The Local Server is running. Stop it first (press Ctrl+C in its window), then run this again.')
  }
  if (refresh && !isPrepared()) {
    throw new UserError('Nothing has been downloaded to this laptop yet. Run "Prepare Event" first (with internet).')
  }
  const snapBefore = readJson(P.snapshot, null)
  if (refresh && isDevSnapshot(snapBefore)) {
    throw new UserError('This laptop holds a TEST database (prepare --dev), not an event.\n' +
      'Run a full "Prepare Event" (without --dev) to download the real event first.')
  }
  const t0 = Date.now()
  const R = reporter()
  const rep = R.rep
  const step = stepper(dev ? 7 : 6)
  console.log(dev
    ? '\nPREPARE --dev - TEST DATABASE on this laptop\n' +
      '  The cloud database is only READ (read-only connection). Nothing is ever written to the cloud.\n'
    : refresh
      ? '\nREFRESH EVENT DATA - getting the latest orders and settings from the cloud\n'
      : '\nPREPARE EVENT - downloading the event to this laptop\n')

  step('Checking the programs...')
  fs.mkdirSync(P.data, { recursive: true })
  const pgb = await pgBins()
  await ensureVcRuntime()
  await ensurePostgrest(pgb)
  const local = ensureLocal()
  if (await initCluster(pgb, local)) console.log('  Local database created.')

  step(`Connecting to the cloud database${dev ? ' (read only)' : ''}...`)
  const opts = cloudDbOptions(cfg.cloud.dbUrl)
  const cloud = new pg.Client(opts)
  cloud.on('error', () => {})
  try { await cloud.connect() } catch (e) { throw new UserError(explainCloudError(e)) }

  let events, plan, media, appInfo, kitchens, dbRes
  try {
    // This program only ever reads the cloud database. Make the connection
    // itself read-only, so not even a mistake here could change the cloud.
    await cloud.query('set default_transaction_read_only = on')
    events = refresh ? await eventsById(cloud, snapBefore.events.map((e) => e.id)) : await chooseEvents(cloud, cfg, { optional: dev })
    if (!events.length && !dev) throw new UserError('The prepared event no longer exists in the cloud. Run Prepare Event to choose again.')
    const ids = events.map((e) => e.id)
    for (const e of events) console.log(`  Event: ${eventLabel(e)}`)

    rep("JANU'S SMART SERVE - LOCAL SERVER - PREPARE REPORT")
    rep(`Run:       ${dev ? 'TEST DATABASE (prepare --dev) - nothing is written to the cloud' : refresh ? 'refresh (data only)' : 'full prepare'}  ${fmtDateTime(new Date())}`)
    rep(`Cloud:     ${cfg.cloud.url}  (database host ${opts.host || 'from connection string'}${dev ? ', read only' : ''})`)
    for (const e of events) rep(`Event:     ${eventLabel(e)}  id ${e.id}`)
    if (dev && !events.length) rep('Event:     none copied from the cloud (use "node ss-local.mjs demo" for test events)')
    rep()

    await withPostgres(pgb, local, async () => {
      await protectLocalChanges(local, cfg, snapBefore, force, dev)

      let localDbExists = true
      try { const c = await connectLocal(local); await c.end() } catch { localDbExists = false }
      let cloudTables
      rep('DATABASE STRUCTURE')
      if (!refresh || !localDbExists) {
        step('Copying the database structure...')
        const schema = await readCloudSchema(cloud)
        const res = await buildLocalDatabase(local, schema, cfg.cloud.url)
        cloudTables = schema.tables
        const c = res.counts
        const made = `${plural(c.tables, 'table')}, ${plural(c.views, 'view')}, ${plural(c.functions, 'function')}, ${plural(c.triggers, 'trigger')}`
        rep(`  Created: ${made}, ${plural(c.indexes, 'index', 'indexes')}, ${plural(c.types, 'type')}`)
        rep('  Row level security policies are not copied (on the laptop every table is open to the app).')
        if (res.failed.length) {
          rep('  NOT created on the laptop (only a problem if the app uses them):')
          for (const s of res.failed) rep(`    - ${s.name}: ${s.error}`)
        } else rep('  Everything was created.')
        if (res.warnings.length) { rep('  Warnings:'); for (const w of res.warnings) rep(`    - ${w}`) }
        for (const u of schema.unsupported) rep(`  Not supported: ${u}`)
        rep('  Full SQL: data/schema.sql')
        console.log(`  ${made}.`)
        if (res.failed.length) {
          console.log(`  ${res.failed.length} part(s) could not be created on the laptop (details in the report):`)
          for (const s of res.failed.slice(0, 6)) console.log(`    - ${s.name}: ${s.error}`)
        }
        const badTables = res.failed.filter((s) => s.kind === 'table')
        if (badTables.length) {
          R.write()
          throw new UserError(`These tables could not be created on the laptop, so the local server cannot be used:\n` +
            badTables.map((s) => `  - ${s.name}: ${s.error}`).join('\n') + `\nSee ${P.report}`, 1)
        }
        if (dev) {
          rep()
          step(`Applying the database updates in ../db to the LAPTOP database only (never the cloud)...`)
          const db = await connectLocal(local)
          try {
            dbRes = await applyDbFiles(db)
            await grantAll(db)
          } finally {
            await db.end().catch(() => {})
          }
          rep(`DATABASE UPDATES (${DB_DIR}) - applied to the LAPTOP database only, never to the cloud`)
          describeDbFiles(dbRes, rep, (s) => console.log(s))
        }
      } else {
        step('Checking the database structure...')
        cloudTables = await tableColumns(cloud)
        const db = await connectLocal(local)
        const drift = schemaDrift(cloudTables, await tableColumns(db)).filter((d) => !d.includes('no longer exists'))
        await db.end()
        rep('  Kept from the last full prepare (refresh).')
        if (drift.length) {
          rep('  The cloud database changed since then (run a full Prepare Event when there is time):')
          for (const d of drift) rep(`    - ${d}`)
          console.log(`  Note: the cloud database changed since Prepare Event (${drift.length} difference(s), see the report).`)
        }
      }
      rep()

      step(dev ? 'Copying the chosen events and the admin logins (read only)...' : 'Downloading the event data...')
      const downloadedAt = new Date().toISOString()
      plan = await downloadEventData(cloud, ids, cloudTables)
      plan.downloadedAt = downloadedAt

      step('Downloading pictures and videos...')
      media = await downloadMedia(mediaUrls(plan), { budgetMs: refresh ? 90000 : 0 })
      console.log(`  ${media.total - media.failed.length} of ${media.total} on the laptop${media.failed.length ? ` (${media.failed.length} failed - see the report)` : ''}.`)

      const db = await connectLocal(local)
      try {
        const res = await applyData(db, plan, media.map, ids)
        kitchens = await kitchensOf(db, ids)
        rep('DATA (rows copied from the cloud)')
        rep('  ' + plan.copy.map((p) => `${p.table} ${p.n}`).join(', '))
        if (res.notHere.length) rep(`  Not on the laptop (new in the cloud - run a full Prepare Event): ${res.notHere.join(', ')}`)
        rep(`  Public tables NOT copied (not linked to an event): ${plan.notCopied.length ? plan.notCopied.join(', ') : 'none'}`)
        if (kitchens.length) rep('  Kitchens: ' + kitchens.map((k) => `${k.name} (${k.prefix}) last KOT no. ${k.kot_seq}`).join(', '))
        rep()
      } finally {
        await db.end().catch(() => {})
      }
    })
  } finally {
    await cloud.end().catch(() => {})
  }

  rep('PICTURES AND VIDEOS')
  rep(`  ${media.total - media.failed.length} of ${media.total} on the laptop (data/media), ${media.fetched} downloaded now.`)
  for (const f of media.failed) rep(`    - FAILED ${f.url}: ${f.reason}  (the app keeps the internet address for this one)`)
  rep()

  step('Getting the app ready...')
  appInfo = prepareApp()
  rep('APP')
  rep(`  Build from ${fmtDateTime(appInfo.builtAt)} copied to localmode/app${appInfo.note ? ` - NOTE: ${appInfo.note}` : ''}`)
  rep()
  rep(`Finished in ${Math.round((Date.now() - t0) / 1000)} s.`)
  R.write()

  const counts = Object.fromEntries(plan.copy.map((p) => [p.table, p.n]))
  writeJson(P.snapshot, {
    downloadedAt: plan.downloadedAt,
    kind: refresh ? 'refresh' : 'full',
    mode: dev ? 'dev' : 'event',
    cloudUrl: cfg.cloud.url,
    events: events.map((e) => ({ id: e.id, name: e.name, date: e.date, service_mode: e.service_mode, multi_kitchen: e.multi_kitchen, maestro: !!e.maestro })),
    rowCounts: counts,
    kitchens,
    media: { total: media.total, failed: media.failed.length },
    app: appInfo,
    ...(dev ? { dbFiles: dbRes.map((r) => ({ file: r.file, ok: r.ok, failed: r.failed.length, skipped: r.skipped.length })) } : {}),
  })

  const n = (t) => counts[t] ?? 0
  if (dev) {
    const bad = dbRes.filter((r) => !r.ok)
    console.log(`\nDONE - TEST DATABASE ready on this laptop. Nothing was written to the cloud.`)
    if (events.length) console.log(`  Real events copied: ${events.map((e) => e.name).join(', ')} (${plural(n('menu_items'), 'dish', 'dishes')}, ${plural(n('orders'), 'order')}).`)
    console.log(`  Database updates applied here: ${dbRes.length ? dbRes.map((r) => `${r.file} ${r.ok ? 'OK' : 'WITH ERRORS'}`).join(', ') : 'none found in ../db'}`)
    if (bad.length) console.log(`  !! Some statements failed - see ${P.report}`)
    console.log(`  Report: ${P.report}`)
    console.log('\nNext:  node ss-local.mjs demo     (three demo events dated today)\n       node ss-local.mjs start')
    return
  }
  console.log(`\nDONE${refresh ? ' - data refreshed' : ''}: ${events.map((e) => e.name).join(' and ')} ${events.length > 1 ? 'are' : 'is'} on this laptop.`)
  console.log(`  ${n('menu_items')} dishes, ${n('kitchens')} kitchens, ${n('captains')} captains, ${n('waiters')} waiters, ${n('orders')} orders so far.`)
  console.log(`  Report: ${P.report}`)
  if (isDevSnapshot(snapBefore)) console.log('  (The test database that was on this laptop has been replaced by the event.)')
  console.log(refresh
    ? '\nNext: double-click "Start Local Server".'
    : '\nAt the venue, if the internet is bad: double-click "Refresh Event Data" (if there is any internet),\nthen "Start Local Server". See README.md, "Plan B".')
}

// "prepare --dev --standin": a test database without any cloud connection,
// from the bundled stand-in structure + ../db/*.sql.
async function prepareStandin({ force }) {
  const cfg = loadConfig({ quiet: true })
  if (await serverRunning(cfg)) {
    throw new UserError('The Local Server is running. Stop it first (press Ctrl+C in its window), then run this again.')
  }
  if (!fs.existsSync(STANDIN_SQL)) throw new UserError(`The stand-in structure is missing: ${STANDIN_SQL}`)
  const t0 = Date.now()
  const R = reporter()
  const rep = R.rep
  const step = stepper(4)
  console.log('\nPREPARE --dev --standin - TEST DATABASE without any cloud connection\n')
  for (const l of STANDIN_WARNING) console.log(l)
  console.log('')

  step('Checking the programs...')
  fs.mkdirSync(P.data, { recursive: true })
  const pgb = await pgBins()
  await ensureVcRuntime()
  await ensurePostgrest(pgb)
  const local = ensureLocal()
  if (await initCluster(pgb, local)) console.log('  Local database created.')

  const snapBefore = readJson(P.snapshot, null)
  rep("JANU'S SMART SERVE - LOCAL SERVER - PREPARE REPORT")
  rep(`Run:       TEST DATABASE from the STAND-IN structure (prepare --dev --standin)  ${fmtDateTime(new Date())}`)
  rep('Cloud:     not used at all')
  rep()
  for (const l of STANDIN_WARNING) rep(l)
  rep()

  let standinRes, dbRes
  await withPostgres(pgb, local, async () => {
    await protectLocalChanges(local, cfg, snapBefore, force, true)
    step('Building the database from the stand-in structure...')
    await freshDatabase(local)
    const db = await connectLocal(local)
    try {
      for (const s of setupStatements()) await db.query(s.sql)
      standinRes = await runSqlFile(db, STANDIN_SQL)
      rep('DATABASE STRUCTURE')
      describeDbFiles([standinRes], rep, (s) => console.log(s))
      if (!standinRes.ok) {
        R.write()
        throw new UserError(`The stand-in structure could not be created (see ${P.report}).`, 1)
      }
      rep()
      step('Applying the database updates in ../db to the LAPTOP database...')
      dbRes = await applyDbFiles(db)
      await grantAll(db)
      rep(`DATABASE UPDATES (${DB_DIR}) - applied to the LAPTOP database only`)
      describeDbFiles(dbRes, rep, (s) => console.log(s))
      rep()
    } finally {
      await db.end().catch(() => {})
    }
  })

  step('Getting the app ready...')
  const appInfo = prepareApp()
  rep('APP')
  rep(`  Build from ${fmtDateTime(appInfo.builtAt)} copied to localmode/app${appInfo.note ? ` - NOTE: ${appInfo.note}` : ''}`)
  rep()
  rep(`Finished in ${Math.round((Date.now() - t0) / 1000)} s.`)
  R.write()

  writeJson(P.snapshot, {
    downloadedAt: new Date().toISOString(),
    kind: 'full',
    mode: 'dev',
    standin: true,
    cloudUrl: null,
    events: [],
    rowCounts: {},
    kitchens: [],
    media: { total: 0, failed: 0 },
    app: appInfo,
    dbFiles: dbRes.map((r) => ({ file: r.file, ok: r.ok, failed: r.failed.length, skipped: r.skipped.length })),
  })

  const bad = dbRes.filter((r) => !r.ok)
  console.log('\nDONE - TEST DATABASE (stand-in structure) ready on this laptop. The cloud was not contacted.')
  console.log(`  Database updates applied: ${dbRes.length ? dbRes.map((r) => `${r.file} ${r.ok ? 'OK' : 'WITH ERRORS'}`).join(', ') : `none found in ${path.relative(process.cwd(), DB_DIR) || DB_DIR}`}`)
  if (bad.length) console.log(`  !! Some statements failed - see ${P.report}`)
  console.log(`  Report: ${P.report}\n`)
  for (const l of STANDIN_WARNING) console.log(l)
  console.log('\nNext:  node ss-local.mjs demo     (three demo events dated today)\n       node ss-local.mjs start')
}


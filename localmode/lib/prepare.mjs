// "prepare": download the event onto the laptop (the day before, with internet).
// "prepare --refresh": same data copy, schema kept - used at the venue to
// switch over while some internet still works.
import fs from 'node:fs'
import pg from 'pg'
import {
  P, UserError, plural, loadConfig, requireCloudApi, requireCloudDb, cloudDbOptions, ensureLocal, readJson, writeJson,
  isPrepared, serverRunning, eventLabel, fmtDateTime,
} from './common.mjs'
import { refuseRoot, pgBins, ensureVcRuntime, ensurePostgrest, initCluster, withPostgres, connectLocal } from './runtime.mjs'
import { readCloudSchema, buildLocalDatabase, tableColumns, schemaDrift } from './schema.mjs'
import { chooseEvents, eventsById, downloadEventData, mediaUrls, downloadMedia, applyData, kitchensOf, prepareApp } from './data.mjs'
import { countPending, uploadAll, describeUpload } from './upload.mjs'

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
async function protectLocalChanges(local, cfg, snapBefore, force) {
  let db
  try { db = await connectLocal(local) } catch { return } // no local database yet
  try {
    const book = (await db.query("select to_regclass('ss_local.uploaded') as r")).rows[0].r
    if (!book || !snapBefore?.events?.length) return
    const ids = snapBefore.events.map((e) => e.id)
    let p = await countPending(db, ids)
    if (!p.total) return
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

export async function prepareCommand({ refresh = false, force = false } = {}) {
  refuseRoot()
  const cfg = loadConfig()
  requireCloudApi(cfg)
  requireCloudDb(cfg)
  if (await serverRunning(cfg)) {
    throw new UserError('The Local Server is running. Stop it first (press Ctrl+C in its window), then run this again.')
  }
  if (refresh && !isPrepared()) {
    throw new UserError('Nothing has been downloaded to this laptop yet. Run "Prepare Event" first (with internet).')
  }
  const t0 = Date.now()
  const R = { lines: [] }
  const rep = (s = '') => R.lines.push(s)
  const writeReport = () => fs.writeFileSync(P.report, R.lines.join('\n') + '\n')
  console.log(refresh
    ? '\nREFRESH EVENT DATA - getting the latest orders and settings from the cloud\n'
    : '\nPREPARE EVENT - downloading the event to this laptop\n')

  console.log('1/6 Checking the programs...')
  fs.mkdirSync(P.data, { recursive: true })
  const pgb = await pgBins()
  await ensureVcRuntime()
  await ensurePostgrest(pgb)
  const local = ensureLocal()
  if (await initCluster(pgb, local)) console.log('  Local database created.')

  console.log('2/6 Connecting to the cloud database...')
  const opts = cloudDbOptions(cfg.cloud.dbUrl)
  const cloud = new pg.Client(opts)
  cloud.on('error', () => {})
  try { await cloud.connect() } catch (e) { throw new UserError(explainCloudError(e)) }

  const snapBefore = readJson(P.snapshot, null)
  let events, plan, media, appInfo, kitchens
  try {
    events = refresh ? await eventsById(cloud, snapBefore.events.map((e) => e.id)) : await chooseEvents(cloud, cfg)
    if (!events.length) throw new UserError('The prepared event no longer exists in the cloud. Run Prepare Event to choose again.')
    const ids = events.map((e) => e.id)
    for (const e of events) console.log(`  Event: ${eventLabel(e)}`)

    rep("JANU'S SMART SERVE - LOCAL SERVER - PREPARE REPORT")
    rep(`Run:       ${refresh ? 'refresh (data only)' : 'full prepare'}  ${fmtDateTime(new Date())}`)
    rep(`Cloud:     ${cfg.cloud.url}  (database host ${opts.host || 'from connection string'})`)
    for (const e of events) rep(`Event:     ${eventLabel(e)}  id ${e.id}`)
    rep()

    await withPostgres(pgb, local, async () => {
      await protectLocalChanges(local, cfg, snapBefore, force)

      let localDbExists = true
      try { const c = await connectLocal(local); await c.end() } catch { localDbExists = false }
      let cloudTables
      rep('DATABASE STRUCTURE')
      if (!refresh || !localDbExists) {
        console.log('3/6 Copying the database structure...')
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
          writeReport()
          throw new UserError(`These tables could not be created on the laptop, so the local server cannot be used:\n` +
            badTables.map((s) => `  - ${s.name}: ${s.error}`).join('\n') + `\nSee ${P.report}`, 1)
        }
      } else {
        console.log('3/6 Checking the database structure...')
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

      console.log('4/6 Downloading the event data...')
      const downloadedAt = new Date().toISOString()
      plan = await downloadEventData(cloud, ids, cloudTables)
      plan.downloadedAt = downloadedAt

      console.log('5/6 Downloading pictures and videos...')
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

  console.log('6/6 Getting the app ready...')
  appInfo = prepareApp()
  rep('APP')
  rep(`  Build from ${fmtDateTime(appInfo.builtAt)} copied to localmode/app${appInfo.note ? ` - NOTE: ${appInfo.note}` : ''}`)
  rep()
  rep(`Finished in ${Math.round((Date.now() - t0) / 1000)} s.`)
  writeReport()

  const counts = Object.fromEntries(plan.copy.map((p) => [p.table, p.n]))
  writeJson(P.snapshot, {
    downloadedAt: plan.downloadedAt,
    kind: refresh ? 'refresh' : 'full',
    cloudUrl: cfg.cloud.url,
    events: events.map((e) => ({ id: e.id, name: e.name, date: e.date, service_mode: e.service_mode, multi_kitchen: e.multi_kitchen })),
    rowCounts: counts,
    kitchens,
    media: { total: media.total, failed: media.failed.length },
    app: appInfo,
  })

  const n = (t) => counts[t] ?? 0
  console.log(`\nDONE${refresh ? ' - data refreshed' : ''}: ${events.map((e) => e.name).join(' and ')} ${events.length > 1 ? 'are' : 'is'} on this laptop.`)
  console.log(`  ${n('menu_items')} dishes, ${n('kitchens')} kitchens, ${n('captains')} captains, ${n('waiters')} waiters, ${n('orders')} orders so far.`)
  console.log(`  Report: ${P.report}`)
  console.log(refresh
    ? '\nNext: double-click "Start Local Server".'
    : '\nAt the venue, if the internet is bad: double-click "Refresh Event Data" (if there is any internet),\nthen "Start Local Server". See README.md, "Plan B".')
}

// "status" and "upload" as seen by the operator.
import fs from 'node:fs'
import path from 'node:path'
import {
  P, UserError, loadConfig, loadLocal, readJson, writeJson, isPrepared, serverRunning, requireCloudApi,
  eventLabel, fmtDateTime, fmtAgo,
} from './common.mjs'
import { refuseRoot, pgBins, withPostgres, pgAnswers, connectLocal, postgrestPath, PGRST_VERSION } from './runtime.mjs'
import { uploadAll, cloudAnswers, describeUpload, lastUpload } from './upload.mjs'

export async function statusCommand() {
  let cfg = null
  try { cfg = loadConfig({ create: false }) } catch { /* unreadable: use defaults */ }
  const snap = readJson(P.snapshot, null)
  console.log("\nJANU'S SMART SERVE - LOCAL SERVER STATUS\n")
  if (!snap || !isPrepared()) {
    console.log('Nothing has been prepared on this laptop yet (run "Prepare Event").')
  } else {
    for (const e of snap.events) console.log(`Event:       ${eventLabel(e)}`)
    console.log(`Downloaded:  ${fmtDateTime(snap.downloadedAt)} (${fmtAgo(Date.now() - Date.parse(snap.downloadedAt))}, ${snap.kind === 'refresh' ? 'refresh' : 'full prepare'})`)
    const c = snap.rowCounts || {}
    console.log(`Downloaded rows: ${Object.entries(c).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ')}`)
    if (snap.kitchens?.length) console.log(`Kitchens:    ${snap.kitchens.map((k) => `${k.name} ${k.prefix}-${String(k.kot_seq).padStart(3, '0')}`).join(', ')} (last KOT at download)`)
    if (snap.media) console.log(`Media:       ${snap.media.total - snap.media.failed} of ${snap.media.total} pictures/videos on the laptop`)
    if (snap.app) console.log(`App build:   ${fmtDateTime(snap.app.builtAt)}`)
    const local = loadLocal()
    if (local?.kotJump?.snapshotAt === snap.downloadedAt) console.log(`KOT jump:    ${local.kotJump.amount ? `+${local.kotJump.amount} applied ${fmtDateTime(local.kotJump.at)}` : 'not needed (data was fresh)'}`)
    console.log(`API program: ${fs.existsSync(postgrestPath()) ? `PostgREST ${PGRST_VERSION}` : 'missing (run Prepare Event)'}`)
  }
  const h = await serverRunning(cfg)
  console.log('')
  if (h) {
    const s = h.status || {}
    const port = h.port === 80 ? '' : `:${h.port}`
    console.log(`Local server: RUNNING since ${fmtDateTime(h.startedAt)}`)
    for (const ip of h.addresses) console.log(`              http://${ip}${port}/   /waiter   /supervisor`)
    console.log(`              database ${s.pg ? 'OK' : 'DOWN'}, API ${s.api ? 'OK' : 'DOWN'}, orders ${s.orders ?? '-'}, KOTs ${s.kots ?? '-'}, waiting to print ${s.to_print ?? '-'}, print failed ${s.print_failed ?? '-'}`)
    console.log(`              not yet in the cloud: ${s.pending ?? '?'} change(s)`)
  } else {
    console.log('Local server: not running')
  }
  const u = lastUpload()
  console.log(`Last upload:  ${u ? `${fmtDateTime(u.at)} - ${describeUpload(u)}` : 'never'}`)
  console.log('')
}

export async function uploadCommand({ background = false, all = false } = {}) {
  refuseRoot()
  const cfg = loadConfig()
  requireCloudApi(cfg)
  const local = loadLocal()
  const snap = readJson(P.snapshot, null)
  if (!isPrepared() || !snap) throw new UserError('Nothing has been prepared on this laptop, so there is nothing to upload.')
  const events = snap.events.map((e) => e.id)
  const result = (r) => { if (background) console.log('@@RESULT ' + JSON.stringify(r)); return r }

  if (background && !(await pgAnswers(local))) {
    // Started by the server: never start or stop the database from here.
    result({ at: new Date().toISOString(), ok: false, error: 'local database not running', offline: false })
    return 0
  }
  if (!background) console.log('\nUPLOAD TO CLOUD - sending what this laptop recorded to the cloud\n')
  if (!(await cloudAnswers(cfg.cloud, background ? 5000 : 15000))) {
    const r = { at: new Date().toISOString(), ok: false, offline: true, error: 'cloud not reachable', sent: {}, total: 0, failedCount: 0 }
    writeJson(P.lastUpload, { ...lastUpload(), ...r })
    result(r)
    if (background) return 0
    throw new UserError('The cloud cannot be reached (no internet?). Nothing was changed.\n' +
      'Everything stays saved on this laptop - try again when there is internet.', 1)
  }
  const pgb = await pgBins()
  const r = await withPostgres(pgb, local, async () => {
    const db = await connectLocal(local)
    try { return await uploadAll(db, cfg.cloud, events, { all }) } finally { await db.end().catch(() => {}) }
  })
  result(r)
  if (background) return 0

  for (const e of snap.events) console.log(`Event: ${eventLabel(e)}`)
  if (r.error) {
    console.log(`\nStopped: ${r.error}`)
    if (r.total) console.log(`(${r.total} rows were sent before that; running Upload again continues from there)`)
    return 1
  }
  const sent = Object.entries(r.sent)
  if (sent.length) console.log(`\nSent: ${sent.map(([t, n]) => `${t} ${n}`).join(', ')}`)
  else if (!r.cleared && !r.kotSeqRaised) console.log('\nNothing new to send - the cloud already has everything from this laptop.')
  if (r.cleared) console.log(`Cleared carts removed from the cloud: ${r.cleared}`)
  if (r.kotSeqRaised) console.log(`KOT numbering raised in the cloud for ${r.kotSeqRaised} kitchen(s), so new cloud KOTs continue after the local ones.`)
  if (r.failedCount) {
    console.log(`\n${r.failedCount} row(s) could not be uploaded:`)
    for (const f of r.failed) console.log(`  - ${f.table} ${f.id}: ${f.error}`)
    console.log(`(details: ${path.join('data', 'logs')})`)
  }
  if (r.waitingToPrint) console.log(`\n${r.waitingToPrint} KOT(s) are still waiting for the printer here; they are sent once printed (or failed).`)
  console.log(r.pending ? `\nStill to send: ${r.pending} change(s).` : '\nEverything on this laptop is now in the cloud.')
  return r.failedCount ? 1 : 0
}

// "start": run the event from this laptop. One web address serves everything:
//   /             the app (captain/guest tablets), /waiter, /supervisor
//   /rest/v1/...  the database API (PostgREST) on the same paths as Supabase
//   /media/...    pictures and videos downloaded by prepare
// Realtime is not offered (404): every screen of the app also polls every few
// seconds, so it works without it.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import pg from 'pg'
import {
  P, HERE, IS_MAC, IS_WIN, IS_KIT, LAUNCHER, UserError, loadConfig, loadLocal, saveLocal, readJson, writeJson, isPrepared, serverRunning,
  portFree, freePort, lanAddresses, localDbOptions, eventLabel, fmtTime, fmtDateTime, fmtAgo, hasCloudApi, logLine,
  isDevSnapshot, DEV_BANNER,
} from './common.mjs'
import { refuseRoot, pgBins, startPostgres, stopPostgres, pgAnswers, startPostgrest, stopChild, postgrestPath, killStalePostgrest } from './runtime.mjs'
import { countPending, describeUpload, lastUpload } from './upload.mjs'
import { updatePrinthubConfig } from './printhub.mjs'
import { prepareApp } from './data.mjs'

// QR codes (npm package "qrcode"). Optional: without it the server works the
// same, the panel and /qr just show the links as text.
let QR = null
try { QR = (await import('qrcode')).default } catch { /* not installed */ }

// Width on screen of a terminal QR line: its colour codes (ESC [ ... m) take no space.
const ESC = String.fromCharCode(27)
function visible(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ESC) { while (i < s.length && s[i] !== 'm') i++; continue }
    n++
  }
  return n
}

// Small terminal QR codes, next to each other, with a label above each.
async function terminalQrs(items) {
  if (!QR) return null
  const blocks = []
  for (const it of items) {
    const text = await QR.toString(it.url, { type: 'terminal', small: true })
    const lines = text.replace(/\n+$/, '').split('\n').filter((l) => visible(l) > 0)
    blocks.push({ label: it.label, lines, width: Math.max(it.label.length, ...lines.map(visible)) })
  }
  const gap = '    '
  const out = ['   ' + blocks.map((b) => b.label.padEnd(b.width)).join(gap)]
  const h = Math.max(...blocks.map((b) => b.lines.length))
  for (let r = 0; r < h; r++) {
    out.push('   ' + blocks.map((b) => { const l = b.lines[r] ?? ''; return l + ' '.repeat(Math.max(0, b.width - visible(l))) }).join(gap))
  }
  return out
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// GET /qr: big QR codes for the desk screen, so staff can scan the links.
async function qrPage(base, others, note) {
  const links = [
    ['Captain & guest tablets', base + '/'],
    ['Waiter phones', base + '/waiter'],
    ['Desk (supervisor)', base + '/supervisor'],
  ]
  const cards = []
  for (const [label, url] of links) {
    const svg = QR ? await QR.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }) : ''
    cards.push(`<section><h2>${esc(label)}</h2>${svg ? `<div class="qr">${svg}</div>` : ''}<p class="url">${esc(url)}</p></section>`)
  }
  const alt = others.length ? `<p class="note">This laptop also has ${others.map((ip) => `<a href="/qr?host=${encodeURIComponent(ip)}">${esc(ip)}</a>`).join(', ')} - use the address of the event Wi-Fi.</p>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Serve - scan to open</title><style>
:root{color-scheme:light}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1d1d1f}
header{padding:20px 24px 4px;text-align:center}h1{margin:0;font-size:26px}header p{margin:6px 0 0;color:#555}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;padding:24px;max-width:1200px;margin:0 auto}
section{border:2px solid #e5e5e5;border-radius:16px;padding:16px;text-align:center}
h2{margin:0 0 8px;font-size:22px}.qr svg{width:100%;max-width:340px;height:auto}
.url{font:600 18px ui-monospace,Menlo,Consolas,monospace;word-break:break-all;margin:8px 0 0}
.note{text-align:center;color:#a33;margin:0 24px 16px}a{color:#0a58ca}
@media print{.note{display:none}section{break-inside:avoid}}
</style></head><body><header><h1>Janu's Smart Serve - scan to open</h1><p>Phones and tablets must be on the same Wi-Fi as this laptop.</p></header>
${note ? `<p class="note">${esc(note)}</p>` : ''}${alt}<main>${cards.join('')}</main></body></html>`
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, content-location, location, preference-applied, range-unit',
  'access-control-max-age': '600',
}
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'upgrade', 'te', 'trailer'])

// The app finds the laptop's API through this line (see src/lib/supabase.js).
function injectLocal(html, anonKey) {
  const tag = `<script>window.__SS_LOCAL__={url:location.origin,key:${JSON.stringify(anonKey)}}</script>`
  const i = html.indexOf('<script')
  return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html.replace('</head>', tag + '</head>')
}

function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...CORS, ...extra })
  res.end(body)
}

// Static file with byte ranges (iPad Safari will not play a video without them).
function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { message: 'not found' })
    const headers = {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'accept-ranges': 'bytes', 'cache-control': cache, 'last-modified': st.mtime.toUTCString(),
    }
    let start = 0
    let end = st.size - 1
    let status = 200
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (m && st.size > 0 && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') start = Math.max(0, st.size - Number(m[2]))
      else { start = Number(m[1]); if (m[2] !== '') end = Math.min(end, Number(m[2])) }
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end() }
      status = 206
      headers['content-range'] = `bytes ${start}-${end}/${st.size}`
    }
    headers['content-length'] = st.size === 0 ? 0 : end - start + 1
    res.writeHead(status, headers)
    if (req.method === 'HEAD' || st.size === 0) return res.end()
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
  })
}

function insideDir(root, urlPath) {
  const f = path.resolve(root, '.' + urlPath)
  return f === root || f.startsWith(root + path.sep) ? f : null
}

export async function startCommand({ kotJump = null } = {}) {
  refuseRoot()
  const cfg = loadConfig({ quiet: true })
  const local = loadLocal()
  const snap = readJson(P.snapshot, null)
  if (!isPrepared() || !snap || !fs.existsSync(path.join(P.app, 'index.html')) || !fs.existsSync(postgrestPath())) {
    throw new UserError('This laptop has not been prepared yet. Run "Prepare Event" first (with internet).')
  }
  if (await serverRunning(cfg)) throw new UserError('The Local Server is already running in another window. Use that window.')
  if (!(await portFree(cfg.port))) {
    throw new UserError(`Port ${cfg.port} is already used by another program on this laptop.\n` +
      'Close that program, or put another number in "port" in config.json (for example 8081).')
  }
  if (killStalePostgrest(readJson(P.run, {})?.apiPid)) console.log('  Stopped an API program left over from an earlier run.')

  // Test database (prepare --dev): never uploads, no KOT number jump (there
  // is no cloud numbering to stay clear of), and the newest app build is used.
  const dev = isDevSnapshot(snap)
  const jumpAsked = kotJump !== null
  if (kotJump === null) kotJump = dev ? 0 : 100
  if (dev) {
    console.log(DEV_BANNER)
    console.log('Using the newest app build (../dist; rebuilt first if the code changed)...')
    try {
      snap.app = prepareApp()
      writeJson(P.snapshot, { ...readJson(P.snapshot, snap), app: snap.app })
      if (snap.app.note) console.log(`  NOTE: ${snap.app.note}`)
    } catch (e) {
      console.log(`  Could not refresh the app (${e.message.split('\n')[0]}) - using the copy from prepare.`)
    }
  }

  let events = snap.events.map((e) => e.id)
  const pgb = await pgBins()
  const state = { stopping: false, startedAt: new Date().toISOString(), api: null, apiPort: 0, upload: lastUpload(), uploading: false, devices: new Map(), status: {} }

  // If starting fails half-way, stop what did start, so the launcher's retry begins clean.
  let pool = null
  const failStart = async (e) => {
    await stopChild(state.api).catch(() => {})
    await pool?.end().catch(() => {})
    await stopPostgres(pgb).catch(() => {})
    throw e
  }

  console.log('Starting the local database...')
  await startPostgres(pgb, local).catch(failStart)
  pool = new pg.Pool({ ...localDbOptions(local), max: 4, idleTimeoutMillis: 30000 })
  pool.on('error', () => {}) // the database restarting must not crash the server

  const jumpNote = dev && !jumpAsked ? '' : await applyKotJump(pool, local, snap, kotJump, events).catch(failStart)

  // ---------------------------------------------------------- API (PostgREST)
  console.log('Starting the API...')
  const writeRun = () => writeJson(P.run, { pid: process.pid, port: cfg.port, apiPid: state.api?.pid, apiPort: state.apiPort, pgPort: local.pgPort, startedAt: state.startedAt })
  const onApiExit = () => { if (!state.stopping) setTimeout(restartApi, 2000) }
  async function launchApi() {
    state.apiPort = await freePort()
    state.api = await startPostgrest(pgb, local, state.apiPort, onApiExit)
  }
  async function restartApi() {
    if (state.stopping || state.apiRestarting) return
    state.apiRestarting = true
    try {
      await launchApi()
      writeRun()
      logLine('server', 'API restarted')
    } catch (e) {
      logLine('server', `API restart failed: ${e.message}`)
      setTimeout(restartApi, 5000)
    } finally {
      state.apiRestarting = false
    }
  }
  await launchApi().catch(failStart)

  // ---------------------------------------------------------- web server
  const indexHtml = injectLocal(fs.readFileSync(path.join(P.app, 'index.html'), 'utf8'), local.anonKey)
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 })

  function proxy(req, res, upstreamPath) {
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v
    headers.host = `127.0.0.1:${state.apiPort}`
    const up = http.request({ host: '127.0.0.1', port: state.apiPort, method: req.method, path: upstreamPath, headers, agent }, (ur) => {
      const h = {}
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k) && !k.startsWith('access-control-')) h[k] = v
      res.writeHead(ur.statusCode, { ...h, ...CORS })
      ur.pipe(res)
    })
    up.on('error', () => {
      if (!res.headersSent) sendJson(res, 503, { message: 'The local server is starting up - try again in a few seconds.', code: 'SS503' })
      else res.destroy()
    })
    res.on('close', () => { if (!res.writableFinished) up.destroy() })
    req.pipe(up)
  }

  const server = http.createServer((req, res) => {
    try {
      // Tablets and phones only: the laptop itself (Print Hub, status checks) is not counted.
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
      if (ip !== '127.0.0.1' && ip !== '::1') state.devices.set(ip, Date.now())
      let p
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { return sendJson(res, 400, { message: 'bad address' }) }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*' })
        return res.end()
      }
      if (p === '/rest/v1' || p.startsWith('/rest/v1/')) {
        const rest = req.url.slice('/rest/v1'.length)
        return proxy(req, res, rest.startsWith('/') ? rest : '/' + rest)
      }
      if (/^\/(realtime|auth|storage|functions|graphql)(\/|$)/.test(p)) return sendJson(res, 404, { message: 'Not available on the local server.' })
      if (p === '/__ss/health') return sendJson(res, 200, health())
      // For the app's "use the laptop server" check: is this a Smart Serve local server, and with which events?
      if (p === '/ss-local.json') {
        return sendJson(res, 200, { local: true, app: 'smartserve-local', mode: dev ? 'dev' : 'event', startedAt: state.startedAt, port: cfg.port, events: snap.events })
      }
      if (p === '/qr' || p === '/qr/') return sendQrPage(req, res)
      if (p.startsWith('/media/')) {
        const f = insideDir(P.media, p.slice('/media'.length))
        return f ? serveFile(req, res, f, 'public, max-age=86400') : sendJson(res, 404, { message: 'not found' })
      }
      if (p === '/' || p === '/index.html') return sendIndex(res)
      const f = insideDir(P.app, p)
      if (f && fs.existsSync(f) && fs.statSync(f).isFile()) {
        return serveFile(req, res, f, p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      }
      if (path.extname(p)) return sendJson(res, 404, { message: 'not found' })
      return sendIndex(res) // the app's own pages: /waiter, /supervisor ...
    } catch (e) {
      logLine('server', `request error ${req.url}: ${e.stack || e}`)
      if (!res.headersSent) sendJson(res, 500, { message: 'local server error' })
    }
  })
  function sendIndex(res) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(indexHtml) })
    res.end(indexHtml)
  }
  // The QR codes always carry the laptop's network address (a phone cannot
  // use "localhost"). ?host= picks another of this laptop's own addresses.
  function sendQrPage(req, res) {
    const ips = lanAddresses().map((a) => a.ip)
    const want = new URL(req.url, 'http://x').searchParams.get('host')
    const ip = ips.includes(want) ? want : ips[0]
    const port = cfg.port === 80 ? '' : `:${cfg.port}`
    const host = ip || String(req.headers.host || '').replace(/:\d+$/, '') || 'localhost'
    const note = ip ? '' : 'This laptop is not connected to any network - connect it to the event Wi-Fi, then reload this page.'
    qrPage(`http://${host}${port}`, ips.filter((x) => x !== ip), note).then((html) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(html) })
      res.end(html)
    }, (e) => sendJson(res, 500, { message: `QR page: ${e.message}` }))
  }
  // Realtime websockets: refused, the app falls back to polling.
  server.on('upgrade', (req, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'))
  server.on('clientError', (err, socket) => { try { socket.destroy() } catch { /* gone */ } })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, '0.0.0.0', resolve) }).catch(failStart)
  writeRun()

  const ph = updatePrinthubConfig(local, cfg.port)
  const phNote = ph.status === 'missing'
    ? `Print Hub settings not found next to this folder: "${LAUNCHER.printhub}" creates them.`
    : ph.status === 'unreadable' ? `printhub/config.json could not be read (${ph.error}) - not changed.` : ''

  // Keep a Mac awake while the server runs (closing the lid still sleeps it).
  if (IS_MAC) { try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {}) } catch { /* optional */ } }

  // ---------------------------------------------------------- status
  const hasKots = !!(await pool.query("select to_regclass('public.kots') as r")).rows[0].r
  const STATUS_SQL = `select (select count(*)::int from public.orders where event_id::text = any($1::text[])) as orders` +
    (hasKots ? `,
      (select count(*)::int from public.kots where event_id::text = any($1::text[]) and kind = 'order') as kots,
      (select count(*)::int from public.kots where event_id::text = any($1::text[]) and print_status in ('queued', 'printing')) as to_print,
      (select count(*)::int from public.kots where event_id::text = any($1::text[]) and print_status = 'failed') as print_failed` : '')
  let pgMisses = 0

  async function gather() {
    const s = {}
    if (dev) {
      // "demo" adds or removes test events while the server runs.
      const fresh = readJson(P.snapshot, null)
      if (Array.isArray(fresh?.events)) { snap.events = fresh.events; events = fresh.events.map((e) => e.id) }
    }
    try {
      Object.assign(s, (await pool.query(STATUS_SQL, [events])).rows[0])
      s.pg = true
      pgMisses = 0
    } catch {
      s.pg = false
      // The database stopped by itself (should not happen): start it again.
      if (++pgMisses >= 2 && !state.pgRestarting && !(await pgAnswers(local))) {
        state.pgRestarting = true
        logLine('server', 'database not answering - restarting it')
        startPostgres(pgb, local).then(() => logLine('server', 'database restarted'), (e) => logLine('server', `database restart failed: ${e.message}`))
          .finally(() => { state.pgRestarting = false; pgMisses = 0 })
      }
    }
    try {
      const r = await fetch(`http://127.0.0.1:${state.apiPort}/events?select=id&limit=1`, { headers: { apikey: local.anonKey, Authorization: `Bearer ${local.anonKey}` }, signal: AbortSignal.timeout(3000) })
      s.api = r.ok
    } catch { s.api = false }
    if (s.pg && !dev) { try { s.pending = (await countPending(pool, events)).total } catch { /* keep last */ } }
    const since = Date.now() - 2 * 60000
    s.devices = [...state.devices.values()].filter((t) => t > since).length
    state.status = s
    return s
  }

  function health() {
    return {
      app: 'smartserve-local', ok: !!(state.status.pg && state.status.api), startedAt: state.startedAt, port: cfg.port, dev,
      addresses: lanAddresses().map((a) => a.ip), events: snap.events, downloadedAt: snap.downloadedAt,
      status: state.status, upload: state.upload, uploading: state.uploading,
    }
  }

  const uploadLine = () => {
    if (dev) return 'TEST MODE - upload is off, nothing is ever sent to the cloud'
    if (!hasCloudApi(cfg)) return 'upload to the cloud is off (no anon key in config.json)'
    const pend = state.status.pending
    const head = pend === undefined ? '' : pend ? `${pend} change(s) not in the cloud yet. ` : 'cloud has everything. '
    if (state.uploading) return head + 'Uploading now...'
    const u = state.upload
    return head + (u ? `Last try ${fmtTime(u.at)}: ${describeUpload(u)}` : 'First upload try in a minute.')
  }

  let lastPrinted = ''
  let lastPrintedAt = 0
  const qrCache = { key: '', lines: null }
  async function qrLines(base) {
    if (qrCache.key !== base) {
      qrCache.key = base
      qrCache.lines = await terminalQrs([{ label: 'Captain / guest tablets', url: `${base}/` }, { label: 'Waiter phones', url: `${base}/waiter` }]).catch(() => null)
    }
    return qrCache.lines
  }

  async function render() {
    const s = state.status
    const ips = lanAddresses()
    const port = cfg.port === 80 ? '' : `:${cfg.port}`
    const L = []
    const bar = '='.repeat(74)
    L.push(bar, ` JANU'S SMART SERVE - LOCAL SERVER (${dev ? 'TEST MODE' : 'offline standby'})${' '.repeat(dev ? 18 : 12)}${fmtTime(new Date())}`, bar)
    if (dev) L.push(` ${DEV_BANNER}`)
    for (const e of snap.events) L.push(` Event: ${eventLabel(e)}`)
    if (!snap.events.length) L.push(dev ? ' No events yet - run "node ss-local.mjs demo" in another window.' : ' No events.')
    if (!dev) L.push(` Data from the cloud: ${fmtDateTime(snap.downloadedAt)}`)
    else if (snap.standin) L.push(' Database: STAND-IN structure (not copied from the cloud) + ../db/*.sql')
    if (jumpNote) L.push(` ${jumpNote}`)
    L.push('')
    let qr = null
    if (ips.length) {
      const base = `http://${ips[0].ip}${port}`
      L.push(` OPEN THESE LINKS ON THE DEVICES (connected to the ${dev ? 'same Wi-Fi as this laptop' : 'event Wi-Fi'}):`)
      L.push(`   Captain / guest tablets :  ${base}/`)
      L.push(`   Waiter phones           :  ${base}/waiter`)
      L.push(`   Desk (supervisor)       :  ${base}/supervisor`)
      L.push(`   QR codes for staff      :  http://localhost${port}/qr  (open on this laptop's screen)`)
      if (ips.length > 1) L.push(`   (this laptop also has ${ips.slice(1).map((a) => a.ip).join(', ')} - use the ${dev ? 'Wi-Fi' : "event router's"} one)`)
      qr = await qrLines(base)
    } else {
      L.push(' !! This laptop is not connected to any network. Connect it to the event router')
      L.push('    (Wi-Fi or cable) - the links for the devices will then appear here.')
    }
    L.push('')
    L.push(` PRINT HUB: close the normal Print Hub window, then double-click "${LAUNCHER.printhub}"`)
    L.push(IS_KIT ? '   in the Offline Kit folder.' : '   in the localmode folder (or: node ss-local.mjs printhub).')
    if (phNote) L.push(`   ${phNote}`)
    L.push('')
    const k = s.kots === undefined ? '' : `   KOTs ${s.kots}   waiting to print ${s.to_print}   print failed ${s.print_failed}`
    L.push(` STATUS  Database ${s.pg ? 'OK' : 'DOWN'}   API ${s.api ? 'OK' : 'DOWN'}   Orders ${s.orders ?? '-'}${k}`)
    L.push(`         Tablets/phones seen in the last 2 minutes: ${s.devices ?? 0}`)
    L.push(` CLOUD   ${uploadLine()}`)
    L.push('')
    L.push(' Keep this window open and the laptop awake (lid open). Ctrl+C stops the server.')
    // The QR codes only when the window is tall enough to show them with
    // everything else (the panel is redrawn every 5 seconds).
    if (qr) {
      const rows = process.stdout.isTTY ? process.stdout.rows || 24 : Infinity
      if (L.length + qr.length + 2 <= rows) L.push('', ...qr)
      else L.push(` (Make this window taller to see QR codes here - or open http://localhost${port}/qr)`)
    }
    const text = L.join('\n')
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[2J\x1b[H' + text + '\n')
    } else if (!lastPrinted) {
      console.log(text)
      lastPrinted = text
    } else {
      // Logged output (not a window): one status line when something changes.
      const line = `${new Date().toISOString()} ${L.filter((l) => /^ (STATUS|CLOUD)/.test(l)).join(' | ').replace(/\s+/g, ' ')}`
      const key = line.slice(25)
      if (key !== lastPrinted || Date.now() - lastPrintedAt > 60000) { console.log(line); lastPrinted = key; lastPrintedAt = Date.now() }
    }
  }

  // ---------------------------------------------------------- background upload
  // Runs as a separate process so a problem there can never touch the service.
  function backgroundUpload() {
    if (dev) return // test database: nothing ever goes to the cloud
    if (state.stopping || state.uploading || !hasCloudApi(cfg)) return
    state.uploading = true
    let out = ''
    const child = spawn(process.execPath, [path.join(HERE, 'ss-local.mjs'), 'upload', '--background'], { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    state.uploadChild = child
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, 5 * 60000)
    const done = (code) => {
      clearTimeout(timer)
      state.uploading = false
      state.uploadChild = null
      const line = out.split(/\r?\n/).reverse().find((l) => l.startsWith('@@RESULT '))
      try { state.upload = JSON.parse(line.slice(9)) } catch {
        state.upload = { at: new Date().toISOString(), error: `upload stopped (code ${code}) - see data/logs`, offline: false }
        logLine('server', `background upload output: ${out.slice(-2000)}`)
      }
    }
    child.on('exit', done)
    child.on('error', (e) => { out += String(e); done(-1) })
  }

  // ---------------------------------------------------------- stop
  let statusTimer, uploadTimer, firstUpload
  async function shutdown(sig) {
    if (state.stopping) { console.log('Still stopping - please wait a moment...'); return }
    state.stopping = true
    console.log(`\nStopping the local server${sig ? ` (${sig})` : ''}...`)
    clearInterval(statusTimer)
    clearInterval(uploadTimer)
    clearTimeout(firstUpload)
    if (state.uploadChild) try { state.uploadChild.kill() } catch { /* gone */ }
    server.close()
    server.closeAllConnections?.()
    await stopChild(state.api)
    await pool.end().catch(() => {})
    const ok = await stopPostgres(pgb)
    fs.rmSync(P.run, { force: true })
    console.log(ok ? 'Stopped. Everything is saved on this laptop.' : 'Stopped (the database needed a forced stop - it will check itself at the next start).')
    process.exit(0)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(IS_WIN ? ['SIGBREAK'] : [])]) process.on(sig, () => shutdown(sig))
  process.on('unhandledRejection', (e) => logLine('server', `unhandled: ${e?.stack || e}`))

  logLine('server', `started on port ${cfg.port}, api ${state.apiPort}, db ${local.pgPort}`)
  await gather()
  await render()
  statusTimer = setInterval(() => { gather().then(render).catch((e) => logLine('server', `status: ${e.message}`)) }, 5000)
  firstUpload = setTimeout(backgroundUpload, 20000)
  uploadTimer = setInterval(backgroundUpload, 60000)
  return new Promise(() => {}) // runs until Ctrl+C
}

// Local KOT numbers must never repeat numbers the cloud gave out after the
// download (tablets still on the cloud during the switch-over). Even a
// download taken a minute ago can clash, so every kitchen's counter is moved
// on once per download, always. A gap in the numbers is harmless; a repeated
// slip number confuses a kitchen.
async function applyKotJump(pool, local, snap, n, events) {
  if (!n) return 'KOT number jump switched off (--kot-jump 0).'
  if (local.kotJump?.snapshotAt === snap.downloadedAt) {
    return local.kotJump.amount ? `KOT numbers were moved on by ${local.kotJump.amount} at the first start with this data.` : ''
  }
  const ageMs = Date.now() - Date.parse(snap.downloadedAt)
  let amount = 0
  if ((await pool.query("select to_regclass('public.kitchens') as r")).rows[0].r) {
    await pool.query('update public.kitchens set kot_seq = kot_seq + $2 where event_id::text = any($1::text[])', [events, n])
    // Smart Serve Maestro: Barker B has its own series (AS-B 014)
    const hasB = (await pool.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'kitchens' and column_name = 'kot_seq_b'")).rowCount > 0
    if (hasB) await pool.query('update public.kitchens set kot_seq_b = coalesce(kot_seq_b, 0) + $2 where event_id::text = any($1::text[])', [events, n])
    amount = n
  }
  local.kotJump = { snapshotAt: snap.downloadedAt, amount, at: new Date().toISOString(), dataAgeMinutes: Math.round(ageMs / 60000) }
  saveLocal(local)
  logLine('server', `kot jump ${amount} (data ${fmtAgo(ageMs)})`)
  return amount
    ? `KOT numbers moved on by ${amount} (IT-021 -> IT-121), so no slip repeats a number the cloud already printed.`
    : 'No kitchens in this event: nothing to move on.'
}

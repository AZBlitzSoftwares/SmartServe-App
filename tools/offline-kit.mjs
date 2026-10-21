// Offline Kit: after "vite build", packs everything an event laptop needs to run
// an event without internet into two downloads, served by the app itself:
//   dist/downloads/SmartServe-Offline-Kit-Windows.zip
//   dist/downloads/SmartServe-Offline-Kit-Mac.zip
//   dist/downloads/SmartServe-Print-Hub.exe / SmartServe-Print-Hub-Mac.zip (the Print
//     Hub as one program, nothing to install: one laptop on the printers' router)
//   dist/downloads/SmartServe-Print-Hub-Windows-Node.zip / -Mac-Node.zip (the same
//     Print Hub for a laptop with Node.js: Intel Macs, or if the program is blocked)
//   dist/downloads/offline-kit.json   (what the Control tab shows)
// The laptop needs only Node.js: no Git, no build, no database password. The
// kit carries the built app, the local server, the Print Hub, the database
// updates and a config.json with this cloud's address and public (anon) key.
// No cloud settings at build time (VITE_SUPABASE_URL / _ANON_KEY): no kit, the
// build carries on.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(DIST, 'downloads')
const KIT = 'SmartServe Offline Kit'

// ---------------------------------------------------------------- settings
// The same values the app was just built with (Vite's own rules: the build's
// environment first, then .env.production.local, .env.local, .env.production, .env).
const { loadEnv } = await import('vite')
const ENV = loadEnv('production', ROOT, 'VITE_')
const CLOUD_URL = ENV.VITE_SUPABASE_URL || ''
const ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || ''
// Where "6 Open Desk" opens the cloud desk (the app's own address, as serverSwitch.js has it).
const APP_URL = ENV.VITE_CLOUD_BASE || 'https://smart-serve-app.vercel.app'

// ---------------------------------------------------------------- zip (no packages)
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}
// entries: { name, data?: Buffer, dir?: true, exec?: true }
function makeZip(entries) {
  const now = dosTime(new Date())
  const locals = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.dir ? e.name.replace(/\/?$/, '/') : e.name, 'utf8')
    const raw = e.dir ? Buffer.alloc(0) : e.data
    const comp = e.dir ? raw : zlib.deflateRawSync(raw, { level: 9 })
    const method = e.dir ? 0 : 8
    const crc = e.dir ? 0 : crc32(raw)
    const mode = e.dir ? 0o40755 : e.exec ? 0o100755 : 0o100644
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(now.time, 10); lh.writeUInt16LE(now.date, 12); lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(now.time, 12); ch.writeUInt16LE(now.date, 14); ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE(((mode << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38); ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, comp)
    central.push(ch, name)
    offset += lh.length + name.length + comp.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

// ---------------------------------------------------------------- kit contents
function walk(dir, base = dir, skip = () => false) {
  const out = []
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f)
    const rel = path.relative(base, p).split(path.sep).join('/')
    if (skip(rel)) continue
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, base, skip))
    else out.push(rel)
  }
  return out
}
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p))
const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

// Each launcher of localmode/, moved to the top of the kit: it changes into files/localmode first.
const LAUNCHERS = [
  ['1 Prepare Event', 'Prepare Event'],
  ['2 Refresh Event Data', 'Refresh Event Data'],
  ['3 Start Local Server', 'Start Local Server'],
  ['4 Start Print Hub', 'Start Print Hub (Local)'],
  ['5 Upload to Cloud', 'Upload to Cloud'],
  ['6 Open Desk', 'Open Desk'],
]
function launcher(src, ext) {
  let s = read('localmode', `${src}.${ext}`).toString('utf8')
  const swap = (a, b) => {
    if (!s.includes(a)) throw new Error(`offline kit: "${src}.${ext}" no longer has: ${a}`)
    s = s.split(a).join(b)
  }
  if (ext === 'command') {
    swap('cd "$(dirname "$0")" || exit 1', 'cd "$(dirname "$0")/files/localmode" || exit 1')
    swap('xattr -dr com.apple.quarantine . 2>/dev/null', 'xattr -dr com.apple.quarantine ../.. 2>/dev/null')
    return Buffer.from(s.replace(/\r\n/g, '\n'))
  }
  swap('cd /d "%~dp0"', 'cd /d "%~dp0files\\localmode"')
  return Buffer.from(crlf(s))
}

function readMe(os) {
  const mac = os === 'mac'
  const text = `SMART SERVE - OFFLINE KIT (laptop server)
==========================================

When the venue internet is bad, this laptop runs the whole event over the event
router: captain and guest tablets, kitchen screens, the Control Desk, waiter
phones and the KOT printers. Every event type works. One laptop can carry
several events of the same day.

ONCE, ON THIS LAPTOP
 1. Install Node.js (the LTS version) from https://nodejs.org
    (Next / Continue until Finish).
 2. ${mac ? 'Double-click the zip to unpack it, and move the folder to Documents.' : 'Right-click the zip > Extract All, and keep the folder in Documents.'}

THE DAY BEFORE (with internet)
 3. Double-click "1 Prepare Event". Type the number of your event and press Enter
    (several events: 1,2). The first time it also downloads its own parts
    (about 150 MB), which takes a few minutes.
${mac
    ? `    Mac, first time only: if macOS says it cannot open the file, click Done,
    open System Settings > Privacy & Security, scroll down and click
    "Open Anyway" (or right-click the file > Open > Open).`
    : `    Windows, first time only: if it says "Windows protected your PC",
    click More info > Run anyway.`}

AT THE VENUE
 - Connect this laptop to the event router (the Wi-Fi of the tablets and the
   printers). Keep it plugged in, awake and the lid open.
 - Internet fine: nothing to do here. Everyone stays on the cloud.
 - Internet bad (Plan B): switch everything together, and stay on the laptop
   until the event ends:
 4. "2 Refresh Event Data" (only if there is some internet): brings the
    orders taken so far and any last changes.
 5. "3 Start Local Server". Keep the window open. It shows this laptop's
    address, for example http://192.168.1.10:8080, and opens the Control
    Desk on this laptop in its own Chrome window (see PRINTING below).
 6. Network kitchen printers only: "4 Start Print Hub" (close the normal
    Print Hub first). Every printer should show ONLINE.
 7. Move every device to the laptop, all at once:
    - Tablets with some internet show "Laptop server is on" on the sign-in
      and set-up screens (this laptop tells the cloud its address): tap
      "Use laptop server" and the supervisor PIN. Nothing to type.
    - Otherwise: tap "Device" (or "Use laptop server" on the "Can't reach
      the server" screen), supervisor PIN, "Use laptop server". The address
      is filled in when known; else type it, or tap "Search this Wi-Fi".
    - Kitchen screens: menu (three lines) > "Use laptop server".
    - Control Desk on another device: Control tab > Offline kit > "Use laptop
      server". On this laptop it is already open (step 5).
    - Or type the address in the browser: /kitchen for kitchen screens,
      /supervisor for the desk, /waiter for waiter phones.
    Switched devices keep their sign-in and table; a typed address signs in
    again. If the laptop gets a new address during the event, devices on it
    find it again by themselves within a minute. KOT numbers jump by 100 on
    the laptop - that is expected.

AFTER THE EVENT (with internet)
 8. Close the Local Server and Print Hub windows${mac ? ' (Ctrl+C)' : ''}, then
    "5 Upload to Cloud". Wait for "Everything on this laptop is now in the cloud."

PRINTING
 - USB printer on this laptop (guest and captain events): make the KOT
   printer this laptop's DEFAULT printer:
${mac
    ? `     System Settings > Printers & Scanners > Default printer
     (choose the printer, not "Last Printer Used").`
    : `     Settings > Printers & scanners > untick "Let Windows manage my
     default printer" > click the printer > Set as default.`}
   Then use the desk in the window that "3 Start Local Server" or
   "6 Open Desk" opens. With Auto-print ON the KOT prints by itself as soon
   as a waiter is assigned, with no print dialog. In any other browser
   window the print dialog comes back.
 - "6 Open Desk" without the Local Server opens the cloud desk the same way:
   use it on normal days too. Closed the desk window? "6 Open Desk" again.
 - That window prints to ONE printer (the default). A second counter with
   its own printer needs its own laptop and desk window, or network
   printers with "4 Start Print Hub".
 - Network printers for several kitchens (Maestro, multi-kitchen): the
   Print Hub, not the desk window.

GOOD TO KNOW
 - Make menu, kitchen, printer and staff changes in the cloud BEFORE
   "1 Prepare Event". Changes made on the laptop are not uploaded.
 - Several events on one day: one laptop can carry all of them (type 1,2).
   Events at different venues: one laptop for each venue. Never run two
   laptops for the same event.
 - Give this laptop the same address on the event router every time
   (router settings > DHCP / address reservation), so the links never change.
 - To try it without printers: files/printhub/Start Virtual Printers.
 - Help: files/localmode/README.md (Troubleshooting), and the report
   files/localmode/data/prepare-report.txt
`
  return Buffer.from(mac ? text : crlf(text))
}

function kitEntries(os) {
  const ext = os === 'mac' ? 'command' : 'bat'
  const entries = []
  const add = (name, data, exec = false) => entries.push({ name: `${KIT}/${name}`, data: Buffer.isBuffer(data) ? data : Buffer.from(data), exec })
  add('READ ME FIRST.txt', readMe(os))
  for (const [name, src] of LAUNCHERS) add(`${name}.${ext}`, launcher(src, ext), ext === 'command')
  // the built app (without these downloads)
  for (const f of walk(DIST, DIST, (rel) => rel === 'downloads' || rel.startsWith('downloads/'))) add(`files/dist/${f}`, fs.readFileSync(path.join(DIST, f)))
  // database updates (dated files only - never the demo files)
  for (const f of fs.readdirSync(path.join(ROOT, 'db')).filter((x) => /^\d{4}-\d{2}-\d{2}_.+\.sql$/.test(x)).sort()) add(`files/db/${f}`, read('db', f))
  // the local server: only its program files (settings, data and packages are made on the laptop)
  const lm = path.join(ROOT, 'localmode')
  const lmFiles = ['ss-local.mjs', 'package.json', 'package-lock.json', 'README.md', 'config.example.json', 'dev/standin-schema.sql',
    ...fs.readdirSync(path.join(lm, 'lib')).filter((f) => f.endsWith('.mjs')).sort().map((f) => `lib/${f}`)]
  for (const f of lmFiles) add(`files/localmode/${f}`, fs.readFileSync(path.join(lm, f)))
  add('files/localmode/config.json', JSON.stringify({ cloud: { url: CLOUD_URL, anonKey: ANON_KEY }, appUrl: APP_URL, port: 8080, openDesk: true, events: [] }, null, 2) + '\n')
  // the Print Hub (no packages needed) and its Virtual Printers for a test without printers
  const ph = path.join(ROOT, 'printhub')
  const phFiles = fs.readdirSync(ph).filter((f) => /\.(mjs|html)$/.test(f) || f === 'README.md' || f === 'config.example.json').sort()
  for (const f of phFiles) add(`files/printhub/${f}`, fs.readFileSync(path.join(ph, f)))
  const vp = read('printhub', `Start Virtual Printers.${ext}`)
  add(`files/printhub/Start Virtual Printers.${ext}`, ext === 'bat' ? Buffer.from(crlf(vp.toString('utf8'))) : vp, ext === 'command')
  // folders first, so every unzip tool makes them
  const dirs = new Set()
  for (const e of entries) { const parts = e.name.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')) }
  return [...[...dirs].sort().map((d) => ({ name: d, dir: true })), ...entries]
}

// ---------------------------------------------------------------- Print Hub alone
// For every normal day (internet fine): the laptop on the printers' router runs
// this and nothing else. Only Node.js is needed; config.json already carries
// this cloud's address and public key, so it starts with one double-click.
const HUB = 'SmartServe Print Hub'
function hubReadMe(os) {
  const mac = os === 'mac'
  const text = `SMART SERVE - PRINT HUB
=======================

The Print Hub sends every KOT to the kitchen printers. It runs on ONE laptop
that is connected to the same router (Wi-Fi or cable) as the printers.
The app itself cannot reach a printer: the Print Hub on this laptop does.

ONCE, ON THIS LAPTOP
 1. Install Node.js (the LTS version) from https://nodejs.org
    (Next / Continue until Finish).
 2. ${mac ? 'Double-click the zip to unpack it, and move the folder to Documents.' : 'Right-click the zip > Extract All, and keep the folder in Documents.'}

EVERY EVENT
 3. Switch on the router and the printers. Connect this laptop to the same
    router. Keep the laptop plugged in, awake and the lid open.
 4. Double-click "Start Print Hub". Keep its window open until the event ends.
${mac
    ? `    Mac, first time only: if macOS says it cannot open the file, click Done,
    open System Settings > Privacy & Security, scroll down and click
    "Open Anyway" (or right-click the file > Open > Open).`
    : `    Windows, first time only: if it says "Windows protected your PC",
    click More info > Run anyway.`}
 5. Control Desk > Control tab > Event set-up > Kitchens & printers >
    "Find printers". Every printer on this router appears with its address.
    "Print a slip" shows which printer is which; "Use for a kitchen" gives it
    to a kitchen. No IP address or port to type.
 6. "Test print" on each kitchen.

GOOD TO KNOW
 - ONLY ONE Print Hub per event. Close any other Print Hub (on another
   laptop) first: every Print Hub that runs takes that event's KOTs.
 - The Print Hub prints for the events dated today.
 - A printer that restarts on a new address is followed automatically.
 - To stop: close the window${mac ? ' (or press Ctrl+C in it)' : ''}.
 - If the venue internet is bad, use the Offline Kit (Control tab >
   Offline kit) and its own "4 Start Print Hub" instead of this one.
`
  return Buffer.from(mac ? text : crlf(text))
}
function hubLauncher(ext) {
  let s = read('printhub', `Start Print Hub.${ext}`).toString('utf8')
  const a = ext === 'command' ? 'cd "$(dirname "$0")" || exit 1' : 'cd /d "%~dp0"'
  const b = ext === 'command' ? 'cd "$(dirname "$0")/files" || exit 1' : 'cd /d "%~dp0files"'
  if (!s.includes(a)) throw new Error(`print hub: "Start Print Hub.${ext}" no longer has: ${a}`)
  s = s.split(a).join(b)
  return ext === 'command' ? Buffer.from(s.replace(/\r\n/g, '\n')) : Buffer.from(crlf(s))
}
function hubEntries(os) {
  const ext = os === 'mac' ? 'command' : 'bat'
  const entries = []
  const add = (name, data, exec = false) => entries.push({ name: `${HUB}/${name}`, data: Buffer.isBuffer(data) ? data : Buffer.from(data), exec })
  add('READ ME FIRST.txt', hubReadMe(os))
  add(`Start Print Hub.${ext}`, hubLauncher(ext), ext === 'command')
  for (const f of ['printhub.mjs', 'discover.mjs', 'escpos.mjs']) add(`files/${f}`, read('printhub', f))
  // no hubName: each laptop reports under its own computer name
  add('files/config.json', JSON.stringify({ use: 'cloud', servers: { cloud: { url: CLOUD_URL, anonKey: ANON_KEY } }, eventId: 'auto', pollMs: 1500 }, null, 2) + '\n')
  const dirs = new Set()
  for (const e of entries) { const parts = e.name.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')) }
  return [...[...dirs].sort().map((d) => ({ name: d, dir: true })), ...entries]
}

// ---------------------------------------------------------------- Print Hub as one program
// Bun turns the Print Hub into a single program for Windows and for Macs with Apple chips,
// with this cloud's address and public key built in: download, double-click, done. Built on
// any machine (Bun cross-compiles). Without Bun, or if a build fails, only the Node.js
// version is offered.
const APP_TARGETS = [
  { os: 'windows', target: 'bun-windows-x64', file: 'SmartServe-Print-Hub.exe' },
  { os: 'mac', target: 'bun-darwin-arm64', file: 'SmartServe-Print-Hub-Mac.zip', inZip: 'SmartServe Print Hub' },
]
function bunBinary() {
  const b = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
  return fs.existsSync(b) ? b : null
}
function buildApps() {
  const bun = bunBinary()
  if (!bun) { console.warn('print hub app: Bun not installed - only the Node.js version'); return [] }
  // Bun writes the program next to its working folder and then renames it into place: keep the
  // working folder, the entry and the output on the project's own disk (on Vercel /tmp is another
  // disk and the rename fails)
  const tmp = fs.mkdtempSync(path.join(ROOT, '.printhub-build-'))
  const out = []
  try {
    const ph = (f) => path.join(ROOT, 'printhub', f).split(path.sep).join('/')
    const entry = path.join(tmp, 'entry.mjs')
    fs.writeFileSync(entry, `import ${JSON.stringify(ph('app-flag.mjs'))}\n` +
      `import { main } from ${JSON.stringify(ph('printhub.mjs'))}\n` +
      `main({ embedded: ${JSON.stringify({ url: CLOUD_URL, anonKey: ANON_KEY })} })\n`)
    for (const t of APP_TARGETS) {
      const bin = path.join(tmp, t.target + (t.os === 'windows' ? '.exe' : ''))
      const r = spawnSync(bun, ['build', '--compile', `--target=${t.target}`, entry, '--outfile', bin], { cwd: tmp, encoding: 'utf8', timeout: 600_000 })
      if (r.status !== 0 || !fs.existsSync(bin)) {
        console.warn(`print hub app: ${t.target} NOT built (${(r.stderr || r.error?.message || '').trim().split('\n').pop()})`)
        continue
      }
      const data = t.inZip
        ? makeZip([{ name: t.inZip, data: fs.readFileSync(bin), exec: true }])
        : fs.readFileSync(bin)
      fs.writeFileSync(path.join(OUT, t.file), data)
      out.push({ os: t.os, kind: 'app', file: t.file, bytes: data.length })
      console.log(`print hub app: ${t.file} ${(data.length / 1048576).toFixed(1)} MB`)
    }
  } catch (e) {
    console.warn(`print hub app: NOT built (${e.message})`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return out
}

// ---------------------------------------------------------------- main
// A problem with the kit never stops the app's own deploy: it only leaves the
// kit out of this build (the Control tab then says so).
try {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html not found - run "vite build" first')
  fs.rmSync(OUT, { recursive: true, force: true })
  if (!CLOUD_URL || !ANON_KEY) {
    console.warn('offline kit: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set - no Offline Kit in this build')
  } else {
    fs.mkdirSync(OUT, { recursive: true })
    const info = { builtAt: new Date().toISOString(), cloud: CLOUD_URL, kits: [], printhub: [] }
    for (const [os, label] of [['windows', 'Windows'], ['mac', 'Mac']]) {
      const file = `SmartServe-Offline-Kit-${label}.zip`
      const buf = makeZip(kitEntries(os))
      fs.writeFileSync(path.join(OUT, file), buf)
      info.kits.push({ os, file, bytes: buf.length })
      console.log(`offline kit: ${file} ${(buf.length / 1048576).toFixed(1)} MB`)
      const hubFile = `SmartServe-Print-Hub-${label}-Node.zip`
      const hub = makeZip(hubEntries(os))
      fs.writeFileSync(path.join(OUT, hubFile), hub)
      info.printhub.push({ os, kind: 'node', file: hubFile, bytes: hub.length })
      console.log(`print hub (Node.js): ${hubFile} ${(hub.length / 1024).toFixed(0)} KB`)
    }
    info.printhub.unshift(...buildApps())
    fs.writeFileSync(path.join(OUT, 'offline-kit.json'), JSON.stringify(info, null, 2) + '\n')
  }
} catch (e) {
  console.warn(`offline kit: NOT built (${e.message}) - the app itself is fine`)
  try { fs.rmSync(OUT, { recursive: true, force: true }) } catch { /* nothing to remove */ }
}

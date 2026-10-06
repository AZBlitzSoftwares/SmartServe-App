// Shared bits for the local server: where files live, the two settings files
// (config.json = what the operator edits, data/local.json = secrets this
// laptop generated), and small helpers used by every command.
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') // .../localmode
export const REPO = path.resolve(HERE, '..')
const DATA = path.join(HERE, 'data')

export const P = {
  config: path.join(HERE, 'config.json'),
  configExample: path.join(HERE, 'config.example.json'),
  bin: path.join(HERE, 'bin'),
  app: path.join(HERE, 'app'),
  data: DATA,
  pgData: path.join(DATA, 'pg'),
  local: path.join(DATA, 'local.json'),
  snapshot: path.join(DATA, 'snapshot.json'),
  report: path.join(DATA, 'prepare-report.txt'),
  schemaSql: path.join(DATA, 'schema.sql'),
  media: path.join(DATA, 'media'),
  logs: path.join(DATA, 'logs'),
  run: path.join(DATA, 'run.json'),
  lastUpload: path.join(DATA, 'last-upload.json'),
  postgrestConf: path.join(DATA, 'postgrest.conf'),
  printhub: path.join(REPO, 'printhub'),
}

export const DB_NAME = 'smartserve'
export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

// A problem the operator can fix (settings, order of steps...). Printed
// without a stack trace. Exit code 2 tells the launchers not to restart.
export class UserError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode }
}

// ---------------------------------------------------------------- files

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

// Write to a temp file first, so a power cut never leaves half a file.
export function writeJson(file, obj, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', mode ? { mode } : undefined)
  fs.renameSync(tmp, file)
}

export function logLine(name, text) {
  try {
    fs.mkdirSync(P.logs, { recursive: true })
    const d = new Date()
    fs.appendFileSync(path.join(P.logs, `${name}-${localDate(d)}.log`), `${d.toISOString()} ${text}\n`)
  } catch { /* logging must never break the server */ }
}

// ---------------------------------------------------------------- config.json

export function loadConfig({ create = true } = {}) {
  if (!fs.existsSync(P.config)) {
    if (!create) return null
    fs.copyFileSync(P.configExample, P.config)
    throw new UserError(
      `A settings file was created:\n  ${P.config}\n\n` +
      'Open it (Mac: TextEdit, Windows: Notepad) and paste:\n' +
      '  - the anon key in place of PASTE_ANON_KEY\n' +
      '  - the database connection string in place of PASTE_DATABASE_CONNECTION_STRING\n' +
      'Keep the quote marks around both. Save, then run this again.\n' +
      'README.md (section "One-time setup") says where to find both.')
  }
  let cfg
  try {
    // TextEdit likes to turn " into curly quotes; JSON needs straight ones.
    const text = fs.readFileSync(P.config, 'utf8').replace(/[\u201C\u201D]/g, '"').replace(/^\uFEFF/, '')
    cfg = JSON.parse(text)
  } catch (e) {
    throw new UserError(`config.json could not be read: ${e.message}\n` +
      'Check the quote marks and commas, or delete config.json to start again from the example.')
  }
  cfg.cloud = cfg.cloud || {}
  cfg.port = Number(cfg.port) || 8080
  cfg.events = Array.isArray(cfg.events) ? cfg.events : []
  return cfg
}

export function saveConfig(cfg) { writeJson(P.config, cfg) }

const unset = (v) => !v || /PASTE_/.test(String(v))
export const hasCloudApi = (cfg) => !!cfg && !unset(cfg.cloud.url) && !unset(cfg.cloud.anonKey)

export function requireCloudApi(cfg) {
  if (unset(cfg.cloud.url)) throw new UserError('config.json: "url" under "cloud" is missing.')
  if (unset(cfg.cloud.anonKey)) throw new UserError('config.json: paste the anon key in place of PASTE_ANON_KEY (keep the quote marks).')
}

export function requireCloudDb(cfg) {
  if (unset(cfg.cloud.dbUrl)) {
    throw new UserError('config.json: paste the database connection string in place of PASTE_DATABASE_CONNECTION_STRING.\n' +
      'Supabase -> Project Settings -> Database -> Connection string -> URI ("Session pooler"), with the password filled in.')
  }
}

// Options for the pg client from the Supabase connection string. Parsed by
// hand so a password with @ # / ? in it still works (URL parsing breaks on those).
export function cloudDbOptions(dbUrl) {
  const s = String(dbUrl || '').trim()
  if (/\[YOUR-PASSWORD\]/i.test(s)) {
    throw new UserError('The database connection string still contains [YOUR-PASSWORD].\n' +
      'Replace it - including the square brackets - with the database password.')
  }
  const m = s.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::(.*))?@([^@/:?]+)(?::(\d+))?\/([^?\s]*)(?:\?.*)?$/)
  let opt
  if (m) {
    let password = m[2] ?? ''
    try { password = decodeURIComponent(password) } catch { /* keep as typed */ }
    opt = { user: decodeURIComponent(m[1]), password, host: m[3], port: Number(m[4] || 5432), database: m[5] || 'postgres' }
  } else if (/^postgres(?:ql)?:\/\//.test(s)) {
    opt = { connectionString: s }
  } else {
    throw new UserError('The database connection string in config.json should start with postgresql://')
  }
  const host = opt.host || ''
  const isLocal = !host || host === 'localhost' || host.startsWith('127.') || host === '::1' || host.startsWith('/')
  // Supabase requires TLS; its certificate chain is not in Node's default store.
  if (!isLocal) opt.ssl = { rejectUnauthorized: false }
  opt.connectionTimeoutMillis = 20000
  opt.application_name = 'smartserve-local-prepare'
  return opt
}

// ---------------------------------------------------------------- data/local.json

const rnd = (bytes) => crypto.randomBytes(bytes).toString('hex')

export function makeJwt(payload, secret) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export const loadLocal = () => readJson(P.local, null)
export const saveLocal = (local) => writeJson(P.local, local, 0o600)

// Secrets of this laptop's database and API. Made once, kept for good, so the
// anon key in the Print Hub settings stays valid across prepares.
export function ensureLocal() {
  let local = loadLocal()
  if (local) return local
  const now = Math.floor(Date.now() / 1000)
  const jwtSecret = rnd(32)
  local = {
    createdAt: new Date().toISOString(),
    pgPort: 54329,
    pgPassword: rnd(16),     // superuser "postgres", only used by this program
    apiPassword: rnd(16),    // role "authenticator", used by PostgREST
    jwtSecret,
    anonKey: makeJwt({ role: 'anon', iss: 'smartserve-local', iat: now, exp: now + 10 * 365 * 86400 }, jwtSecret),
  }
  saveLocal(local)
  return local
}

export const localDbOptions = (local, database = DB_NAME) => ({
  host: '127.0.0.1', port: local.pgPort, user: 'postgres', password: local.pgPassword, database,
  connectionTimeoutMillis: 5000, application_name: 'smartserve-local',
})

// ---------------------------------------------------------------- small helpers

export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`
export const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"'
export const two = (n) => String(n).padStart(2, '0')
export const localDate = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
export const addDays = (n, d = new Date()) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function fmtTime(d) {
  d = new Date(d)
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
  return `${two(h)}:${two(d.getMinutes())} ${ap}`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function fmtDay(ymd) { // '2026-10-13' -> 'Tue 13 Oct 2026'
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return String(ymd)
  return `${DAYS[new Date(y, m - 1, d).getDay()]} ${two(d)} ${MONTHS[m - 1]} ${y}`
}
export const fmtDateTime = (d) => { d = new Date(d); return `${fmtDay(localDate(d))} ${fmtTime(d)}` }
export function fmtAgo(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ${min % 60} min ago`
  return `${Math.floor(h / 24)} days ago`
}

export function eventLabel(e) {
  const mode = e.service_mode === 'captain' ? 'captain service' : 'guest self-service'
  const mk = e.multi_kitchen === true || e.multi_kitchen === 'true' ? ', multi-kitchen' : ''
  return `${e.name} (${fmtDay(e.date)}, ${mode}${mk})`
}

// Is a TCP port free on this laptop?
export function portFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, host, () => s.close(() => resolve(true)))
  })
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}

export function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

// The laptop's addresses on the event router. Virtual adapters (VirtualBox,
// Hyper-V, Docker...) are listed last so the first link is the real Wi-Fi/LAN.
export function lanAddresses() {
  const out = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ ip: a.address, name })
    }
  }
  const rank = ({ ip, name }) => {
    let r = ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
    if (/virtual|vbox|vmware|vethernet|docker|wsl|hyper-v|bridge|utun|awdl|llw|tailscale|zerotier/i.test(name)) r += 10
    if (ip.startsWith('169.254.')) r += 20
    return r
  }
  return out.sort((a, b) => rank(a) - rank(b))
}

// GET with a short timeout; resolves to { ok, status, json } and never throws.
export async function httpGet(url, { timeoutMs = 3000, headers } = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    let json = null
    try { json = await res.json() } catch { /* not json */ }
    return { ok: res.ok, status: res.status, json }
  } catch (e) {
    return { ok: false, status: 0, error: e }
  }
}

export function serverRunning(cfg) {
  const run = readJson(P.run, null)
  const port = run?.port || cfg?.port || 8080
  return httpGet(`http://127.0.0.1:${port}/__ss/health`, { timeoutMs: 2500 })
    .then((r) => (r.ok && r.json?.app === 'smartserve-local' ? r.json : null))
}

export function isPrepared() {
  return fs.existsSync(P.local) && fs.existsSync(P.snapshot) && fs.existsSync(path.join(P.pgData, 'PG_VERSION'))
}

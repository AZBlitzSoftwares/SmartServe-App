// The two programs the local server runs: Postgres (from the embedded-postgres
// npm package, controlled with pg_ctl) and PostgREST (downloaded once from
// GitHub). Everything platform-specific lives in this file.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import pg from 'pg'
import { P, DB_NAME, IS_WIN, IS_MAC, UserError, localDbOptions, portFree, freePort, saveLocal, sleep, logLine, pidAlive } from './common.mjs'

export const PGRST_VERSION = '13.0.5'
const PGRST_ASSETS = {
  'darwin-arm64': 'macos-aarch64.tar.xz',
  'darwin-x64': 'macos-x86-64.tar.xz',
  'win32-x64': 'windows-x86-64.zip',
  'linux-x64': 'linux-static-x86-64.tar.xz',
}
const EXE = IS_WIN ? '.exe' : ''
export const postgrestPath = () => path.join(P.bin, 'postgrest' + EXE)

export function refuseRoot() {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new UserError('Please do not run this as root / with sudo: the database refuses to run as root.\n' +
      'Run it as your normal user (just double-click the launcher).')
  }
}

// Run a program and wait. Output goes to a log file, never to a pipe: on
// Windows pg_ctl's background postgres would inherit a pipe and keep us waiting.
export function exec(cmd, args, { logFile, env, timeoutMs = 120000, cwd } = {}) {
  return new Promise((resolve) => {
    fs.mkdirSync(P.logs, { recursive: true })
    const file = logFile || path.join(P.logs, 'commands.log')
    const fd = fs.openSync(file, 'a')
    fs.writeSync(fd, `\n${new Date().toISOString()} $ ${path.basename(cmd)} ${args.join(' ')}\n`)
    let child
    try {
      child = spawn(cmd, args, { stdio: ['ignore', fd, fd], env: env || process.env, cwd, windowsHide: true })
    } catch (e) {
      fs.closeSync(fd)
      return resolve({ code: -1, error: e })
    }
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); fs.closeSync(fd); resolve({ code: -1, error: e }) })
    child.on('exit', (code) => { clearTimeout(timer); try { fs.closeSync(fd) } catch { /* closed */ } resolve({ code: code ?? -1 }) })
  })
}

const tail = (file, n = 15) => {
  try { return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-n).join('\n') } catch { return '' }
}

// ================================================================ Postgres

export async function pgBins() {
  const osName = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[process.platform]
  const key = `${osName}-${process.arch}`
  let m
  try {
    m = await import(`@embedded-postgres/${key}`)
  } catch {
    throw new UserError(`The database program for this computer (${key}) is not installed.\n` +
      'Double-click one of the launchers (it installs it), or run "npm install" in the localmode folder.')
  }
  const binDir = path.dirname(m.pg_ctl)
  return { pg_ctl: m.pg_ctl, initdb: m.initdb, binDir, libDir: path.resolve(binDir, '..', 'lib') }
}

// Windows: Postgres (and libpq) are built with Visual C++ and need its runtime.
// Most PCs have it; if not, fetch Microsoft's installer and open it.
export async function ensureVcRuntime() {
  if (!IS_WIN) return
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  if (fs.existsSync(path.join(sys32, 'vcruntime140.dll'))) return
  const url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
  const file = path.join(P.bin, 'vc_redist.x64.exe')
  try {
    if (!fs.existsSync(file)) await downloadFile(url, file, 300000)
    spawn(file, ['/install', '/passive', '/norestart'], { detached: true, stdio: 'ignore' }).unref()
  } catch { /* fall through to the message */ }
  throw new UserError('This Windows laptop needs a free Microsoft part first: "Visual C++ Redistributable (x64)".\n' +
    'Its installer should have opened now - click Install, then Yes. If it did not open, download it from\n' +
    `  ${url}\nand run it. When it has finished, run Prepare Event again.`)
}

// First run only: create the database cluster in data/pg.
export async function initCluster(pgb, local) {
  if (fs.existsSync(path.join(P.pgData, 'PG_VERSION'))) return false
  fs.mkdirSync(P.data, { recursive: true })
  fs.rmSync(P.pgData, { recursive: true, force: true })
  const pwFile = path.join(P.data, 'pw.tmp')
  fs.writeFileSync(pwFile, local.pgPassword + '\n', { mode: 0o600 })
  const logFile = path.join(P.logs, 'initdb.log')
  const base = ['-D', P.pgData, '-U', 'postgres', `--pwfile=${pwFile}`, '--auth=scram-sha-256', '-E', 'UTF8', '--locale=C']
  try {
    // ICU "en-US" sorts names like the cloud does (a, B, c - not B, a, c).
    // Plain C locale is the fallback if this build has no ICU.
    let r = await exec(pgb.initdb, [...base, '--locale-provider=icu', '--icu-locale=en-US'], { logFile })
    if (r.code !== 0) {
      fs.rmSync(P.pgData, { recursive: true, force: true })
      r = await exec(pgb.initdb, base, { logFile })
    }
    if (r.code !== 0) throw new Error(`Creating the local database failed:\n${tail(logFile)}`)
  } finally {
    fs.rmSync(pwFile, { force: true })
  }
  // Only reachable from this laptop (the API server is the one other devices use).
  fs.appendFileSync(path.join(P.pgData, 'postgresql.conf'), [
    '', '# ---- Janu\'s Smart Serve local server ----',
    "listen_addresses = '127.0.0.1'",
    "unix_socket_directories = ''",
    'max_connections = 60',
    "log_line_prefix = '%m [%p] '",
    '',
  ].join('\n'))
  return true
}

// Does our own database answer on its port? (true = it is ours and running)
export async function pgAnswers(local, timeoutMs = 3000) {
  const c = new pg.Client({ ...localDbOptions(local, 'postgres'), connectionTimeoutMillis: timeoutMs })
  try {
    await c.connect()
    const { rows } = await c.query("select current_setting('data_directory') as d")
    const same = (a, b) => { try { a = fs.realpathSync(a); b = fs.realpathSync(b) } catch { /* compare as is */ } return IS_WIN || IS_MAC ? a.toLowerCase() === b.toLowerCase() : a === b }
    return same(rows[0].d, P.pgData)
  } catch {
    return false
  } finally {
    c.end().catch(() => {})
  }
}

const pgLog = () => path.join(P.logs, 'postgres.log')

export async function stopPostgres(pgb) {
  let r = await exec(pgb.pg_ctl, ['stop', '-D', P.pgData, '-m', 'fast', '-w', '-t', '60'], { logFile: pgLog() })
  if (r.code !== 0) r = await exec(pgb.pg_ctl, ['stop', '-D', P.pgData, '-m', 'immediate', '-w', '-t', '30'], { logFile: pgLog() })
  return r.code === 0
}

// Start our Postgres. Cleans up after a crash, a closed window or a restart:
// a server of ours that is still running is stopped cleanly first, and a lock
// file left behind by a dead server is removed.
export async function startPostgres(pgb, local) {
  const pidFile = path.join(P.pgData, 'postmaster.pid')
  if (fs.existsSync(pidFile)) {
    if (await pgAnswers(local)) {
      console.log('  A database from an earlier run is still running - stopping it cleanly first...')
      await stopPostgres(pgb)
    } else {
      const st = await exec(pgb.pg_ctl, ['status', '-D', P.pgData], { logFile: pgLog() })
      if (st.code === 0) {
        // pg_ctl sees a live process with that id but it is not answering:
        // either still shutting down, or the id now belongs to another program.
        await sleep(3000)
        if (fs.existsSync(pidFile) && !(await pgAnswers(local))) {
          await exec(pgb.pg_ctl, ['stop', '-D', P.pgData, '-m', 'fast', '-w', '-t', '20'], { logFile: pgLog() })
        }
      }
      // Postgres itself also refuses to start twice on one folder (shared
      // memory check), so removing a stale lock file here is safe.
      if (fs.existsSync(pidFile) && !(await pgAnswers(local))) fs.rmSync(pidFile, { force: true })
    }
  }
  if (!(await portFree(local.pgPort, '127.0.0.1'))) {
    local.pgPort = await freePort()
    saveLocal(local)
  }
  const r = await exec(pgb.pg_ctl, ['start', '-D', P.pgData, '-l', pgLog(), '-w', '-t', '120', '-o', `-p ${local.pgPort}`], { logFile: pgLog(), timeoutMs: 150000 })
  if (r.code !== 0 || !(await pgAnswers(local, 10000))) {
    throw new Error(`The local database did not start.\n${tail(pgLog())}\n\nIf this keeps happening, restart the laptop and try again.`)
  }
}

// Run fn with the database up; stop it afterwards only if we started it.
export async function withPostgres(pgb, local, fn) {
  const wasRunning = await pgAnswers(local)
  if (!wasRunning) await startPostgres(pgb, local)
  try {
    return await fn()
  } finally {
    if (!wasRunning) await stopPostgres(pgb)
  }
}

export async function connectLocal(local, database = DB_NAME) {
  const c = new pg.Client(localDbOptions(local, database))
  c.on('error', () => {}) // a dropped connection must not crash the program
  await c.connect()
  return c
}

// ================================================================ PostgREST

export async function downloadFile(url, file, timeoutMs = 600000, maxBytes = Infinity) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const tmp = file + '.part'
  let bytes = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (c) => { bytes += c.length; if (bytes > maxBytes) body.destroy(new Error('file too large')) })
  await pipeline(body, fs.createWriteStream(tmp))
  fs.renameSync(tmp, file)
  return { bytes, type: res.headers.get('content-type') || '' }
}

// The release binaries for macOS and Windows expect a libpq library that is
// not part of the download (macOS: Homebrew's, Windows: LIBPQ.dll). The same
// library ships with the embedded Postgres, so PostgREST is pointed at it.
export function postgrestEnv(pgb) {
  const env = { ...process.env }
  if (IS_MAC) env.DYLD_FALLBACK_LIBRARY_PATH = [pgb.libDir, '/usr/local/lib', '/usr/lib'].join(':')
  return env
}

function copyWindowsDlls(pgb) {
  if (!IS_WIN) return
  for (const f of fs.readdirSync(pgb.binDir)) {
    // libpq.dll and what it loads: libssl/libcrypto/libintl/libiconv/libwinpthread/zlib.
    if (/^(lib.*|zlib1)\.dll$/i.test(f) && !fs.existsSync(path.join(P.bin, f))) {
      fs.copyFileSync(path.join(pgb.binDir, f), path.join(P.bin, f))
    }
  }
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isFile() && e.name.toLowerCase() === name) return f
    if (e.isDirectory()) { const x = findFile(f, name); if (x) return x }
  }
  return null
}

async function postgrestVersion(pgb) {
  const out = path.join(P.logs, 'postgrest-version.log')
  fs.rmSync(out, { force: true })
  const r = await exec(postgrestPath(), ['--version'], { logFile: out, env: postgrestEnv(pgb), timeoutMs: 30000 })
  const text = tail(out, 5)
  return { ok: r.code === 0 && text.includes(PGRST_VERSION), text }
}

export async function ensurePostgrest(pgb) {
  fs.mkdirSync(P.bin, { recursive: true })
  const exe = postgrestPath()
  if (fs.existsSync(exe)) {
    copyWindowsDlls(pgb)
    if ((await postgrestVersion(pgb)).ok) return false
    fs.rmSync(exe, { force: true }) // broken or wrong version: fetch again
  }
  const asset = PGRST_ASSETS[`${process.platform}-${process.arch}`]
  if (!asset) throw new UserError(`This computer type (${process.platform}/${process.arch}) is not supported. Use a Mac or a 64-bit Windows laptop.`)
  const url = `https://github.com/PostgREST/postgrest/releases/download/v${PGRST_VERSION}/postgrest-v${PGRST_VERSION}-${asset}`
  const archive = path.join(P.bin, asset)
  console.log(`  Downloading the API program (PostgREST ${PGRST_VERSION})...`)
  try {
    await downloadFile(url, archive)
  } catch (e) {
    throw new UserError(`Could not download PostgREST (${e.message}).\nCheck the internet connection and run Prepare Event again.\n  ${url}`)
  }
  // tar is built into macOS and Windows 10+, and on Windows it also opens .zip files.
  const tmp = path.join(P.bin, 'extract-tmp')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const tar = IS_WIN && fs.existsSync(winTar) ? winTar : 'tar'
  const r = await exec(tar, ['-xf', archive, '-C', tmp])
  const found = r.code === 0 ? findFile(tmp, 'postgrest' + EXE) : null
  if (!found) throw new UserError(`Could not unpack ${archive} (see data/logs/commands.log).`)
  fs.renameSync(found, exe)
  fs.chmodSync(exe, 0o755)
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(archive, { force: true })
  copyWindowsDlls(pgb)
  const v = await postgrestVersion(pgb)
  if (!v.ok) {
    throw new UserError(`PostgREST was downloaded but does not run on this laptop:\n${v.text || '(no output)'}\n` +
      (IS_WIN ? 'If it mentions VCRUNTIME140.dll, install "Visual C++ Redistributable (x64)" from Microsoft.' : ''))
  }
  return true
}

export function writePostgrestConf(local, apiPort) {
  fs.writeFileSync(P.postgrestConf, [
    `db-uri = "postgres://authenticator:${local.apiPassword}@127.0.0.1:${local.pgPort}/${DB_NAME}"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'db-extra-search-path = "public, extensions"',
    `jwt-secret = "${local.jwtSecret}"`,
    'server-host = "127.0.0.1"',
    `server-port = ${apiPort}`,
    'db-pool = 20',
    'log-level = "error"',
    '',
  ].join('\n'), { mode: 0o600 })
}

// Starts PostgREST and resolves once it answers. onExit fires if it stops later.
export async function startPostgrest(pgb, local, apiPort, onExit) {
  writePostgrestConf(local, apiPort)
  const logStream = fs.createWriteStream(path.join(P.logs, 'postgrest.log'), { flags: 'a' })
  const child = spawn(postgrestPath(), [P.postgrestConf], { env: postgrestEnv(pgb), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.pipe(logStream, { end: false })
  child.stderr.pipe(logStream, { end: false })
  let exited = false
  child.on('error', (e) => logLine('server', `postgrest spawn error: ${e.message}`))
  child.on('exit', (code, sig) => { exited = true; logLine('server', `postgrest exited code=${code} signal=${sig}`); onExit?.(code) })
  for (let i = 0; i < 120 && !exited; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return child
    } catch { /* not yet */ }
    await sleep(250)
  }
  try { child.kill() } catch { /* gone */ }
  throw new Error(`The API program (PostgREST) did not start.\n${tail(path.join(P.logs, 'postgrest.log'))}`)
}

function processName(pid) {
  try {
    if (IS_WIN) {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true })
      return (r.stdout.match(/^"([^"]+)"/m) || [])[1] || ''
    }
    if (process.platform === 'linux') return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    return spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).stdout.trim()
  } catch {
    return ''
  }
}

// A PostgREST left running by a crashed or force-closed server window would
// keep reconnecting to the database. Stop it - but only if that process id
// really is a PostgREST (ids get reused after a restart).
export function killStalePostgrest(pid) {
  if (!pid || pid === process.pid || !pidAlive(pid)) return false
  if (!/postgrest/i.test(processName(pid))) return false
  try { process.kill(pid); return true } catch { return false }
}

export function stopChild(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve()
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } resolve() }, timeoutMs)
    child.once('exit', () => { clearTimeout(t); resolve() })
    try { child.kill() } catch { clearTimeout(t); resolve() }
  })
}

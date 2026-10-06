// The Print Hub (repo/printhub) talks to the local server through its
// "servers.local" entry. These helpers keep that entry pointing here.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { P, UserError, loadConfig, loadLocal, hasCloudApi, serverRunning } from './common.mjs'

// Writes servers.local = { url, anonKey } into printhub/config.json and keeps
// everything else. Only creates the file when asked to (create: true).
export function updatePrinthubConfig(local, port, { create = false, cloudAnonKey = null } = {}) {
  const file = path.join(P.printhub, 'config.json')
  let created = false
  if (!fs.existsSync(file)) {
    const example = path.join(P.printhub, 'config.example.json')
    if (!create || !fs.existsSync(example)) return { status: 'missing', file }
    fs.copyFileSync(example, file)
    created = true
  }
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { return { status: 'unreadable', error: e.message, file } }
  cfg.servers = cfg.servers || {}
  if (created && cloudAnonKey && cfg.servers.cloud && /PASTE_/.test(String(cfg.servers.cloud.anonKey || ''))) {
    cfg.servers.cloud.anonKey = cloudAnonKey // same key the local server's config.json already holds
  }
  // The Print Hub normally runs on this same laptop: 127.0.0.1 works even if the Wi-Fi address changes.
  const url = `http://127.0.0.1:${port}`
  const before = JSON.stringify(cfg.servers.local || {})
  cfg.servers.local = { ...(cfg.servers.local || {}), url, anonKey: local.anonKey }
  const changed = before !== JSON.stringify(cfg.servers.local)
  if (changed || created) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
  return { status: created ? 'created' : changed ? 'updated' : 'same', file }
}

// "Start Print Hub (Local)": settings checked, then the normal Print Hub with --server local.
export async function printhubCommand(args) {
  const local = loadLocal()
  if (!local) throw new UserError('This laptop has not been prepared yet. Run "Prepare Event" first.')
  const cfg = loadConfig()
  const hub = path.join(P.printhub, 'printhub.mjs')
  if (!fs.existsSync(hub)) throw new UserError(`The Print Hub was not found at ${hub}.`)
  const r = updatePrinthubConfig(local, cfg.port, { create: true, cloudAnonKey: hasCloudApi(cfg) ? cfg.cloud.anonKey : null })
  if (r.status === 'unreadable') throw new UserError(`printhub/config.json could not be read (${r.error}). Fix or delete it, then try again.`)
  if (!(await serverRunning(cfg))) {
    console.log('Note: the Local Server is not running yet. Start it too ("Start Local Server");')
    console.log('the Print Hub keeps retrying until it answers.\n')
  }
  const child = spawn(process.execPath, [hub, '--server', 'local', ...args], { cwd: P.printhub, stdio: 'inherit' })
  // Ctrl+C reaches the Print Hub too; it stops by itself and we pass on its exit code.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, () => {}) } catch { /* not on this OS */ } }
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

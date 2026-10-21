// The Control Desk in its own browser window that prints KOTs by itself.
//
// With Auto-print ON the desk prints the KOT the moment a waiter is assigned.
// A normal browser shows its print dialog for every slip. Chrome (or Edge)
// started with --kiosk-printing sends the slip straight to this computer's
// DEFAULT printer instead. The flag only counts when that browser starts, so
// the desk gets a browser profile of its own (its own window and sign-in):
// the normal Chrome, open or not, is never touched.
//
//   node ss-local.mjs desk           the laptop's desk if the Local Server runs here, else the cloud desk
//   node ss-local.mjs desk --cloud   the cloud desk (normal days, internet fine)
//   node ss-local.mjs desk --local   the laptop's desk (the Local Server must be running)
//
// "Start Local Server" opens the laptop's desk by itself, once per launcher
// window ("openDesk": false in config.json switches that off).
// SS_DESK_BROWSER (or "deskBrowser" in config.json) points at another browser.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { IS_MAC, IS_WIN, LAUNCHER, UserError, loadConfig, serverRunning, logLine } from './common.mjs'

export const CLOUD_APP = 'https://smart-serve-app.vercel.app'

const FLAGS = [
  '--kiosk-printing',                            // no print dialog: straight to the default printer
  '--disable-popup-blocking',                    // the KOT opens in a small window, then prints
  '--autoplay-policy=no-user-gesture-required',  // the new-order sound
  '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble',
  '--start-maximized',
]

// Outside the kit folder: a new kit download keeps the desk's sign-in, and
// Documents or Desktop may be synced to iCloud or OneDrive.
export function deskProfileDir() {
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SmartServe', 'Desk Browser')
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'SmartServe', 'Desk Browser')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'smartserve-desk-browser')
}

export function findDeskBrowser(cfg) {
  const want = process.env.SS_DESK_BROWSER || cfg?.deskBrowser
  if (want) return fs.existsSync(want) ? { name: path.basename(want).replace(/\.(app|exe)$/i, ''), path: want } : null
  const home = os.homedir()
  let list
  if (IS_MAC) {
    list = [['Google Chrome', '/Applications/Google Chrome.app'], ['Google Chrome', `${home}/Applications/Google Chrome.app`],
      ['Microsoft Edge', '/Applications/Microsoft Edge.app'], ['Microsoft Edge', `${home}/Applications/Microsoft Edge.app`]]
  } else if (IS_WIN) {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
    list = [...roots.map((r) => ['Google Chrome', path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
      ...roots.map((r) => ['Microsoft Edge', path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])]
  } else {
    list = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
      .map((p) => [path.basename(p), p])
  }
  for (const [name, p] of list) if (fs.existsSync(p)) return { name, path: p }
  return null
}

/** Is the desk's own browser open already? (Its profile is locked while it runs.) */
export function deskBrowserOpen(dir = deskProfileDir()) {
  try {
    if (IS_WIN) {
      const f = path.join(dir, 'lockfile')
      if (!fs.existsSync(f)) return false
      try { fs.unlinkSync(f); return false } catch (e) { return e.code === 'EBUSY' || e.code === 'EPERM' }
    }
    const target = fs.readlinkSync(path.join(dir, 'SingletonLock')) // "computer-name-12345"
    const pid = Number((/-(\d+)$/.exec(target) || [])[1])
    if (!pid) return false
    try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
  } catch {
    return false
  }
}

/** Open url in the desk's browser. { ok, browser, url } or { ok: false, reason }. */
export function openDesk(url, cfg) {
  const b = findDeskBrowser(cfg)
  if (!b) {
    return { ok: false, reason: `Google Chrome is not on this laptop (nor Microsoft Edge). Install Chrome from google.com/chrome, then double-click "${LAUNCHER.desk}".` }
  }
  const dir = deskProfileDir()
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* the browser makes it */ }
  const args = [`--user-data-dir=${dir}`, ...FLAGS, `--app=${url}`]
  // Mac: "open -n" starts the browser with these flags even while the normal Chrome is open.
  const [cmd, argv] = IS_MAC && /\.app\/?$/.test(b.path) ? ['open', ['-n', '-a', b.path, '--args', ...args]] : [b.path, args]
  try {
    const child = spawn(cmd, argv, { detached: true, stdio: 'ignore' })
    child.on('error', (e) => logLine('desk', `${b.name} did not start: ${e.message}`))
    child.unref()
  } catch (e) {
    return { ok: false, reason: `${b.name} could not be started: ${e.message}` }
  }
  logLine('desk', `opened ${url} in ${b.name}`)
  return { ok: true, browser: b.name, url }
}

const PRINTER_HELP = [
  'KOTs print by themselves on this computer\'s DEFAULT printer as soon as a waiter',
  'is assigned (desk: Auto-print ON) - no print dialog. Before the first order:',
  IS_WIN
    ? '  Settings > Bluetooth & devices > Printers & scanners > untick "Let Windows manage\n  my default printer" > click the KOT printer > Set as default.'
    : '  System Settings > Printers & Scanners > "Default printer": choose the KOT printer\n  (not "Last Printer Used").',
  'Keep the desk in THIS window: in any other browser window the print dialog comes back.',
]

export async function deskCommand({ cloud = false, local = false } = {}) {
  const cfg = loadConfig({ quiet: true })
  const running = cloud ? null : await serverRunning(cfg)
  if (local && !running) throw new UserError(`The Local Server is not running on this laptop. Double-click "${LAUNCHER.start}" first.`)
  const app = String(cfg.appUrl || CLOUD_APP).replace(/\/+$/, '')
  const url = running ? `http://localhost:${running.port || cfg.port}/supervisor` : `${app}/supervisor`
  const r = openDesk(url, cfg)
  if (!r.ok) throw new UserError(r.reason)
  console.log(`\nControl Desk opened in its own ${r.browser} window:`)
  console.log(`  ${url}   ${running ? '(the Local Server on this laptop)' : '(the cloud)'}`)
  console.log('')
  for (const l of PRINTER_HELP) console.log(l)
  console.log('First time in this window: sign in to the desk once; it is remembered.\n')
}

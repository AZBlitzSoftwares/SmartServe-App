#!/usr/bin/env node
// Janu's Smart Serve - offline standby ("Local Server"). See README.md.
//
//   node ss-local.mjs prepare [--force]            download the event (office, with internet)
//   node ss-local.mjs prepare --refresh            re-download the data only (venue, before switching)
//   node ss-local.mjs start [--kot-jump N]         run the event from this laptop (default jump 100, 0 = off)
//   node ss-local.mjs upload [--all]               send what the laptop recorded to the cloud
//   node ss-local.mjs status                       what is prepared, is the server running
//   node ss-local.mjs printhub [options]           Print Hub against the local server
//
// Testing before anything goes to the cloud (TEST MODE - never writes to the cloud):
//   node ss-local.mjs prepare --dev [--force]      cloud structure (read only) + ../db/*.sql on the laptop
//   node ss-local.mjs prepare --dev --standin      no cloud at all: dev/standin-schema.sql + ../db/*.sql
//   node ss-local.mjs demo [--remove]              four demo events dated today (guest, captain, multi-kitchen, Maestro)
//
// Exit codes (used by the launchers): 0 done/stopped, 2 something to fix by
// the operator (do not restart), anything else an unexpected stop.

const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  console.error(`\nThis needs Node.js 20 or newer (this laptop has ${process.version}).\nInstall the LTS version from https://nodejs.org, then try again.\n`)
  process.exit(2)
}

const { UserError, logLine } = await import('./lib/common.mjs')

const [cmd, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((a) => a.startsWith('--')))
function only(allowed) {
  for (const f of flags) {
    if (!allowed.includes(f.split('=')[0])) throw new UserError(`Unknown option ${f} for "${cmd}". Options: ${allowed.join(' ') || '(none)'}`)
  }
}
function numberFlag(name, def) {
  const i = rest.findIndex((a) => a === name || a.startsWith(name + '='))
  if (i < 0) return def
  const v = rest[i].includes('=') ? rest[i].split('=')[1] : rest[i + 1]
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw new UserError(`${name} needs a whole number, e.g. ${name} 100`)
  return n
}

const USAGE = 'Use: node ss-local.mjs prepare [--refresh] | prepare --dev [--standin] | demo [--remove] | start [--kot-jump N] | upload | status | printhub'

try {
  let code = 0
  switch (cmd) {
    case 'prepare': {
      only(['--refresh', '--force', '--dev', '--standin'])
      const { prepareCommand } = await import('./lib/prepare.mjs')
      await prepareCommand({ refresh: flags.has('--refresh'), force: flags.has('--force'), dev: flags.has('--dev'), standin: flags.has('--standin') })
      break
    }
    case 'demo': {
      only(['--remove'])
      const { demoCommand } = await import('./lib/demo.mjs')
      await demoCommand({ remove: flags.has('--remove') })
      break
    }
    case 'start': {
      only(['--kot-jump'])
      const { startCommand } = await import('./lib/server.mjs')
      await startCommand({ kotJump: numberFlag('--kot-jump', null) })
      break
    }
    case 'upload': {
      only(['--background', '--all'])
      const { uploadCommand } = await import('./lib/status.mjs')
      code = await uploadCommand({ background: flags.has('--background'), all: flags.has('--all') })
      break
    }
    case 'status': {
      only([])
      const { statusCommand } = await import('./lib/status.mjs')
      await statusCommand()
      break
    }
    case 'printhub': {
      const { printhubCommand } = await import('./lib/printhub.mjs')
      code = await printhubCommand(rest)
      break
    }
    default:
      throw new UserError(cmd ? `Unknown command "${cmd}".\n${USAGE}` : USAGE)
  }
  process.exit(code)
} catch (e) {
  if (e instanceof UserError) {
    console.error(`\n${e.message}\n`)
    process.exit(e.exitCode)
  }
  logLine('error', `${cmd}: ${e?.stack || e}`)
  console.error(`\nSomething went wrong: ${e?.message || e}\n(details in localmode/data/logs)\n`)
  process.exit(1)
}

// Reading the cloud through its REST API with the anon key - the same key and
// the same API the app itself uses. "Prepare Event" works this way when
// config.json has no database connection string (the Offline Kit), so no
// database password ever has to be on an event laptop.
import { UserError } from './common.mjs'

const PAGE = 1000 // the cloud answers at most 1000 rows per request
const CHUNK = 80 // ids per "in.(...)" filter, keeps the address short

export class CloudReader {
  constructor(cloud) {
    this.base = String(cloud.url || '').replace(/\/+$/, '') + '/rest/v1/'
    this.key = cloud.anonKey
  }

  async get(pathq, timeoutMs = 60000) {
    let res
    try {
      res = await fetch(this.base + pathq, {
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const why = e.name === 'TimeoutError' ? 'no answer in time' : (e.cause?.code || e.message)
      throw new UserError(`Could not reach the cloud (${why}). Is there internet?\n` +
        'Some hotel and office networks block it - try a phone hotspot.')
    }
    const text = await res.text()
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${text.slice(0, 300)}`)
      err.status = res.status
      try { err.body = JSON.parse(text) } catch { /* not JSON */ }
      throw err
    }
    return JSON.parse(text || 'null')
  }

  // Every row of a table that matches the filter, a page at a time. Paged by
  // id (after the last one seen), so rows added or removed in the cloud while
  // reading never shift a page; only an empty page ends the read (the cloud
  // may be set to send fewer than 1000 rows at a time).
  async all(table, filter = '') {
    const rows = []
    const seen = new Set()
    let last = null
    for (;;) {
      let page
      try {
        page = await this.get(`${table}?select=*${filter ? '&' + filter : ''}${last != null ? `&id=gt.${last}` : ''}&order=id.asc&limit=${PAGE}`)
      } catch (e) {
        // A table without an id column (one row per event, e.g. print_stations): read it in one go.
        if (last == null && e.status === 400 && e.body?.code === '42703' && /\bid\b/.test(e.body?.message || '')) {
          return await this.get(`${table}?select=*${filter ? '&' + filter : ''}&limit=${PAGE}`)
        }
        throw e
      }
      if (!page.length) return rows
      for (const r of page) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r) }
      const next = page[page.length - 1].id
      if (next == null || next === last) return rows
      last = next
    }
  }

  // Rows whose column holds one of many values (a few dozen per request).
  async allIn(table, col, values) {
    const v = [...new Set(values.filter((x) => x != null))]
    const out = []
    for (let i = 0; i < v.length; i += CHUNK) out.push(...await this.all(table, `${col}=in.(${v.slice(i, i + CHUNK).join(',')})`))
    return out
  }

  // One row of the table from any event: shows which columns the cloud has.
  // A table the cloud does not have, or will not show: nothing to learn here.
  async sample(table) {
    try { return await this.get(`${table}?select=*&limit=1`, 20000) } catch (e) { if (e instanceof UserError) throw e; return null }
  }

  // Events dated from..to, as the event chooser lists them.
  async upcomingEvents(from, to) {
    return (await this.events(`date=gte.${from}&date=lte.${to}`)).map(eventRow)
  }

  async eventsById(ids) {
    if (!ids.length) return []
    return (await this.events(`id=in.(${ids.join(',')})`)).map(eventRow)
  }

  // The first thing every prepare reads: a refused key is said plainly here.
  async events(filter) {
    try {
      return await this.get(`events?select=*&${filter}&order=date.asc,name.asc`)
    } catch (e) {
      if (refused(e)) {
        throw new UserError('The cloud refused the key in config.json ("anonKey").\n' +
          'Download the offline kit again (Control tab > Offline kit) and use its config.json.')
      }
      throw e
    }
  }
}

const eventRow = (e) => ({
  id: e.id, name: e.name, date: e.date, service_mode: e.service_mode ?? null,
  multi_kitchen: !!e.multi_kitchen, maestro: !!e.maestro,
})

// The cloud's answer when a table does not exist there / may not be read with the app's key.
export const missingTable = (e) => e?.status === 404 || ['42P01', 'PGRST205'].includes(e?.body?.code)
export const refused = (e) => e?.status === 401 || e?.status === 403 || e?.body?.code === '42501'

// A Postgres type for a column the laptop does not have yet, from the values the cloud sent.
export function inferType(values) {
  const seen = new Set()
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (typeof v === 'boolean') seen.add('boolean')
    else if (typeof v === 'number') seen.add('numeric') // whole numbers today may have decimals tomorrow
    else if (typeof v === 'object') seen.add('jsonb')
    else {
      const s = String(v)
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:?\d{2})?|Z)$/.test(s)) seen.add('timestamptz')
      else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) seen.add('timestamp')
      else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) seen.add('date')
      else seen.add('text')
    }
  }
  if (!seen.size) return 'text'
  if (seen.size === 1) return [...seen][0]
  if ([...seen].every((t) => t === 'timestamptz' || t === 'timestamp')) return 'timestamptz'
  return seen.has('jsonb') ? 'jsonb' : 'text'
}

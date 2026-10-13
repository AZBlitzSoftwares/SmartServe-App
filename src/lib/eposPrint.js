/* A test slip sent straight from this browser to an Epson printer, with Epson's own web
   printing (ePOS-Print: an HTTP request to the printer's /cgi-bin/epos/service.cgi), no Print
   Hub. Used by "Test print from this browser" in Kitchens & printers to find out whether a
   venue's printers and laptops can print without the Print Hub.

   What the browser needs: Chrome 142 or newer lets a secure site (https) reach a printer's
   plain address after the user allows "devices on your local network"; an older Chrome blocks
   it as mixed content. The secure way (https to the printer) needs the printer's own
   certificate accepted once in that browser (open https://<printer> and Proceed). */

const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

// "192.168.0.201" or "192.168.0.201:8080"
export const EPOS_HOST = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/

export function eposTestXml(lines) {
  const body = lines.map(l => esc(l) + '&#10;').join('')
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' +
    '<text lang="en" smooth="true"/><text align="center"/>' +
    '<text dw="true" dh="true">SMART SERVE&#10;</text>' +
    '<text dw="false" dh="false">' + body + '</text>' +
    '<feed line="3"/><cut type="feed"/>' +
    '</epos-print></s:Body></s:Envelope>'
}

// What the printer's answer means, in plain words
const CODES = {
  EPTR_REC_EMPTY: 'the printer is out of paper',
  EPTR_COVER_OPEN: 'the printer cover is open',
  EX_TIMEOUT: 'the printer did not finish in time',
  DeviceNotFound: 'the printer did not accept the job (device "local_printer" not found)',
  EPTR_AUTOMATICAL: 'the printer has a cutter or mechanism error',
  EPTR_UNRECOVERABLE: 'the printer has an error and needs to be switched off and on',
  SchemaError: 'the printer did not understand the test slip',
}

// ePOS status bits (ASB_*) that matter for a kitchen printer
const ASB_OFF_LINE = 0x00000008
const ASB_COVER_OPEN = 0x00000020
const ASB_RECEIPT_NEAR_END = 0x00020000
const ASB_RECEIPT_END = 0x00080000

/** Raw ESC/POS bytes (the Print Hub's own KOT layout) as one ePOS-Print document. */
export function eposCommandXml(bytes) {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' +
    '<command>' + hex + '</command>' +
    '</epos-print></s:Body></s:Envelope>'
}

/** The same KOT as ePOS text lines (alignment, bold, double size kept): used when a printer
    does not take raw ESC/POS in <command>. lines = decodeEscPos(bytes).lines */
export function eposLinesXml(lines) {
  const body = lines.map(l => {
    const big = (l.w || 1) > 1 || (l.h || 1) > 1
    return `<text align="${l.align === 'center' ? 'center' : l.align === 'right' ? 'right' : 'left'}" em="${l.bold ? 'true' : 'false'}"` +
      ` reverse="${l.reverse ? 'true' : 'false'}" dw="${(l.w || 1) > 1 && big ? 'true' : 'false'}" dh="${(l.h || 1) > 1 && big ? 'true' : 'false'}">` +
      esc(l.text || '') + '&#10;</text>'
  }).join('')
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">' +
    '<text lang="en" smooth="true"/>' + body + '<feed line="3"/><cut type="feed"/>' +
    '</epos-print></s:Body></s:Envelope>'
}

/** "http://192.168.0.201" for a printer on the usual port 9100 (its web printing is on port 80),
    "http://host:port" for anything else (a test printer). */
export function eposBase(host, port, secure = false) {
  const p = Number(port) || 9100
  return `${secure ? 'https' : 'http'}://${host}${p === 9100 || p === 80 ? '' : ':' + p}`
}

/**
 * Send one ePOS-Print document. Returns
 *   { ok: true, status: 'online' | 'paper_low' }
 *   { ok: false, kind: 'printer', status: 'paper_out' | 'offline', error }  the printer said no
 *   { ok: false, kind: 'blocked' | 'timeout' | 'notepos', status: 'offline', error }
 */
export async function eposSend(base, xml, { timeoutMs = 15000 } = {}) {
  const url = `${base}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`
  const where = base.replace(/^https?:\/\//, '')
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      // the same request Epson's own JavaScript SDK sends
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT', SOAPAction: '""' },
      body: xml,
      signal: AbortSignal.timeout(timeoutMs),
      // no targetAddressSpace: an IP address is already known to be on the local network, and a
      // value that does not match the printer's address space makes Chrome refuse the request
    })
  } catch (e) {
    if (e?.name === 'TimeoutError') return { ok: false, kind: 'timeout', status: 'offline', error: `Printer ${where} did not answer in ${Math.round(timeoutMs / 1000)} s` }
    return { ok: false, kind: 'blocked', status: 'offline', error: `Printer ${where} not reachable from this browser (${e?.message || e})` }
  }
  let text = ''
  try { text = await res.text() } catch { /* no body */ }
  const m = text.match(/<response\b[^>]*>/)
  if (!m) return { ok: false, kind: 'notepos', status: 'offline', error: `Printer ${where} answered ${res.status} but not as Epson web printing (ePOS-Print off?)` }
  const attr = k => (m[0].match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || ''
  const bits = Number(attr('status')) || 0
  if (attr('success') === 'true') return { ok: true, status: bits & ASB_RECEIPT_NEAR_END ? 'paper_low' : 'online' }
  const code = attr('code')
  const paperOut = code === 'EPTR_REC_EMPTY' || (bits & ASB_RECEIPT_END) !== 0
  const why = CODES[code] || (bits & ASB_COVER_OPEN ? CODES.EPTR_COVER_OPEN : bits & ASB_OFF_LINE ? 'the printer is offline' : code || 'unknown reason')
  return { ok: false, kind: 'printer', status: paperOut ? 'paper_out' : 'offline', code, error: `Printer ${where}: ${why}` }
}

/**
 * Send a test slip. Returns { ok, kind, text }:
 *   ok true            printed
 *   kind 'printer'     the printer answered but did not print (paper, cover ...)
 *   kind 'blocked'     the browser did not let the request out, or nothing answered
 *   kind 'timeout'     no answer in time (wrong address, not on this network)
 *   kind 'notepos'     something answered but it is not Epson web printing
 */
export async function eposTestPrint(host, { secure = false, timeoutMs = 15000, lines } = {}) {
  const h = String(host || '').trim()
  if (!EPOS_HOST.test(h)) return { ok: false, kind: 'input', text: 'Type the printer address, for example 192.168.0.201' }
  const [ip, port] = h.split(':')
  const r = await eposSend(eposBase(ip, port || 9100, secure),
    eposTestXml(lines || ['Test print from this browser', 'No Print Hub used', new Date().toLocaleString()]), { timeoutMs })
  if (r.ok) return { ok: true, kind: 'printed', text: 'Printed.' }
  if (r.kind === 'printer') return { ok: false, kind: 'printer', text: 'The printer answered but did not print: ' + r.error.replace(/^Printer [^:]+: /, '') + '.' }
  return { ok: false, kind: r.kind, text: r.kind === 'timeout' ? `No answer from ${h} in ${Math.round(timeoutMs / 1000)} s.` : r.error }
}

/* ---- Finding Epson printers from this browser (no Print Hub) ------------------------------
   Every address of a network (192.168.1.1 … 254) is asked, a few dozen at a time, with an empty
   ePOS-Print document: it prints nothing, and only an Epson printer with web printing answers it
   (anything else times out or is refused). Needs the same Chrome "devices on your local network"
   permission as printing from this laptop. */
const EMPTY_EPOS = '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
  '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"></epos-print></s:Body></s:Envelope>'

/** { ip, status } when an Epson printer with web printing answers at ip, else null. */
export async function eposProbe(ip, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=1000`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT', SOAPAction: '""' },
      body: EMPTY_EPOS,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    const m = text.match(/<response\b[^>]*>/)
    if (!m) return null
    const bits = Number((m[0].match(/\bstatus="(\d+)"/) || [])[1]) || 0
    return { ip, status: bits & ASB_RECEIPT_END ? 'paper_out' : bits & ASB_RECEIPT_NEAR_END ? 'paper_low' : 'online' }
  } catch {
    return null
  }
}

/** The networks to search: those of the printers already known, else the usual home/venue ones. */
export function subnetsToSearch(knownIps = []) {
  const known = [...new Set(knownIps.map(ip => String(ip || '').trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/)).filter(Boolean).map(m => m[1]))]
    .filter(p => !p.startsWith('127.'))
  return known.length ? { nets: known, known: true }
    : { nets: ['192.168.1', '192.168.0', '192.168.29', '192.168.31', '192.168.68', '192.168.2', '10.0.0'], known: false }
}

/** Ask every address of the given networks; onFound({ip, status}) for each printer; resolves with all found. */
export async function eposScan(prefixes, { onFound = () => {}, onProgress = () => {}, concurrency = 48, timeoutMs = 2500, stopAfterFirstNet = true } = {}) {
  const found = []
  for (const p of prefixes) {
    const ips = Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`)
    let next = 0
    onProgress(p)
    const worker = async () => {
      while (next < ips.length) {
        const ip = ips[next++]
        const r = await eposProbe(ip, timeoutMs)
        if (r) { found.push(r); onFound(r) }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    // the usual networks are tried one after another until one has printers
    if (found.length && stopAfterFirstNet) break
  }
  return found
}

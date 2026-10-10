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
  const url = `${secure ? 'https' : 'http'}://${h}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`
  const xml = eposTestXml(lines || ['Test print from this browser', 'No Print Hub used', new Date().toLocaleString()])
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
    if (e?.name === 'TimeoutError') return { ok: false, kind: 'timeout', text: 'No answer from ' + h + ' in ' + Math.round(timeoutMs / 1000) + ' s.' }
    return { ok: false, kind: 'blocked', text: (e?.message || String(e)) }
  }
  let text = ''
  try { text = await res.text() } catch { /* no body */ }
  const m = text.match(/<response\b[^>]*>/)
  if (!m) return { ok: false, kind: 'notepos', text: `The printer answered ${res.status} but not as Epson web printing (ePOS-Print may be switched off).` }
  const attr = k => (m[0].match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || ''
  if (attr('success') === 'true') return { ok: true, kind: 'printed', text: 'Printed.' }
  const code = attr('code')
  return { ok: false, kind: 'printer', text: 'The printer answered but did not print: ' + (CODES[code] || code || 'unknown reason') + '.' }
}

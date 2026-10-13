/* Epson Server Direct Print, the server side (used by api/sdp.js on the cloud).

   The kitchen printer itself asks the server for work every few seconds, so no Print Hub,
   laptop or browser has to run at the event:

     printer  POST ConnectionType=GetRequest&ID=<Printer ID>
     server   200 text/xml  <PrintRequestInfo Version="2.00"> one <ePOSPrint> per KOT </...>
              (or 200 with an empty body when there is nothing to print)
     printer  POST ConnectionType=SetResponse&ID=<Printer ID>&ResponseFile=<PrintResponseInfo …>
     server   200, empty

   Each KOT is the Print Hub's own layout (escpos.mjs), sent as raw ESC/POS inside ePOS-Print's
   <command> element. The print job id is the KOT's id written in base 36 (25 characters, the
   limit is 30), so the result maps straight back to the KOT. */

export const EPOS_NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

// 9b2c6f1e-...-...  <->  25 characters of 0-9a-z
export function jobIdOf(uuid) {
  const hex = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return BigInt('0x' + hex).toString(36).padStart(25, '0');
}
export function uuidOfJob(job) {
  const s = String(job || '').toLowerCase();
  if (!/^[0-9a-z]{1,25}$/.test(s)) return null;
  let n = 0n;
  for (const ch of s) n = n * 36n + BigInt(parseInt(ch, 36));
  const hex = n.toString(16).padStart(32, '0');
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hexOf(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return hex;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** The answer to a GetRequest: one <ePOSPrint> per job ({ jobId, bytes }); '' when none. */
export function printRequestXml(jobs, { timeoutMs = 30000 } = {}) {
  if (!jobs.length) return '';
  const parts = jobs.map(
    (j) =>
      '<ePOSPrint><Parameter><devid>local_printer</devid>' +
      `<timeout>${timeoutMs}</timeout><printjobid>${esc(j.jobId)}</printjobid></Parameter>` +
      `<PrintData><epos-print xmlns="${EPOS_NS}"><command>${hexOf(j.bytes)}</command></epos-print></PrintData></ePOSPrint>`
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n<PrintRequestInfo Version="2.00">${parts.join('')}</PrintRequestInfo>`;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : '';
};

/**
 * The printer's report (ResponseFile) as [{ jobId, ok, code, status }].
 * Version 2.00 gives one <ePOSPrint> per job with its printjobid; an older answer without job
 * ids gives the results in order (jobId null).
 */
export function parseResponseFile(xml) {
  const text = String(xml || '');
  const out = [];
  const blocks = text.match(/<ePOSPrint\b[\s\S]*?<\/ePOSPrint>/gi);
  const one = (chunk) => {
    const id = (chunk.match(/<printjobid>\s*([^<\s]+)\s*<\/printjobid>/i) || [])[1] || null;
    const tag = (chunk.match(/<response\b[^>]*>/i) || [])[0] || '';
    if (!tag) return;
    out.push({ jobId: id, ok: /^true$/i.test(attr(tag, 'success')), code: attr(tag, 'code'), status: attr(tag, 'status') });
  };
  if (blocks) blocks.forEach(one);
  else (text.match(/<response\b[^>]*>/gi) || []).forEach((t) => one(t));
  return out;
}

// What the printer's error code means, in plain words (shown on the desk as the reason)
const CODES = {
  EPTR_REC_EMPTY: 'printer out of paper',
  EPTR_COVER_OPEN: 'printer cover open',
  EX_TIMEOUT: 'printer did not finish in time',
  DeviceNotFound: 'printer device "local_printer" not found',
  EPTR_AUTOMATICAL: 'printer cutter or mechanism error',
  EPTR_UNRECOVERABLE: 'printer error: switch it off and on',
  SchemaError: 'SchemaError: the printer did not take the KOT format',
  PrintSystemError: 'printer system error',
};
export function reasonOf(code) {
  return CODES[code] || (code ? `printer error ${code}` : 'print failed');
}

/** The form fields of the printer's request, from a parsed body or a raw string. */
export function formOf(body, query = {}) {
  let f = {};
  if (typeof body === 'string') f = Object.fromEntries(new URLSearchParams(body));
  else if (body && typeof body === 'object' && !Buffer.isBuffer?.(body)) f = { ...body };
  else if (body) f = Object.fromEntries(new URLSearchParams(String(body)));
  return { ...query, ...f };
}

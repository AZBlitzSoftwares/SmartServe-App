/* global process */
/* Cloud printing for the kitchen printers (Epson Server Direct Print), on Vercel.

   Each Epson printer is set (once, in its own settings page) to ask this address every few
   seconds:  https://<this app>/api/sdp   with its Printer ID. The KOTs of the kitchens that
   use that Printer ID (Event set-up › Kitchens & printers › Cloud printing) are sent back and
   printed; the printer then reports each result, which goes to the KOT like a Print Hub's.
   Nothing has to run at the venue except the printers and their internet.

   Open the address in a browser to check it: it says whether it can reach the database.
   The Supabase address and public key come from the project settings (the same ones the app
   is built with). KOT times are printed in India time unless KOT_TIMEZONE says otherwise. */
import { buildKot } from '../printhub/escpos.mjs';
import { formOf, jobIdOf, uuidOfJob, parseResponseFile, printRequestXml, reasonOf } from '../printhub/sdp.mjs';

process.env.TZ = process.env.KOT_TIMEZONE || 'Asia/Kolkata';

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

async function rpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const xml = (res, body) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!body) { res.setHeader('Content-Length', '0'); res.end(); return; }
  res.end(body);
};

export default async function handler(req, res) {
  const f = formOf(req.body, req.query || {});
  const type = String(f.ConnectionType || '');
  const id = String(f.ID || f.id || '').trim();

  if (!URL_ || !KEY) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Cloud printing is not set up on the server: the Supabase address or key is missing.');
    return;
  }

  try {
    if (type === 'GetRequest') {
      if (!id) return xml(res, '');
      const rows = await rpc('sdp_claim', { p_id: id, p_limit: 10 });
      const jobs = [];
      for (const job of Array.isArray(rows) ? rows : []) {
        const jobId = jobIdOf(job.id);
        if (!jobId) continue;
        try {
          jobs.push({ jobId, bytes: buildKot(job, { printer: `cloud ${id}`, now: new Date() }) });
        } catch (e) {
          await rpc('hub_report', { p_kot_id: job.id, p_ok: false, p_error: `KOT could not be built: ${e.message}`, p_hub: `cloud:${id}` }).catch(() => {});
        }
      }
      return xml(res, printRequestXml(jobs));
    }

    if (type === 'SetResponse') {
      const results = parseResponseFile(f.ResponseFile);
      for (const r of results) {
        const kot = uuidOfJob(r.jobId);
        if (!kot) continue;
        await rpc('hub_report', { p_kot_id: kot, p_ok: r.ok, p_error: r.ok ? null : reasonOf(r.code), p_hub: `cloud:${id}` });
      }
      return xml(res, '');
    }

    // A browser opening the address: say whether the printers can use it
    const probe = await rpc('sdp_claim', { p_id: '', p_limit: 1 });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(Array.isArray(probe)
      ? 'Smart Serve cloud printing is ready. Set this address and a Printer ID in each Epson printer (Server Direct Print).'
      : 'Smart Serve cloud printing answered, but the database did not.');
  } catch (e) {
    // the printer simply asks again after its interval
    if (type) return xml(res, '');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(/sdp_claim/.test(String(e.message)) && /404|PGRST202/.test(String(e.message))
      ? 'Cloud printing needs the database update 2026-10-13_maestro_v5_cloud_print.sql.'
      : `Cloud printing could not reach the database: ${e.message}`);
  }
}

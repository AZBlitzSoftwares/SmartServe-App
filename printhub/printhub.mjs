// Janu's Smart Serve - Print Hub
//
// Runs on the laptop at the monitoring desk. Every 1.5 s it asks the server
// for new KOTs (one per kitchen per order), prints each on that kitchen's
// network thermal printer, and tells the server whether it worked.
// It also checks every printer every 15 s (online / offline / paper) and
// reports that, so the desk sees printer problems and failed KOTs are sent
// again automatically when a printer comes back.
//
// Start:  node printhub.mjs  [--server local|cloud] [--event <uuid>] [--hub <name>]
// No npm packages: only Node 18+ built-ins.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKot, formatTime, parseStatusByte, STATUS_REQUEST } from './escpos.mjs';
import { findPrinters, readArp, scanHosts } from './discover.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = {
  pollMs: 1500, // how often we ask for new KOTs
  claimLimit: 20, // KOTs per request
  maxInFlight: 40, // never hold more than this many unprinted KOTs at once
  eventsRefreshMs: 60_000, // look for newly created events
  kitchensRefreshMs: 15_000, // pick up printer IP changes made at the desk
  probeMs: 15_000, // printer health check
  heartbeatMs: 60_000, // re-send an unchanged printer status this often
  connectTimeoutMs: 4000,
  jobTimeoutMs: 10_000, // one attempt, connect to close
  preCheckMs: 1000, // wait for the paper answer before each KOT
  statusReplyMs: 1500, // wait for the paper answer in a health check
  retryDelaysMs: [1000, 2000], // two quick retries on the same printer
  // The server gives a KOT stuck in 'printing' to another hub after 45 s.
  // We stop trying before that so two laptops never both print it.
  jobDeadlineMs: 40_000,
  downRetryMs: 10_000, // a printer known to be down gets one try per 10 s, not 3 per KOT
  requestTimeoutMs: 8000,
  backoffMs: [1000, 2000, 5000, 10_000], // when the server cannot be reached
  lateNightHour: 6, // until 6 AM, yesterday's event still counts as "today"
  renderMs: 2000,
  stopWaitMs: 12_000,
  // Printer search (printers that move to a new IP address are followed by their MAC)
  findPrinters: true,
  scanRequestMs: 5000, // how often to look for a "Find printers" press at the desk
  scanEveryMs: 60_000, // while a printer is down, search the network at most this often
  scanTimeoutMs: 400,
  scanPorts: [9100],
  scanTargets: [], // extra "host" or "host:port" to try (e.g. Virtual Printers)
  scanSubnets: true,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const two = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the laptop's own time zone. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function clockTime(d = new Date()) {
  return `${formatTime(d).slice(0, 5)}:${two(d.getSeconds())} ${formatTime(d).slice(6)}`;
}

/**
 * "192.168.1.104" + port 9100, or "192.168.1.20:9101" (port written in the IP
 * field - handy for demos with several fake printers on one laptop).
 * `key` (host:port) is one physical printer: status is checked and reported
 * per key. `text` keeps the value exactly as stored (the old 3-argument
 * hub_printer_status matched on it).
 */
export function parseEndpoint(value, defaultPort = 9100) {
  if (value == null) return null;
  const text = String(value);
  const s = text.trim();
  if (!s) return null;
  const m = s.match(/^([^:\s]+):(\d{1,5})$/);
  const host = m ? m[1] : s;
  const port = m ? Number(m[2]) : Number(defaultPort) || 9100;
  return { text, host, port, key: `${host}:${port}`, label: port === 9100 ? host : `${host}:${port}` };
}

/** Short, human error for the desk and the operator. */
export function printerError(err, ep) {
  const who = `Printer ${ep.label}`;
  switch (err?.code) {
    case 'PAPER_OUT':
      return `${who} is out of paper`;
    case 'JOB_TIMEOUT':
      return `${who} timed out`;
    case 'ECONNRESET':
    case 'EPIPE':
      return `${who} dropped the connection`;
    case 'CONNECT_TIMEOUT':
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'ETIMEDOUT':
    case 'EADDRNOTAVAIL':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `${who} not reachable`;
    default:
      return `${who} error: ${err?.code || err?.message || 'unknown'}`;
  }
}

/**
 * A backup IP has no port column: if it is another kitchen's printer, use
 * that kitchen's port, otherwise 9100.
 */
export function portForIpIn(kitchens, ip) {
  const raw = String(ip ?? '').trim();
  const k = (kitchens || []).find((x) => String(x.printer_ip ?? '').trim() === raw);
  return k?.printer_port || 9100;
}

const withCode = (code, message = code) => Object.assign(new Error(message), { code });

// ---------------------------------------------------------------------------
// Talking to a printer (raw TCP, port 9100)
// ---------------------------------------------------------------------------

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        sock.destroy();
        reject(err);
      } else resolve(sock);
    };
    const timer = setTimeout(() => finish(withCode('CONNECT_TIMEOUT', 'connect timeout')), timeoutMs);
    // This listener stays for the socket's whole life, so a late network
    // error can never become an uncaught exception.
    sock.on('error', (e) => finish(e));
    sock.once('connect', () => {
      sock.setNoDelay(true);
      finish();
    });
  });
}

/** Collects bytes the printer sends back; the returned function waits for the next one (or null). */
function byteReader(sock) {
  const bytes = [];
  let waiter = null;
  const wake = (b) => {
    const w = waiter;
    waiter = null;
    w?.(b);
  };
  sock.on('data', (chunk) => {
    for (const b of chunk) bytes.push(b);
    if (waiter) wake(bytes.shift());
  });
  sock.on('close', () => wake(null));
  return (timeoutMs) =>
    new Promise((resolve) => {
      if (bytes.length) return resolve(bytes.shift());
      if (sock.destroyed) return resolve(null);
      const t = setTimeout(() => {
        waiter = null;
        resolve(null);
      }, Math.max(0, timeoutMs));
      waiter = (b) => {
        clearTimeout(t);
        resolve(b);
      };
    });
}

function waitForClose(sock, ms) {
  return new Promise((resolve) => {
    if (sock.destroyed) return resolve();
    const t = setTimeout(resolve, Math.max(0, ms));
    sock.once('close', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Print one KOT. Resolves { paper } on success, throws (err.code) on failure.
 *  1. connect (4 s)
 *  2. ask for paper status - if the printer says "paper out" we do not send,
 *     because the KOT would sit unseen inside the printer
 *  3. send the bytes and close our side
 * The whole attempt is limited to jobTimeoutMs.
 */
export async function sendToPrinter(ep, data, { connectTimeoutMs = 4000, jobTimeoutMs = 10_000, preCheckMs = 1000 } = {}) {
  const started = Date.now();
  const left = () => jobTimeoutMs - (Date.now() - started);
  const sock = await connectTcp(ep.host, ep.port, Math.min(connectTimeoutMs, jobTimeoutMs));
  let sockErr = null;
  sock.on('error', (e) => (sockErr = sockErr || e));
  try {
    const nextByte = byteReader(sock);
    sock.write(STATUS_REQUEST);
    const b = await nextByte(Math.min(preCheckMs, left()));
    if (sockErr) throw sockErr;
    const paper = b == null ? null : parseStatusByte(b); // null = printer did not answer; print anyway
    if (paper === 'paper_out') throw withCode('PAPER_OUT');
    if (left() <= 0) throw withCode('JOB_TIMEOUT');

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(withCode('JOB_TIMEOUT')), Math.max(0, left()));
      sock.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      // callback runs once every byte has been handed to the network
      sock.end(data, (err) => {
        clearTimeout(t);
        if (err) reject(err);
        else resolve();
      });
    });
    // Give the printer a moment to close its side so the next KOT gets a clean connection.
    await waitForClose(sock, Math.min(2000, left()));
    return { paper: paper || 'online' };
  } finally {
    sock.destroy();
  }
}

/** Health check: 'online' | 'paper_low' | 'paper_out' | 'offline'. Never throws. */
export async function probePrinter(ep, { connectTimeoutMs = 4000, statusReplyMs = 1500 } = {}) {
  let sock;
  try {
    sock = await connectTcp(ep.host, ep.port, connectTimeoutMs);
  } catch {
    return 'offline';
  }
  try {
    const nextByte = byteReader(sock);
    sock.write(STATUS_REQUEST);
    const b = await nextByte(statusReplyMs);
    // connected but no (valid) answer: some printers don't answer - still online
    return (b == null ? null : parseStatusByte(b)) || 'online';
  } catch {
    return 'online';
  } finally {
    sock.destroy();
  }
}

/** One queue per printer: KOTs for the same printer go one after another. */
function makeQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    run(task) {
      pending++;
      const p = tail.then(task).finally(() => pending--);
      tail = p.catch(() => {});
      return p;
    },
    get idle() {
      return pending === 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Talking to the server (Supabase REST / PostgREST, anon key)
// ---------------------------------------------------------------------------

export class ServerError extends Error {
  constructor(message, { network = false, status = 0, code = '' } = {}) {
    super(message);
    this.network = network;
    this.status = status;
    this.code = code; // PostgREST / Postgres error code, e.g. PGRST202
  }
}

const retryable = (e) => Boolean(e?.network || e?.status >= 500);

function networkReason(e, base) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'the server did not answer in time';
  const code = e?.cause?.code || e?.code;
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    /* keep base */
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `no internet (cannot find ${host})`;
  if (code === 'ECONNREFUSED') return `nothing is running at ${host}`;
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return `${host} did not answer`;
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'the laptop is not connected to a network';
  if (['UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'ECONNRESET', 'EPIPE'].includes(code)) return `the connection to ${host} was cut`;
  if (/CERT|SELF_SIGNED|TLS|SSL/i.test(String(code))) {
    return `secure connection to ${host} failed (${code}) - is the Wi-Fi showing a login page?`;
  }
  return code || e?.cause?.message || e?.message || 'network error';
}

function httpReason(status, text) {
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const msg = body.message || body.msg || text.slice(0, 120) || `HTTP ${status}`;
  if (status === 401 || status === 403) return 'The server refused the anon key - check the key in config.json';
  if (body.code === 'PGRST202' || body.code === 'PGRST205' || body.code === '42P01' || body.code === '42883') {
    return 'Print Hub functions are missing on the server - run the multi-kitchen database update (db/2026-10-07_multikitchen.sql)';
  }
  return `Server error ${status}: ${msg}`;
}

export function makeApi({ url, anonKey, timeoutMs = 8000 }) {
  const base = String(url).replace(/\/+$/, '');
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  async function request(method, pathAndQuery, body) {
    let res;
    let text;
    try {
      res = await fetch(base + pathAndQuery, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (e) {
      throw new ServerError(networkReason(e, base), { network: true });
    }
    if (!res.ok) {
      let code = '';
      try {
        code = String(JSON.parse(text)?.code || '');
      } catch {
        /* not JSON */
      }
      throw new ServerError(httpReason(res.status, text), { status: res.status, code });
    }
    if (!text) return null; // e.g. hub_report returns nothing
    try {
      return JSON.parse(text);
    } catch {
      throw new ServerError('The server sent an unexpected answer', { status: res.status });
    }
  }
  return {
    base,
    rpc: (fn, args) => request('POST', `/rest/v1/rpc/${fn}`, args),
    get: (pathAndQuery) => request('GET', `/rest/v1/${pathAndQuery}`),
  };
}

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

const STATUS_RANK = { unknown: 0, online: 1, paper_low: 2, paper_out: 3, offline: 4 };
const isDown = (s) => s === 'offline' || s === 'paper_out';

/**
 * Start the Print Hub. Returns an async stop() function (stop.state exposes
 * the live state for tests).
 *
 * options: url, anonKey (required); serverName, eventId ('auto' | uuid),
 * hubName, pollMs, display ('board' | 'lines' | 'none'), logDir (null = no
 * log file), plus any key of DEFAULTS.
 */
export function startHub(options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!o.url || !o.anonKey) throw new Error('startHub needs url and anonKey');
  const api = makeApi({ url: o.url, anonKey: o.anonKey, timeoutMs: o.requestTimeoutMs });
  const hubName = o.hubName || os.hostname();
  const serverName = o.serverName || 'cloud';
  const display = o.display || 'none';
  const logDir = o.logDir === undefined ? path.join(HERE, 'logs') : o.logDir;
  const eventMode = o.eventId && o.eventId !== 'auto' ? o.eventId : 'auto';

  const state = {
    hubName,
    serverName,
    server: { base: api.base, reachable: null, error: '', retryAt: 0 },
    events: new Map(), // id -> { id, name, date, multi_kitchen }
    eventsNote: 'Looking for today\'s event...',
    kitchens: new Map(), // eventId -> [kitchen rows]
    printers: new Map(), // "host:port" -> { ep, status, lastError, lastTry, queue }
    reported: new Map(), // "eventId|host:port" -> { status, at } last status the server accepted
    inFlight: new Set(), // KOT ids claimed and not yet reported: never print these again
    pendingReports: new Map(), // KOT id -> { ok, error } printed but the server was not told yet
    counts: new Map(), // kitchen_id -> { printed, failed }  (since this hub started)
    recent: [], // last activity, newest first
    discovery: { on: o.findPrinters !== false, running: false, lastAt: 0, found: [], requests: new Map(), note: '' },
  };

  let stopped = false;
  const timers = new Set();
  const running = new Set(); // job promises, so stop() can let them finish
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!stopped) fn();
    }, ms);
    timers.add(t);
  };

  // ---- logging -----------------------------------------------------------
  let logDirReady = false;
  function logFile(text) {
    if (!logDir) return;
    try {
      if (!logDirReady) fs.mkdirSync(logDir, { recursive: true });
      logDirReady = true;
      const d = new Date();
      const stamp = `${localDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
      fs.appendFileSync(path.join(logDir, `printhub-${localDate(d)}.log`), `${stamp} ${text}\n`);
    } catch {
      // a full disk or locked file must never stop printing
    }
  }
  /** An activity line: on the board, in the log file, and printed when not on a TTY. */
  function note(kind, text) {
    const at = new Date();
    state.recent.unshift({ at, kind, text });
    state.recent.length = Math.min(state.recent.length, 8);
    logFile(`${kind.toUpperCase().padEnd(4)} ${text}`);
    if (display === 'lines') console.log(`[${clockTime(at)}] ${text}`);
  }

  function setServer(reachable, error) {
    const was = state.server.reachable;
    state.server.reachable = reachable;
    if (error !== state.server.error && error) logFile(`SERVER ${error}`);
    state.server.error = error;
    if (was !== reachable) {
      if (reachable === false) note('bad', `Cannot reach server - ${error}`);
      else if (was === false) note('ok', 'Server reachable again');
      else if (reachable) logFile(`SERVER reachable (${api.base})`);
    }
  }

  // ---- printers ----------------------------------------------------------
  function getPrinter(ep) {
    let pr = state.printers.get(ep.key);
    if (!pr) {
      pr = { ep, status: 'unknown', lastError: '', lastTry: 0, queue: makeQueue() };
      state.printers.set(ep.key, pr);
    }
    return pr;
  }

  const statusWords = (s) =>
    ({ online: 'is ONLINE', offline: 'is OFFLINE', paper_out: 'is OUT OF PAPER', paper_low: 'paper is LOW' })[s] || s;

  function setPrinterStatus(pr, status, error) {
    if (isDown(status)) {
      const fallback = status === 'paper_out' ? `Printer ${pr.ep.label} is out of paper` : `Printer ${pr.ep.label} not reachable`;
      pr.lastError = error || (pr.status === status && pr.lastError) || fallback;
    } else pr.lastError = '';
    if (pr.status === status) return;
    const before = pr.status;
    pr.status = status;
    const text = `Printer ${pr.ep.label} ${statusWords(status)}`;
    if (before === 'unknown' && status === 'online') logFile(`INFO ${text}`);
    else note(isDown(status) ? 'bad' : status === 'paper_low' ? 'warn' : 'ok', text);
    reportStatusesSoon();
  }

  const portForIp = (eventId, ip) => portForIpIn(state.kitchens.get(eventId), ip);

  /** Every printer (and backup printer) of the active events. */
  function printerTargets() {
    const out = [];
    for (const [eventId, list] of state.kitchens) {
      if (!state.events.has(eventId)) continue;
      for (const k of list) {
        const main = parseEndpoint(k.printer_ip, k.printer_port);
        if (main) out.push({ eventId, ep: main });
        const backup = parseEndpoint(k.backup_printer_ip, portForIp(eventId, k.backup_printer_ip));
        if (backup) out.push({ eventId, ep: backup });
      }
    }
    return out;
  }

  // ---- printing ------------------------------------------------------------
  function printOn(ep, job, { backup, deadline }) {
    const pr = getPrinter(ep);
    return pr.queue.run(async () => {
      const data = buildKot(job, { printer: `${ep.host}:${ep.port}`, backup, now: new Date() });
      // A printer we already know is down gets a single try every 10 s instead
      // of 3 slow tries per KOT, so a dead printer cannot hold up a pile of
      // KOTs - they go to the backup (or are marked failed) straight away.
      let tries = 1 + o.retryDelaysMs.length;
      if (isDown(pr.status)) tries = Date.now() - pr.lastTry >= o.downRetryMs ? 1 : 0;
      let error = pr.lastError || `Printer ${ep.label} not reachable`;
      let attempted = false;
      let paperOut = false;
      for (let i = 0; i < tries; i++) {
        if (i > 0) await sleep(o.retryDelaysMs[i - 1]);
        const left = deadline - Date.now();
        if (left < 3000) {
          if (!attempted) error = `Printer ${ep.label} busy - KOT waited too long`;
          break;
        }
        attempted = true;
        pr.lastTry = Date.now();
        try {
          const r = await sendToPrinter(ep, data, {
            connectTimeoutMs: o.connectTimeoutMs,
            jobTimeoutMs: Math.min(o.jobTimeoutMs, left),
            preCheckMs: o.preCheckMs,
          });
          setPrinterStatus(pr, r.paper === 'paper_low' ? 'paper_low' : 'online');
          return { ok: true, printer: ep.label };
        } catch (e) {
          error = printerError(e, ep);
          paperOut = e.code === 'PAPER_OUT';
          logFile(`TRY  ${job.kot_no || job.kind} attempt ${i + 1} on ${ep.label} failed: ${e.code || e.message}`);
          if (paperOut) break; // retrying in a second will not load paper
        }
      }
      if (attempted) setPrinterStatus(pr, paperOut ? 'paper_out' : 'offline', error);
      return { ok: false, error };
    });
  }

  async function printJob(job, receivedAt) {
    const kitchen = job.kitchen_name || 'this kitchen';
    const main = parseEndpoint(job.target_ip, job.target_port);
    if (!main) return { ok: false, error: `No printer IP set for ${kitchen}` };
    const deadline = receivedAt + o.jobDeadlineMs;
    const first = await printOn(main, job, { backup: false, deadline });
    if (first.ok) return first;
    // A test print must come out of the printer being tested, never the backup.
    const backup = job.kind === 'test' ? null : parseEndpoint(job.backup_ip, portForIp(job.event_id, job.backup_ip));
    if (!backup || backup.key === main.key) return first;
    const second = await printOn(backup, job, { backup: true, deadline });
    if (second.ok) return { ...second, backup: true };
    return { ok: false, error: `${first.error}; backup ${second.error.replace(/^Printer /, 'printer ')}` };
  }

  function counts(kitchenId) {
    const key = kitchenId || 'none';
    if (!state.counts.has(key)) state.counts.set(key, { printed: 0, failed: 0 });
    return state.counts.get(key);
  }

  function recordResult(job, r) {
    const c = counts(job.kitchen_id);
    if (r.ok) c.printed++;
    else c.failed++;
    const what = job.kind === 'test' ? 'TEST' : job.kind === 'cancel' ? `CANCEL ${job.kot_no || ''}`.trim() : job.kot_no || 'KOT';
    const table = job.table_number != null ? ` T${job.table_number}` : '';
    const kitchen = job.kitchen_name || '?';
    if (r.ok) note('ok', `PRINTED ${what} ${kitchen}${table} on ${r.printer}${r.backup ? ' (BACKUP)' : ''}`);
    else note('bad', `FAILED  ${what} ${kitchen}${table} - ${r.error}`);
    logFile(`JOB  id=${job.id} kind=${job.kind} kot=${job.kot_no || '-'} ok=${r.ok}`);
  }

  async function sendReport(id, ok, error) {
    try {
      await api.rpc('hub_report', { p_kot_id: id, p_ok: ok, p_error: error, p_hub: hubName });
      state.inFlight.delete(id);
    } catch (e) {
      if (retryable(e)) {
        // Keep the id "in flight" until the server knows, so this hub never
        // prints it again even if the server hands it out once more.
        state.pendingReports.set(id, { ok, error });
      } else {
        state.inFlight.delete(id);
        logFile(`ERR  could not record result for KOT ${id}: ${e.message}`);
      }
    }
  }

  async function flushReports() {
    for (const [id, r] of state.pendingReports) {
      try {
        await api.rpc('hub_report', { p_kot_id: id, p_ok: r.ok, p_error: r.error, p_hub: hubName });
      } catch (e) {
        if (retryable(e)) throw e; // server still unreachable: try again later
        logFile(`ERR  dropped result for KOT ${id}: ${e.message}`);
      }
      state.pendingReports.delete(id);
      state.inFlight.delete(id);
    }
  }

  async function handleJob(job, receivedAt) {
    let result;
    try {
      result = await printJob(job, receivedAt);
    } catch (e) {
      result = { ok: false, error: `Print Hub error: ${e?.message || e}` };
    }
    recordResult(job, result);
    await sendReport(job.id, result.ok, result.ok ? null : result.error);
  }

  // ---- server polling ------------------------------------------------------
  let lastEventsAt = 0;
  let lastKitchensAt = 0;
  let targetsSignature = '';

  async function refreshEvents() {
    const sel = 'select=id,name,date,multi_kitchen';
    let rows = [];
    if (eventMode !== 'auto') {
      rows = (await api.get(`events?${sel}&id=eq.${encodeURIComponent(eventMode)}`)) || [];
      state.eventsNote = rows.length ? '' : `Event ${eventMode} was not found on this server (check --event or eventId in config.json).`;
    } else {
      const now = new Date();
      const dates = [localDate(now)];
      // Weddings run past midnight: until 6 AM yesterday's event is still on.
      if (now.getHours() < o.lateNightHour) {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        dates.push(localDate(y));
      }
      for (const d of dates) {
        rows.push(...((await api.get(`events?${sel}&multi_kitchen=eq.true&date=eq.${d}`)) || []));
      }
      state.eventsNote = rows.length
        ? ''
        : `No multi-kitchen event is dated today (${dates[0]}). Checking again every minute.`;
    }
    const next = new Map(rows.map((r) => [r.id, r]));
    for (const [id, ev] of next) if (!state.events.has(id)) note('info', `Printing KOTs for event: ${ev.name || id}`);
    for (const [id, ev] of state.events) if (!next.has(id)) note('info', `No longer printing for event: ${ev.name || id}`);
    state.events = next;
  }

  async function refreshKitchens() {
    const next = new Map();
    for (const ev of state.events.values()) {
      const rows =
        (await api.get(
          `kitchens?event_id=eq.${ev.id}&select=id,event_id,name,prefix,printer_ip,printer_port,backup_printer_ip,is_active,sort_order`,
        )) || [];
      next.set(
        ev.id,
        rows
          .filter((k) => k.is_active !== false)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name))),
      );
    }
    state.kitchens = next;
    // new or changed printer IPs: check them now instead of waiting 15 s
    const sig = printerTargets()
      .map((t) => `${t.eventId}|${t.ep.key}`)
      .sort()
      .join(',');
    if (sig !== targetsSignature) {
      targetsSignature = sig;
      checkPrinters();
    }
  }

  async function claim(ev) {
    const room = o.maxInFlight - state.inFlight.size;
    if (room <= 0) return; // printers are busy: let them catch up first
    const rows = await api.rpc('hub_claim_kots', {
      p_event_id: ev.id,
      p_hub: hubName,
      p_limit: Math.min(o.claimLimit, room),
    });
    const receivedAt = Date.now();
    for (const job of Array.isArray(rows) ? rows : []) {
      if (!job?.id || state.inFlight.has(job.id)) continue; // already handled here: never twice
      state.inFlight.add(job.id);
      const p = handleJob(job, receivedAt)
        .catch((e) => logFile(`ERR  job ${job.id}: ${e?.stack || e}`))
        .finally(() => running.delete(p));
      running.add(p);
    }
  }

  let lastFlushError = '';
  async function pollOnce() {
    try {
      await flushReports();
      lastFlushError = '';
    } catch (e) {
      // keep claiming: if the server is really down the claim fails too and we back off
      if (e.message !== lastFlushError) logFile(`ERR  printed results not delivered yet: ${e.message}`);
      lastFlushError = e.message;
    }
    if (Date.now() - lastEventsAt >= o.eventsRefreshMs) {
      await refreshEvents();
      lastEventsAt = Date.now();
      lastKitchensAt = 0;
    }
    if (Date.now() - lastKitchensAt >= o.kitchensRefreshMs) {
      await refreshKitchens();
      lastKitchensAt = Date.now();
    }
    for (const ev of state.events.values()) await claim(ev);
    checkScanRequests().catch((e) => logFile(`ERR  printer search request: ${e?.message || e}`));
  }

  let failStreak = 0;
  async function pollLoop() {
    let wait = o.pollMs;
    try {
      await pollOnce();
      failStreak = 0;
      state.server.retryAt = 0;
      setServer(true, '');
    } catch (e) {
      const msg = e instanceof ServerError ? e.message : `Unexpected problem: ${e?.message || e}`;
      if (!(e instanceof ServerError)) logFile(`ERR  ${e?.stack || e}`);
      setServer(e?.network ? false : true, msg);
      wait = o.backoffMs[Math.min(failStreak, o.backoffMs.length - 1)];
      failStreak++;
      state.server.retryAt = Date.now() + wait;
    }
    later(pollLoop, wait);
  }

  // ---- printer health ------------------------------------------------------
  let checking = false;
  async function checkPrinters() {
    if (checking || stopped) return;
    checking = true;
    try {
      const eps = new Map();
      for (const t of printerTargets()) eps.set(t.ep.key, t.ep);
      await Promise.all(
        [...eps.values()].map(async (ep) => {
          const pr = getPrinter(ep);
          if (!pr.queue.idle) return; // busy printing: the KOT itself tells us how it is
          const status = await pr.queue.run(() =>
            probePrinter(ep, { connectTimeoutMs: o.connectTimeoutMs, statusReplyMs: o.statusReplyMs }),
          );
          if (isDown(status)) pr.lastTry = Date.now();
          setPrinterStatus(pr, status);
        }),
      );
      await reportStatusesSoon();
    } catch (e) {
      logFile(`ERR  printer check: ${e?.stack || e}`);
    } finally {
      checking = false;
    }
  }

  let firstSearchDone = false;
  async function healthLoop() {
    await checkPrinters();
    // Once at start, then while any printer is down (it may have a new address)
    const anyDown = printerTargets().some((t) => isDown(getPrinter(t.ep).status));
    if (state.events.size && (!firstSearchDone || (anyDown && Date.now() - disc.lastAt >= o.scanEveryMs))) {
      firstSearchDone = true;
      discover(anyDown ? 'printer down' : 'start');
    }
    later(healthLoop, o.probeMs);
  }

  // Tell the server each printer's status: when it changed, or every 60 s.
  // The server re-queues failed KOTs when it hears 'online' (or 'paper_low').
  // One report per event and printer, where a printer is IP + port: several
  // printers may share one IP (Virtual Printers on one laptop), each with its
  // own status. A server that still has the old 3-argument function (no
  // port) is told per IP text instead, so status reports never stop.
  let legacyStatusRpc = false;
  async function sendPrinterStatus(g, status) {
    if (!legacyStatusRpc) {
      try {
        return await api.rpc('hub_printer_status', {
          p_event_id: g.eventId,
          p_printer_ip: g.ep.host,
          p_printer_port: g.ep.port,
          p_status: status,
        });
      } catch (e) {
        if (e?.code !== 'PGRST202') throw e;
        legacyStatusRpc = true;
        note('warn', 'Server has the old printer-status function: printers sharing one IP share one status. Run the database update.');
      }
    }
    return api.rpc('hub_printer_status', { p_event_id: g.eventId, p_printer_ip: g.ep.text, p_status: status });
  }

  async function reportStatusesOnce() {
    const groups = new Map();
    for (const t of printerTargets()) {
      const k = `${t.eventId}|${t.ep.key}`;
      if (!groups.has(k)) groups.set(k, { eventId: t.eventId, ep: t.ep, label: t.ep.label, statuses: [] });
      groups.get(k).statuses.push(getPrinter(t.ep).status);
    }
    for (const [k, g] of groups) {
      if (stopped) return;
      const status = g.statuses.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a), 'unknown');
      if (status === 'unknown') continue;
      const last = state.reported.get(k);
      if (last && last.status === status && Date.now() - last.at < o.heartbeatMs) continue;
      const send = (s) => sendPrinterStatus(g, s);
      let requeued = 0;
      // The server only re-sends failed KOTs on 'online'. A printer that comes
      // back with LOW paper still prints, so say 'online' first, then 'paper_low'.
      if (status === 'paper_low' && (!last || isDown(last.status))) requeued += Number(await send('online')) || 0;
      requeued += Number(await send(status)) || 0;
      state.reported.set(k, { status, at: Date.now() });
      if (requeued > 0) note('ok', `Printer ${g.label} is back - ${requeued} failed KOT(s) sent again`);
    }
  }

  let reporting = null;
  let reportAgain = false;
  function reportStatusesSoon() {
    if (stopped) return Promise.resolve();
    if (reporting) {
      reportAgain = true;
      return reporting;
    }
    reporting = (async () => {
      do {
        reportAgain = false;
        try {
          await reportStatusesOnce();
        } catch (e) {
          logFile(`ERR  printer status report: ${e?.message || e}`); // tried again on the next check
        }
      } while (reportAgain && !stopped);
      reporting = null;
    })();
    return reporting;
  }

  // ---- printer search --------------------------------------------------------
  // Looks for printers on the laptop's network and tells the server, which
  // remembers each kitchen printer's MAC and follows it to a new address.
  // Printers that are working are not touched (a connection to a printer in
  // the middle of a KOT could hold it up): they are reported from what the
  // hub already knows, with their MAC from the ARP table.
  const disc = state.discovery;
  async function discover(reason) {
    if (!disc.on || disc.running || stopped || !state.events.size) return;
    disc.running = true;
    const startedAt = Date.now();
    try {
      const known = new Map(); // "host:port" -> status, for printers known to be working
      const down = [];
      for (const t of printerTargets()) {
        const st = getPrinter(t.ep).status;
        if (st === 'online' || st === 'paper_low') known.set(t.ep.key, { ep: t.ep, status: st });
        else down.push(t.ep.port === 9100 ? t.ep.host : t.ep.key);
      }
      const hosts = [...(o.scanSubnets !== false ? scanHosts() : []), ...down, ...(o.scanTargets || [])];
      const scanned = await findPrinters({
        hosts,
        ports: o.scanPorts,
        timeoutMs: o.scanTimeoutMs,
        skip: new Set(known.keys()),
        arp: o.arp || readArp,
      });
      const arp = known.size ? await (o.arp || readArp)() : new Map();
      const found = [
        ...scanned,
        ...[...known.values()].map(({ ep, status }) => ({
          host: ep.host,
          port: ep.port,
          ip: ep.port === 9100 ? ep.host : ep.key,
          status,
          mac: arp.get(ep.host) || null,
        })),
      ];
      disc.found = found;
      disc.lastAt = startedAt;
      logFile(`SCAN ${reason}: ${found.length} printer(s) ${found.map((f) => f.ip + (f.mac ? ` [${f.mac}]` : '')).join(', ')}`);
      let moved = 0;
      for (const ev of state.events.values()) {
        if (stopped) return;
        const r = await api.rpc('hub_found_printers', {
          p_event_id: ev.id,
          p_hub: hubName,
          p_printers: found.map((f) => ({ ip: f.ip, mac: f.mac, status: f.status })),
        });
        for (const m of r?.moved || []) {
          moved++;
          note('ok', `${m.kitchen} printer moved ${m.from} -> ${m.to}: followed by its MAC address`);
        }
      }
      if (moved) lastKitchensAt = 0; // print to the new address from the next poll
      disc.note = `${found.length} printer${found.length === 1 ? '' : 's'} found at ${clockTime(new Date(startedAt))}`;
      if (reason === 'desk') note('info', `Printer search for the desk: ${disc.note}`);
    } catch (e) {
      if (e?.code === 'PGRST202' || e?.code === '42883' || /hub_found_printers/.test(String(e?.message))) {
        disc.on = false;
        note('warn', 'Printer search needs the database update 2026-10-09_printer_discovery.sql - printing is not affected');
      } else logFile(`ERR  printer search: ${e?.message || e}`);
    } finally {
      disc.running = false;
    }
  }

  // The desk's "Find printers" button sets events.printer_scan_at
  let lastRequestCheck = 0;
  async function checkScanRequests() {
    if (!disc.on || Date.now() - lastRequestCheck < o.scanRequestMs || !state.events.size) return;
    lastRequestCheck = Date.now();
    let rows;
    try {
      rows = await api.get(`events?id=in.(${[...state.events.keys()].join(',')})&select=id,printer_scan_at`);
    } catch (e) {
      if (/printer_scan_at/.test(String(e?.message))) {
        disc.on = false;
        note('warn', 'Printer search needs the database update 2026-10-09_printer_discovery.sql - printing is not affected');
      }
      return;
    }
    let wanted = false;
    for (const r of rows || []) {
      const at = r.printer_scan_at ? Date.parse(r.printer_scan_at) : 0;
      if (at && at !== disc.requests.get(r.id)) {
        if (disc.requests.has(r.id) || Date.now() - at < 120_000) wanted = true; // a fresh press, not one from yesterday
        disc.requests.set(r.id, at);
      }
    }
    if (wanted) discover('desk');
  }

  // ---- console board ---------------------------------------------------------
  let firstDraw = true;
  let lastTick = Date.now();
  function tick() {
    const now = Date.now();
    // A big gap means the laptop slept: printing was paused meanwhile.
    if (now - lastTick > 30_000) {
      note('warn', `Laptop was asleep or frozen for ${Math.round((now - lastTick) / 60000)} min - KOTs were not printed meanwhile`);
    }
    lastTick = now;
    if (display === 'board') {
      try {
        drawBoard();
      } catch (e) {
        logFile(`ERR  board: ${e?.message || e}`);
      }
    }
    later(tick, o.renderMs);
  }

  function drawBoard() {
    const lines = renderBoard(state, {
      logDir,
      color: true,
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24,
    });
    const clear = firstDraw ? '\x1b[2J' : '';
    firstDraw = false;
    process.stdout.write(`${clear}\x1b[?25l\x1b[H${lines.map((l) => `${l}\x1b[K`).join('\n')}\n\x1b[J`);
  }

  // ---- start / stop ----------------------------------------------------------
  logFile(`INFO Print Hub started: server=${serverName} (${api.base}) hub=${hubName} event=${eventMode}`);
  later(pollLoop, 0);
  later(healthLoop, Math.min(2000, o.probeMs));
  later(tick, 0);

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    // KOTs already being printed are finished and reported (bounded wait)
    let waitTimer;
    await Promise.race([
      Promise.allSettled([...running]),
      new Promise((resolve) => (waitTimer = setTimeout(resolve, o.stopWaitMs))),
    ]);
    clearTimeout(waitTimer);
    try {
      await flushReports();
    } catch {
      /* server unreachable: the server re-issues unreported KOTs after 45 s */
    }
    if (display === 'board') process.stdout.write('\x1b[?25h');
    logFile('INFO Print Hub stopped');
  };
  stop.state = state;
  return stop;
}

// ---------------------------------------------------------------------------
// The status board (plain function so it is easy to test)
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- matching terminal colour codes on purpose
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/y;

/** Cut a line to `cols` visible characters, keeping colour codes intact. */
function fit(s, cols) {
  let out = '';
  let vis = 0;
  for (let i = 0; i < s.length; i++) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m) {
      out += m[0];
      i += m[0].length - 1;
      continue;
    }
    if (vis < cols) out += s[i];
    vis++;
  }
  return out;
}

export function renderBoard(state, { logDir = null, color = false, width = 80, height = 100, platform = process.platform } = {}) {
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const green = c('32;1');
  const red = c('31;1');
  const yellow = c('33;1');
  const dim = c('2');
  const bold = c('1');
  const redBar = c('97;41;1');
  const W = Math.max(40, Math.min(width - 1, 79));
  const lines = [];
  const now = new Date();

  const title = "JANU'S SMART SERVE - PRINT HUB";
  const right = `Hub: ${String(state.hubName).slice(0, 24)}   ${clockTime(now)}`;
  lines.push(bold(title) + ' '.repeat(Math.max(1, W - title.length - right.length)) + right);

  let host;
  try {
    host = state.server.base ? new URL(state.server.base).host : '';
  } catch {
    host = '';
  }
  const srv = state.server;
  const reach =
    srv.reachable === null ? dim('connecting...') : srv.reachable === false ? red('NOT REACHABLE') : srv.error ? yellow('PROBLEM') : green('CONNECTED');
  lines.push(`Server: ${String(state.serverName).toUpperCase()}${host ? ` (${host})` : ''}  ${reach}`);

  if (srv.reachable === false) {
    const secs = srv.retryAt ? Math.max(0, Math.ceil((srv.retryAt - Date.now()) / 1000)) : 0;
    const msg = `  CANNOT REACH SERVER - RETRYING${secs ? ` in ${secs}s` : ''}`;
    const bar = (t) => redBar(t.padEnd(W).slice(0, W));
    lines.push(bar(''), bar(msg), bar(`  ${srv.error}`), bar(''));
  } else if (srv.error) {
    lines.push(red(`  ${srv.error}`));
  }
  lines.push('');

  if (state.events.size === 0) {
    lines.push(yellow(state.eventsNote || 'No event yet.'));
  }
  const fmtStatus = (s) => {
    const label = { online: 'ONLINE', offline: 'OFFLINE', paper_out: 'PAPER OUT', paper_low: 'PAPER LOW', unknown: 'checking..' }[s] || s;
    const padded = label.padEnd(11);
    if (s === 'online') return green(padded);
    if (s === 'paper_low') return yellow(padded);
    if (s === 'unknown') return dim(padded);
    return red(padded);
  };
  const statusOf = (ip, port) => {
    const ep = parseEndpoint(ip, port);
    return ep ? state.printers.get(ep.key)?.status || 'unknown' : null;
  };
  for (const ev of state.events.values()) {
    lines.push(`${bold('Event:')} ${ev.name || ev.id}${ev.date ? `  (${ev.date})` : ''}`);
    lines.push(dim(`  ${'KITCHEN'.padEnd(18)} ${'PRINTER'.padEnd(22)} ${'STATUS'.padEnd(11)} PRINTED  FAILED`));
    const list = state.kitchens.get(ev.id) || [];
    if (list.length === 0) lines.push(yellow('  No kitchens set up for this event yet.'));
    for (const k of list) {
      const ep = parseEndpoint(k.printer_ip, k.printer_port);
      const cnt = state.counts.get(k.id) || { printed: 0, failed: 0 };
      const name = String(k.name || '?').slice(0, 18).padEnd(18);
      const printer = (ep ? ep.label : 'no printer IP').slice(0, 22).padEnd(22);
      const st = ep ? fmtStatus(statusOf(k.printer_ip, k.printer_port)) : red('NOT SET'.padEnd(11));
      const failed = String(cnt.failed).padStart(6);
      lines.push(`  ${name} ${printer} ${st} ${String(cnt.printed).padStart(7)}  ${cnt.failed ? red(failed) : failed}`);
      const b = parseEndpoint(k.backup_printer_ip, portForIpIn(list, k.backup_printer_ip));
      if (b) {
        const bs = state.printers.get(b.key)?.status || 'unknown';
        lines.push(`${dim(`    ${'backup'.padEnd(16)} ${b.label.slice(0, 22).padEnd(22)}`)} ${fmtStatus(bs)}`);
      }
    }
    lines.push('');
  }

  const waiting = state.pendingReports.size;
  lines.push(
    `Printing now: ${state.inFlight.size - waiting}` + (waiting ? `    ${yellow(`Printed, waiting to tell server: ${waiting}`)}` : ''),
  );
  const d = state.discovery;
  if (d?.on && (d.running || d.note)) lines.push(dim(`Printer search: ${d.running ? 'looking for printers on this network...' : d.note}`));
  lines.push('');
  lines.push(bold('LAST ACTIVITY'));
  if (state.recent.length === 0) lines.push(dim('  (nothing yet)'));
  // show as many recent lines as the window has room for (at least 3), so the
  // top of the board (server problems!) never scrolls out of sight
  const room = Math.max(3, height - lines.length - 4);
  for (const r of state.recent.slice(0, room)) {
    const paint = r.kind === 'ok' ? green : r.kind === 'bad' ? red : r.kind === 'warn' ? yellow : (s) => s;
    lines.push(`  ${dim(formatTime(r.at))}  ${paint(r.text)}`);
  }
  lines.push('');
  const logName = logDir ? path.join(path.basename(logDir), `printhub-${localDate(now)}.log`) : 'off';
  lines.push(dim(`Ctrl+C to stop.   Log: ${logName}`));
  // In the classic Windows console a mouse click starts "Select" mode, which
  // freezes the program (and printing) until Esc is pressed.
  if (platform === 'win32') lines.push(yellow('Do not click inside this window - if the title says "Select", press Esc.'));
  return lines.map((l) => fit(l, W));
}

// ---------------------------------------------------------------------------
// Command line: config.json + flags
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let v;
    if (a.includes('=')) [a, v] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--server' || a === '--event' || a === '--hub') {
      v = v ?? argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return out;
}

/**
 * Read config.json (create it from config.example.json the first time) and
 * apply command-line flags. Returns { ok: true, options } or { ok: false, message }.
 */
export function loadConfig({ dir = HERE, argv = [] } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return { ok: false, message: `${e.message}\n\nUse: node printhub.mjs [--server local|cloud] [--event <event id>] [--hub <name>]` };
  }
  if (args.help) {
    return { ok: false, help: true, message: 'Use: node printhub.mjs [--server local|cloud] [--event <event id>] [--hub <name>]' };
  }
  const file = path.join(dir, 'config.json');
  const example = path.join(dir, 'config.example.json');
  if (!fs.existsSync(file)) {
    try {
      fs.copyFileSync(example, file);
    } catch (e) {
      return { ok: false, message: `config.json is missing and could not be created (${e.message}).` };
    }
    return {
      ok: false,
      message:
        'First start: a settings file was created for you:\n\n' +
        `    ${file}\n\n` +
        'Open it (Notepad on Windows, TextEdit on Mac), paste the Supabase anon key\n' +
        'in place of PASTE_ANON_KEY, save, and start the Print Hub again.',
    };
  }
  let cfg;
  try {
    // tolerate a BOM (Notepad) and curly quotes (TextEdit smart quotes)
    cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '').replace(/[\u201c\u201d]/g, '"'));
  } catch (e) {
    return {
      ok: false,
      message: `config.json could not be read: ${e.message}\nCheck the quotes and commas, or delete config.json to start again from the example.`,
    };
  }
  const server = String(args.server || cfg.use || 'cloud').toLowerCase();
  const s = cfg.servers?.[server];
  if (!s) return { ok: false, message: `config.json has no server called "${server}" (expected "cloud" or "local").` };
  if (!/^https?:\/\/\S+$/i.test(String(s.url || ''))) {
    return { ok: false, message: `The "${server}" server URL in config.json looks wrong: ${s.url}` };
  }
  const key = String(s.anonKey || '').trim();
  if (!key || /^PASTE_/i.test(key) || key.length < 20) {
    return {
      ok: false,
      message:
        `The anon key for the ${server.toUpperCase()} server is not set yet.\n\n` +
        `Open ${file}\n` +
        `and paste the key in place of ${key || 'the empty value'}, then start again.\n` +
        '(Supabase dashboard -> Project Settings -> API -> anon public key.)',
    };
  }
  const eventId = String(args.event || cfg.eventId || 'auto').trim();
  if (eventId !== 'auto' && !UUID.test(eventId)) {
    return { ok: false, message: `Event id "${eventId}" is not valid. Use "auto" or the event's id (a long code like 1b9d6bcd-...).` };
  }
  return {
    ok: true,
    options: {
      serverName: server,
      url: s.url,
      anonKey: key,
      eventId,
      hubName: String(args.hub || cfg.hubName || os.hostname()).slice(0, 60),
      pollMs: Math.min(10_000, Math.max(500, Number(cfg.pollMs) || DEFAULTS.pollMs)),
      findPrinters: cfg.findPrinters !== false,
      scanTargets: Array.isArray(cfg.scanTargets) ? cfg.scanTargets.map(String) : [],
    },
  };
}

// On a Mac, stop the laptop from going to sleep while the hub runs
// (caffeinate ends by itself when this process ends). Closing the lid still sleeps it.
function keepAwake() {
  if (process.platform !== 'darwin') return;
  try {
    spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    /* not available: nothing to do */
  }
}

function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18 || typeof fetch !== 'function') {
    console.error(`This needs Node.js 18 or newer (this laptop has ${process.version}).`);
    console.error('Install the LTS version from https://nodejs.org and start again.');
    process.exit(2);
  }
  const cfg = loadConfig({ argv: process.argv.slice(2) });
  if (!cfg.ok) {
    console.log(`\n${cfg.help ? '' : 'PRINT HUB NOT STARTED\n\n'}${cfg.message}\n`);
    process.exit(cfg.help ? 0 : 2); // 2 = settings problem: the launcher does not restart
  }
  const display = process.stdout.isTTY ? 'board' : 'lines';
  if (display === 'lines') {
    console.log(`Print Hub starting - server ${cfg.options.serverName} (${cfg.options.url}), hub "${cfg.options.hubName}"`);
  }
  keepAwake();
  const stop = startHub({ ...cfg.options, display });

  // Never crash at an event: log anything unexpected and keep going.
  const logCrash = (e) => {
    try {
      const d = new Date();
      fs.mkdirSync(path.join(HERE, 'logs'), { recursive: true });
      fs.appendFileSync(path.join(HERE, 'logs', `printhub-${localDate(d)}.log`), `${d.toISOString()} CRASH-AVOIDED ${e?.stack || e}\n`);
    } catch {
      /* ignore */
    }
  };
  process.on('uncaughtException', logCrash);
  process.on('unhandledRejection', logCrash);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(0); // second Ctrl+C: leave at once
    stopping = true;
    if (display === 'board') process.stdout.write('\x1b[?25h\n');
    console.log('Stopping - finishing KOTs that are printing right now (Ctrl+C again to quit at once)...');
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) main();

// Virtual Printers - test and demo KOT printing with no real printer.
//
//   node fake-printer.mjs --kitchens 6        6 printers on ports 9101-9106 + the web page
//   node fake-printer.mjs --ports 9101,9102   printers on these ports + the web page
//   node fake-printer.mjs 9101 9102 9103      the same, older form
//
//   Web page:  http://localhost:9180   (--web <port> to change it, --no-web for none,
//              --open to open it in the default browser - the launchers do this)
//   Options:   --paper-low  --paper-out  --no-status (never answers the paper question)
//              --full (also show each whole slip in this window)  --quiet  --help
//
// Each virtual printer accepts the same raw TCP connection (port 9100 style)
// as a real Epson TM-m30III, answers the paper-status question (DLE EOT 4)
// and "prints" what it receives: as a paper slip on the web page, and as one
// line in this window. The web page has, per printer, Paper OK / Paper low /
// Paper out and Switch off / Switch on, to try the Print Hub's alerts and
// automatic reprints. Phones and tablets on the same Wi-Fi can watch too.
//
// In this window you can also type a letter and press Enter (all printers):
//   o = paper out    l = paper low    n = paper OK
//
// No npm packages: only Node 18+ built-ins.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { decodeEscPos, renderPreview, statusByteFor } from './escpos.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PAGE_FILE = path.join(HERE, 'virtual-printers.html');
export const PAPER_STATES = ['online', 'paper_low', 'paper_out'];

let jobSeq = 0;

/**
 * Start one fake printer.
 * @param {object} o
 * @param {number} [o.port=0]        0 = pick a free port
 * @param {string} [o.host]          default: all interfaces
 * @param {string} [o.status]        'online' | 'paper_low' | 'paper_out' | 'silent' (never answers status)
 * @param {number} [o.closeDelayMs]  wait this long before closing after a job (simulates a slow printer)
 * @param {boolean} [o.quiet]        do not print to the console
 * @param {function} [o.onJob]       called with each printed job
 * @param {function} [o.onEvent]     called with (type, data, printer); type is
 *                                   'job' | 'refused' | 'contact' | 'status' | 'power'
 * @returns {Promise<object>} the printer: { port, status, on, jobs, refused, statusChecks,
 *   lastContactAt, setStatus(s), switchOff(), switchOn(), close() }
 *
 * Paper out: the printer still answers (so the Print Hub can see "paper out"),
 * but anything sent to it is not printed - it goes to `refused` instead.
 * Switched off: nothing listens on the port, exactly like a printer with no power.
 */
export function startFakePrinter({ port = 0, host, status = 'online', closeDelayMs = 0, quiet = false, onJob, onEvent } = {}) {
  const sockets = new Set();
  let server = null;
  let closed = false;
  let powerOps = Promise.resolve(); // switch off/on one after another, never overlapping
  const serial = (fn) => (powerOps = powerOps.then(fn, fn));
  const emit = (type, data) => {
    try {
      onEvent?.(type, data, printer);
    } catch {
      /* a display problem must never stop the printer */
    }
  };

  const printer = {
    port: 0,
    host,
    status,
    on: false,
    jobs: [], // printed: { id, at, from, data, decoded }
    refused: [], // received while out of paper - not printed
    statusChecks: 0, // connections that only asked for status (health probes)
    lastContactAt: null, // last time anything connected (the Print Hub checks every 15 s)
    setStatus(s) {
      if (printer.status === s) return;
      printer.status = s;
      emit('status', s);
    },
    switchOff: () =>
      serial(async () => {
        const srv = server;
        if (!srv) return;
        server = null;
        printer.on = false;
        for (const s of sockets) s.destroy();
        await new Promise((resolve) => srv.close(() => resolve()));
        if (!closed) emit('power', false);
      }),
    switchOn: () =>
      serial(async () => {
        if (server || closed) return;
        await listen();
        emit('power', true);
      }),
    close: () => {
      closed = true;
      return printer.switchOff();
    },
  };

  function onConnection(sock) {
    sockets.add(sock);
    printer.lastContactAt = new Date();
    const chunks = [];
    let seen = Buffer.alloc(0);
    let scanFrom = 0;
    sock.on('error', () => {}); // a client hanging up is not our problem
    sock.on('data', (chunk) => {
      chunks.push(chunk);
      // Answer real-time status requests (DLE EOT n) as soon as they arrive,
      // even if they were split across two TCP packets.
      seen = Buffer.concat([seen, chunk]);
      for (let i = scanFrom; i + 2 < seen.length; i++) {
        if (seen[i] === 0x10 && seen[i + 1] === 0x04 && seen[i + 2] >= 1 && seen[i + 2] <= 4) {
          if (printer.status !== 'silent') {
            // n=4 is the paper sensor; for n=1..3 "all fine" is 0x12 / 0x16
            const reply = seen[i + 2] === 4 ? statusByteFor(printer.status) : seen[i + 2] === 1 ? 0x16 : 0x12;
            sock.write(Buffer.from([reply]));
          }
          i += 2;
          scanFrom = i + 1;
        }
      }
      scanFrom = Math.max(scanFrom, seen.length - 2);
    });
    sock.on('end', () => {
      const data = Buffer.concat(chunks);
      const decoded = decodeEscPos(data);
      const hasContent = decoded.cuts > 0 || decoded.lines.some((l) => l.text.trim() !== '');
      if (!hasContent) {
        printer.statusChecks++;
        emit('contact');
      } else {
        const job = { id: ++jobSeq, at: new Date(), from: sock.remoteAddress, data, decoded };
        if (printer.status === 'paper_out') {
          // No paper, no slip. (The Print Hub asks first and never sends here.)
          printer.refused.push(job);
          if (!quiet) console.log(`\n=== Fake printer :${printer.port} got a KOT but is OUT OF PAPER - not printed ===`);
          emit('refused', job);
        } else {
          printer.jobs.push(job);
          if (!quiet) {
            const stamp = job.at.toLocaleTimeString();
            console.log(`\n=== Fake printer :${printer.port} received a KOT at ${stamp} ===`);
            console.log(renderPreview(decoded, { ansi: Boolean(process.stdout.isTTY) }));
          }
          try {
            onJob?.(job);
          } catch {
            /* test callback errors must not kill the printer */
          }
          emit('job', job);
        }
      }
      setTimeout(() => sock.end(), closeDelayMs);
    });
    sock.on('close', () => sockets.delete(sock));
  }

  // allowHalfOpen: we decide when to hang up (closeDelayMs), like a busy printer
  function listen() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer({ allowHalfOpen: true }, onConnection);
      srv.once('error', reject);
      srv.listen({ port: printer.port || port, host }, () => {
        srv.off('error', reject);
        srv.on('error', (e) => console.error(`Fake printer :${printer.port} error: ${e.message}`));
        server = srv;
        printer.port = srv.address().port;
        printer.on = true;
        resolve();
      });
    });
  }

  return listen().then(() => printer);
}

// ---------------------------------------------------------------------------
// Reading a slip: kitchen, KOT no, table... from the printed lines
// ---------------------------------------------------------------------------

/**
 * What a printed slip is, read back from its lines (the KOT layout of escpos.mjs):
 * { kind: 'order'|'cancel'|'test', kitchen, kotNo, table, chairs, backup }
 */
export function describeSlip(decoded) {
  const lines = decoded?.lines || [];
  const texts = lines.map((l) => l.text.trim());
  const kind = texts.includes('TEST PRINT') ? 'test' : texts.some((t) => t.includes('CANCELLED')) ? 'cancel' : 'order';
  // the kitchen name is the big centred block at the top
  const head = [];
  let started = false;
  for (const l of lines) {
    const t = l.text.trim();
    if (!t) {
      if (started) break;
      continue;
    }
    if (l.w >= 2 && l.align === 'center' && !l.reverse && !/^KOT\b/.test(t)) {
      started = true;
      if (t !== 'TEST PRINT') head.push(t);
    } else break;
  }
  const find = (re) => {
    for (const t of texts) {
      const m = t.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };
  // multi-kitchen: "KOT IT-014   08:42 PM"; Smart Serve Maestro: "KOT AS-A 014" on its own line
  const kot = find(/^KOT\s+(\S+)\s+\d\d:\d\d [AP]M$/) || find(/^KOT\s+(\S+(?: \d+)?)$/);
  return {
    kind,
    kitchen: head.join(' ') || null,
    kotNo: kot,
    table: find(/^TABLE\s+(.+)$/) || find(/^T(\d+) - C\d+$/),
    chairs: find(/^CHAIRS?\s+(.+)$/),
    cover: find(/^T\d+ - C(\d+)$/),
    backup: texts.some((t) => t.startsWith('PRINTED ON BACKUP PRINTER')),
  };
}

const two = (n) => String(n).padStart(2, '0');
function clock(d) {
  const h = d.getHours();
  return `${two(h % 12 || 12)}:${two(d.getMinutes())}:${two(d.getSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One line for the terminal: time, port, kitchen, KOT no, table. */
export function slipLine(port, job, info = describeSlip(job.decoded)) {
  const what = info.kind === 'test' ? 'TEST PRINT' : `${info.kind === 'cancel' ? 'CANCEL ' : 'KOT '}${info.kotNo || '-'}`;
  const parts = [
    clock(job.at),
    `:${port}`,
    String(info.kitchen || '?').slice(0, 16).padEnd(16),
    what.padEnd(14),
    info.table ? `T${info.table}` : '',
    info.chairs ? `chairs ${info.chairs}` : '',
    info.cover ? `C${info.cover}` : '',
    info.backup ? '(BACKUP PRINTER)' : '',
  ];
  return parts.filter(Boolean).join('  ');
}

/** The laptop's network addresses - what to type as the kitchen's printer IP. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Virtual Printers: several printers + the live web page
// ---------------------------------------------------------------------------

const PAPER_WORDS = { online: 'paper OK', paper_low: 'paper LOW', paper_out: 'paper OUT', silent: 'does not answer status' };

/**
 * Start several fake printers and the "Virtual Printers" web page.
 * @param {object} o
 * @param {number[]} o.ports           printer ports (0 = any free port, for tests)
 * @param {string} [o.host]            printers listen here (default: all interfaces)
 * @param {number|null} [o.webPort=9180]  web page port (0 = any free port, null = no page)
 * @param {string} [o.webHost]         web page listens here (default: all interfaces)
 * @param {string} [o.status]          starting paper state of every printer
 * @param {function} [o.log]           gets one line of text per slip / change (null = silent)
 * @param {boolean} [o.full]           also log each whole slip
 * @param {number} [o.maxSlips=60]     slips kept on the page per printer (the counter keeps counting)
 * @returns {Promise<{printers, failed, webPort, url, webError, state(), clear(), close()}>}
 */
export async function startVirtualPrinters({
  ports = [9101],
  host,
  webPort = 9180,
  webHost,
  status = 'online',
  log = null,
  full = false,
  maxSlips = 60,
} = {}) {
  const clients = new Set();
  const printers = [];
  const failed = [];
  let web = null; // the page's http server, once listening
  let webError = null;
  const say = (text) => {
    try {
      log?.(text);
    } catch {
      /* ignore */
    }
  };

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  // Kitchen name(s) on a printer: the most frequent on its own slips (not
  // backup slips - those carry another kitchen's name).
  function kitchenOf(p) {
    const ranked = [...p.vp.kitchens.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last);
    return ranked.slice(0, 2).map(([name]) => name).join(' / ') || null;
  }

  function slipView(job) {
    return {
      id: job.id,
      at: job.at.toISOString(),
      ...job.info,
      lines: job.decoded.lines.map((l) => ({ align: l.align, runs: l.runs || [{ text: l.text, bold: l.bold, reverse: l.reverse, w: l.w, h: l.h, small: l.small }] })),
    };
  }

  function printerView(p, { slips = false } = {}) {
    const v = {
      port: p.port,
      kitchen: kitchenOf(p),
      on: p.on,
      paper: p.status,
      count: p.jobs.length,
      refused: p.refused.length,
      checks: p.statusChecks,
      lastContactAt: p.lastContactAt ? p.lastContactAt.toISOString() : null,
    };
    if (slips) v.slips = p.jobs.slice(-maxSlips).reverse().map(slipView); // newest first
    return v;
  }

  function state() {
    return {
      title: 'Virtual Printers',
      now: new Date().toISOString(),
      webPort: web ? web.address().port : null,
      lan: lanAddresses(),
      printers: printers.map((p) => printerView(p, { slips: true })),
    };
  }

  const onEvent = (type, data, p) => {
    if (!p.vp) return; // still starting
    if (type === 'job') {
      data.info = describeSlip(data.decoded);
      if (data.info.kitchen && !data.info.backup) {
        const k = p.vp.kitchens.get(data.info.kitchen) || { n: 0, last: 0 };
        k.n++;
        k.last = data.id;
        p.vp.kitchens.set(data.info.kitchen, k);
      }
      say(slipLine(p.port, data, data.info));
      if (full) say(renderPreview(data.decoded, { ansi: Boolean(process.stdout.isTTY) }));
      broadcast('slip', { port: p.port, slip: slipView(data), printer: printerView(p) });
    } else {
      if (type === 'refused') say(`${clock(data.at)}  :${p.port}  a KOT arrived while OUT OF PAPER - not printed`);
      else if (type === 'status') say(`${clock(new Date())}  :${p.port}  ${PAPER_WORDS[data] || data}`);
      else if (type === 'power') say(`${clock(new Date())}  :${p.port}  switched ${data ? 'ON' : 'OFF'}`);
      broadcast('printer', printerView(p));
    }
  };

  for (const port of ports) {
    try {
      const p = await startFakePrinter({ port, host, status, quiet: true, onEvent });
      p.vp = { kitchens: new Map() };
      printers.push(p);
    } catch (e) {
      failed.push({ port, error: e.code === 'EADDRINUSE' ? 'it is already in use' : e.message });
    }
  }
  const byPort = (port) => printers.find((p) => p.port === Number(port));

  function clear() {
    for (const p of printers) {
      p.jobs.length = 0;
      p.refused.length = 0;
      p.vp.kitchens.clear();
    }
    broadcast('snapshot', state());
    say(`${clock(new Date())}  cleared`);
  }

  // ---- web page -------------------------------------------------------------
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 10_000) reject(new Error('too large'));
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === '/virtual-printers.html')) {
      let html;
      try {
        html = fs.readFileSync(PAGE_FILE, 'utf8');
      } catch (e) {
        return send(res, 500, `virtual-printers.html is missing next to fake-printer.mjs (${e.message})`, 'text/plain; charset=utf-8');
      }
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, state());
    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 1000\nevent: snapshot\ndata: ${JSON.stringify(state())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      ping.unref?.();
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return undefined;
    }
    const m = p.match(/^\/api\/printers\/(\d+)$/);
    if (req.method === 'POST' && m) {
      const pr = byPort(m[1]);
      if (!pr) return send(res, 404, { error: `No virtual printer on port ${m[1]}` });
      const body = await readBody(req);
      if (body.paper !== undefined) {
        if (!PAPER_STATES.includes(body.paper)) return send(res, 400, { error: 'paper must be online, paper_low or paper_out' });
        pr.setStatus(body.paper);
      }
      if (body.power !== undefined) {
        if (body.power !== 'on' && body.power !== 'off') return send(res, 400, { error: 'power must be on or off' });
        try {
          await (body.power === 'on' ? pr.switchOn() : pr.switchOff());
        } catch (e) {
          return send(res, 409, { error: `Could not switch on: port ${pr.port} ${e.code === 'EADDRINUSE' ? 'is in use by another program' : e.message}` });
        }
      }
      return send(res, 200, printerView(pr));
    }
    if (req.method === 'POST' && p === '/api/clear') {
      clear();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  if (webPort != null) {
    const srv = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        if (!res.headersSent) send(res, 400, { error: e.message });
        else res.end();
      });
    });
    try {
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen({ port: webPort, host: webHost }, () => {
          srv.off('error', reject);
          resolve();
        });
      });
      web = srv;
    } catch (e) {
      webError = e.code === 'EADDRINUSE' ? `port ${webPort} is already in use` : e.message;
    }
  }
  const actualWebPort = web ? web.address().port : null;

  return {
    printers,
    failed,
    webPort: actualWebPort,
    url: web ? `http://localhost:${actualWebPort}` : null,
    webError,
    state,
    clear,
    async close() {
      for (const res of clients) res.end();
      clients.clear();
      if (web) {
        web.closeAllConnections?.();
        await new Promise((resolve) => web.close(() => resolve()));
      }
      for (const pr of printers) await pr.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const USAGE = `Use:  node fake-printer.mjs --kitchens 6            (printers on 9101-9106 + web page)
      node fake-printer.mjs --ports 9101,9102,9103
      node fake-printer.mjs 9101 9102                (older form, same thing)
Options: --web <port> (default 9180)  --no-web  --open  --base <first port, default 9101>
         --paper-low  --paper-out  --no-status  --full  --quiet`;

function toPort(v, what = 'port') {
  const n = Number(v);
  if (!/^\d+$/.test(String(v).trim()) || n < 1 || n > 65535) throw new Error(`${what} "${v}" is not a port number (1-65535)`);
  return n;
}

export function parseArgs(argv) {
  const o = { ports: [], web: 9180, open: false, status: 'online', quiet: false, full: false, help: false, kitchens: 0, base: 9101 };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let v;
    if (a.startsWith('--') && a.includes('=')) [a, v] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    const value = () => {
      v = v ?? argv[++i];
      if (v == null || v === '') throw new Error(`${a} needs a value`);
      return v;
    };
    if (/^\d+$/.test(a)) o.ports.push(toPort(a));
    else if (a === '--kitchens' || a === '-k') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1 || n > 40) throw new Error('--kitchens needs a number from 1 to 40');
      o.kitchens = n;
    } else if (a === '--ports') o.ports.push(...String(value()).split(/[,\s]+/).filter(Boolean).map((x) => toPort(x)));
    else if (a === '--base') o.base = toPort(value(), '--base');
    else if (a === '--web') o.web = toPort(value(), '--web');
    else if (a === '--no-web') o.web = null;
    else if (a === '--open') o.open = true;
    else if (a === '--paper-low') o.status = 'paper_low';
    else if (a === '--paper-out') o.status = 'paper_out';
    else if (a === '--no-status') o.status = 'silent';
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--full') o.full = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  for (let k = 0; k < o.kitchens; k++) o.ports.push(o.base + k);
  if (o.ports.length === 0) o.ports.push(o.base);
  o.ports = [...new Set(o.ports)];
  return o;
}

/** Open a page in the default browser (open / start / xdg-open). Never throws. */
function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  } catch {
    /* no browser: the address is printed in the window */
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.log(`\n${e.message}\n\n${USAGE}\n`);
    process.exit(2);
  }
  if (args.help) {
    console.log(`\n${USAGE}\n`);
    process.exit(0);
  }
  const log = args.quiet ? null : (t) => console.log(t);
  const vp = await startVirtualPrinters({
    ports: args.ports,
    webPort: args.web,
    status: args.status,
    log,
    // without the web page this window is the only place to see a slip
    full: !args.quiet && (args.full || args.web == null),
  });
  for (const f of vp.failed) console.error(`Could not open printer port ${f.port}: ${f.error}`);
  if (vp.printers.length === 0) {
    console.error('\nNo virtual printer could start. Is another Virtual Printers window already open?');
    process.exit(1);
  }

  const ips = lanAddresses();
  const ports = vp.printers.map((p) => p.port);
  const range = ports.length > 2 && ports.every((p, i) => i === 0 || p === ports[i - 1] + 1) ? `${ports[0]} - ${ports[ports.length - 1]}` : ports.join(', ');
  console.log('');
  console.log("VIRTUAL PRINTERS - Janu's Smart Serve.  Leave this window open.");
  console.log('');
  console.log(`  Printers:   ${vp.printers.length} on port${ports.length > 1 ? 's' : ''} ${range}   (${PAPER_WORDS[args.status]})`);
  if (vp.url) {
    console.log(`  Web page:   ${vp.url}   (open it in Chrome, Edge or Safari)`);
    if (ips.length) console.log(`  Phone/tablet on the same Wi-Fi:  ${ips.map((ip) => `http://${ip}:${vp.webPort}`).join('   or   ')}`);
  } else if (args.web != null) {
    console.log(`  Web page:   NOT started - ${vp.webError}. Slips are shown here instead.`);
  }
  console.log('');
  console.log('  In Smart Serve, Control > Kitchens: give each kitchen its own port from the list above, and as');
  console.log(`  printer IP 127.0.0.1 if the Print Hub runs on this laptop${ips.length ? `, or ${ips[0]} if it runs on another one` : ''}.`);
  if (process.stdin.isTTY) console.log('  Type o (paper out), l (paper low) or n (paper OK) + Enter to change the paper of all printers.');
  console.log('  Press Ctrl+C to stop.\n');
  if (args.open && vp.url) openInBrowser(vp.url);

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => {
      const s = { o: 'paper_out', l: 'paper_low', n: 'online' }[l.trim().toLowerCase()];
      if (!s) return;
      for (const p of vp.printers) p.setStatus(s);
    });
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(0);
    stopping = true;
    await Promise.race([vp.close(), new Promise((r) => setTimeout(r, 2000))]);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) main();

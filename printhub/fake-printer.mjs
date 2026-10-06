// Fake KOT printer for demos and tests - no real printer needed.
//
//   node fake-printer.mjs 9101            one fake printer on port 9101
//   node fake-printer.mjs 9101 9102 9103  three fake printers
//   options: --paper-low  --paper-out  --no-status  --quiet
//
// It accepts the same raw TCP connection a real Epson printer does, answers
// the paper-status question (DLE EOT 4) and shows each KOT it receives as
// readable text in this window.
//
// While it runs you can type a letter and press Enter to change its paper:
//   o = paper out    l = paper low    n = normal

import net from 'node:net';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { decodeEscPos, renderPreview, statusByteFor } from './escpos.mjs';

/**
 * Start one fake printer.
 * @param {object} o
 * @param {number} [o.port=0]        0 = pick a free port
 * @param {string} [o.host]          default: all interfaces
 * @param {string} [o.status]        'online' | 'paper_low' | 'paper_out' | 'silent' (never answers status)
 * @param {number} [o.closeDelayMs]  wait this long before closing after a job (simulates a slow printer)
 * @param {boolean} [o.quiet]        do not print to the console
 * @param {function} [o.onJob]       called with each received job
 * @returns {Promise<{port:number, jobs:Array, statusChecks:number, setStatus:function, close:function}>}
 */
export function startFakePrinter({ port = 0, host, status = 'online', closeDelayMs = 0, quiet = false, onJob } = {}) {
  const printer = {
    port: 0,
    status,
    jobs: [], // { at, from, data, decoded }
    statusChecks: 0, // connections that only asked for status (health probes)
    setStatus(s) {
      printer.status = s;
    },
    close: () => new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
  const sockets = new Set();

  // allowHalfOpen: we decide when to hang up (closeDelayMs), like a busy printer
  const server = net.createServer({ allowHalfOpen: true }, (sock) => {
    sockets.add(sock);
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
      } else {
        const job = { at: new Date(), from: sock.remoteAddress, data, decoded };
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
      }
      setTimeout(() => sock.end(), closeDelayMs);
    });
    sock.on('close', () => sockets.delete(sock));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host }, () => {
      server.off('error', reject);
      server.on('error', (e) => console.error(`Fake printer :${printer.port} error: ${e.message}`));
      printer.port = server.address().port;
      resolve(printer);
    });
  });
}

/** The laptop's network addresses - what to type as the kitchen's printer IP. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const ports = args.filter((a) => /^\d+$/.test(a)).map(Number);
  let status = 'online';
  if (args.includes('--paper-low')) status = 'paper_low';
  if (args.includes('--paper-out')) status = 'paper_out';
  if (args.includes('--no-status')) status = 'silent';
  const quiet = args.includes('--quiet');
  if (ports.length === 0) ports.push(9101);

  const printers = [];
  for (const port of ports) {
    try {
      printers.push(await startFakePrinter({ port, status, quiet }));
    } catch (e) {
      console.error(`Could not open port ${port}: ${e.code === 'EADDRINUSE' ? 'it is already in use' : e.message}`);
    }
  }
  if (printers.length === 0) process.exit(1);

  const ips = lanAddresses();
  console.log('Fake KOT printer is running. Leave this window open.\n');
  console.log(`  Ports:          ${printers.map((p) => p.port).join(', ')}`);
  console.log(`  This laptop IP: ${ips.length ? ips.join('  or  ') : '(not on a network - use 127.0.0.1)'}`);
  console.log(`  Paper:          ${status === 'silent' ? 'does not answer status' : status}`);
  console.log('\n  In Smart Serve, set each kitchen\'s printer IP to this laptop IP and its port to one of the ports above.');
  if (process.stdin.isTTY) console.log('  Type o (paper out), l (paper low) or n (normal) and press Enter to simulate paper problems.');
  console.log('  Press Ctrl+C to stop.\n');

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => {
      const s = { o: 'paper_out', l: 'paper_low', n: 'online' }[l.trim().toLowerCase()];
      if (!s) return;
      for (const p of printers) p.setStatus(s);
      console.log(`Paper is now: ${s}`);
    });
  }
  process.on('SIGINT', () => process.exit(0));
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) main();

// Finding the kitchen printers on the network.
//
// Network thermal printers listen on TCP port 9100. The Print Hub tries that
// port on every address of the laptop's own network (a /24, 254 addresses,
// about a second), asks each printer that answers for its paper status, and
// reads its hardware (MAC) address from the laptop's ARP table. The MAC
// never changes, so a printer that comes back from a restart with a new IP
// address can be recognised and followed.
//
// No npm packages: Node built-ins only.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { parseStatusByte, STATUS_REQUEST } from './escpos.mjs';

/** "0:11:62:a:b:c" / "00-11-62-0A-0B-0C" -> "00:11:62:0a:0b:0c"; null when not a MAC. */
export function normMac(s) {
  const parts = String(s || '').trim().toLowerCase().split(/[:-]/);
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/.test(p))) return null;
  const mac = parts.map((p) => p.padStart(2, '0')).join(':');
  // incomplete / broadcast entries
  if (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') return null;
  return mac;
}

/**
 * IP -> MAC from the text of `arp -a` (macOS, Windows, Linux net-tools) or of
 * /proc/net/arp (Linux).
 */
export function parseArp(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
    if (!ip) continue;
    const mac = line
      .split(/[\s()]+/)
      .map(normMac)
      .find(Boolean);
    if (mac) out.set(ip, mac);
  }
  return out;
}

/** The laptop's ARP table. Never throws: an empty map when it cannot be read. */
export function readArp() {
  return new Promise((resolve) => {
    if (process.platform === 'linux') {
      try {
        resolve(parseArp(fs.readFileSync('/proc/net/arp', 'utf8')));
        return;
      } catch {
        /* fall through to the arp command */
      }
    }
    const args = process.platform === 'win32' ? ['-a'] : ['-an'];
    execFile('arp', args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? new Map() : parseArp(stdout));
    });
  });
}

const toInt = (ip) => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
const toIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/**
 * The addresses to try: every IPv4 network the laptop is on. Networks bigger
 * than a /24 are cut to the /24 around the laptop's own address, so a scan
 * stays at a second or two; `extraHosts` (the printers already set up) are
 * always tried as well, wherever they are.
 */
export function scanHosts({ interfaces = os.networkInterfaces(), extraHosts = [] } = {}) {
  const hosts = new Set();
  for (const list of Object.values(interfaces || {})) {
    for (const a of list || []) {
      const fam = a.family === 4 ? 'IPv4' : a.family;
      if (fam !== 'IPv4' || a.internal || !a.address || a.address.startsWith('169.254.')) continue;
      const bits = a.cidr ? Number(a.cidr.split('/')[1]) : a.netmask ? a.netmask.split('.').reduce((n, o) => n + (Number(o) >>> 0).toString(2).replace(/0/g, '').length, 0) : 24;
      const prefix = Math.max(24, Math.min(30, bits || 24));
      const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
      const net0 = (toInt(a.address) & mask) >>> 0;
      const size = 2 ** (32 - prefix);
      for (let i = 1; i < size - 1; i++) {
        const ip = toIp(net0 + i);
        if (ip !== a.address) hosts.add(ip);
      }
    }
  }
  for (const h of extraHosts) if (h) hosts.add(String(h));
  return [...hosts];
}

/** Port open? Resolves the connected socket or null. */
function tryConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      if (!v) sock.destroy();
      resolve(v);
    };
    const t = setTimeout(() => finish(null), timeoutMs);
    sock.once('connect', () => finish(sock));
    sock.once('error', () => finish(null));
  });
}

/** Paper status of a connected printer, or 'unknown' when it does not say. */
function askStatus(sock, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      sock.destroy();
      resolve(v);
    };
    const t = setTimeout(() => finish('unknown'), ms);
    sock.once('data', (buf) => finish(parseStatusByte(buf[buf.length - 1]) || 'online'));
    sock.once('error', () => finish('unknown'));
    sock.once('close', () => finish('unknown'));
    try {
      sock.write(STATUS_REQUEST);
    } catch {
      finish('unknown');
    }
  });
}

/**
 * Find printers. targets: hosts ("192.168.1.23") or "host:port"; every host
 * is tried on each of `ports`. Returns [{ ip, host, port, mac, status }]
 * where ip is "host" for port 9100 and "host:port" otherwise.
 */
export async function findPrinters({
  hosts = scanHosts(),
  ports = [9100],
  timeoutMs = 400,
  statusReplyMs = 700,
  concurrency = 96,
  arp = readArp,
  skip = new Set(),
} = {}) {
  const jobs = [];
  for (const h of hosts) {
    const m = String(h).match(/^([^:\s]+):(\d{1,5})$/);
    if (m) jobs.push([m[1], Number(m[2])]);
    else for (const p of ports) jobs.push([String(h), p]);
  }
  const seen = new Set(skip);
  const found = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [host, port] = jobs[next++];
      const key = `${host}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sock = await tryConnect(host, port, timeoutMs);
      if (!sock) continue;
      const status = await askStatus(sock, statusReplyMs);
      found.push({ host, port, ip: port === 9100 ? host : key, status });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  // the connects above put every printer in the ARP table
  const table = found.length ? await arp() : new Map();
  for (const f of found) f.mac = table.get(f.host) || null;
  const order = (f) => toInt(/^\d+\.\d+\.\d+\.\d+$/.test(f.host) ? f.host : '0.0.0.0') * 65536 + f.port;
  return found.sort((a, b) => order(a) - order(b));
}

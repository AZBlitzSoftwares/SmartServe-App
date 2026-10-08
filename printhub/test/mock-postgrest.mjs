// A tiny in-memory stand-in for Supabase's REST API (PostgREST), implementing
// exactly what the Print Hub uses. The RPCs mirror the SQL in
// db/2026-10-07_multikitchen.sql (hub_claim_kots, hub_report, and the
// per-printer hub_printer_status with p_printer_port).
// Test helper only - importing it has no side effects.

import http from 'node:http';
import { randomUUID } from 'node:crypto';

// A printer as the SQL reads it: "ip:port" in the IP field means that port,
// otherwise the given port (default 9100). Same rule as parseEndpoint().
const EP = /^[^:\s]+:[0-9]{1,5}$/;
export function endpointOf(ipText, port) {
  const s = String(ipText ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (EP.test(s)) return { host: s.split(':')[0], port: Number(s.split(':')[1]) };
  return { host: s, port: Number(port) || 9100 };
}

/**
 * @param {object} o
 * @param {number} [o.reclaimMs=45000]  'printing' KOTs older than this are handed out again
 * @param {boolean} [o.legacyStatus]    behave like a server with the old 3-argument
 *                                      hub_printer_status (no p_printer_port)
 */
export async function startMockPostgrest({ anonKey = 'test-anon-key-0123456789abcdef', reclaimMs = 45_000, legacyStatus = false, noDiscovery = false } = {}) {
  const db = { events: [], kitchens: [], kots: [], found: [] };
  const calls = []; // every request: { name, args, at }
  let mode = 'up'; // 'up' | 'down' (drop every connection) | 'reports-down' (drop hub_report only)
  let clock = Date.parse('2026-10-13T13:00:00Z');

  const kitchenOf = (k) => db.kitchens.find((x) => x.id === k.kitchen_id);
  const eventOf = (k) => db.events.find((x) => x.id === k.event_id);

  const rpc = {
    hub_claim_kots({ p_event_id, p_hub, p_limit = 20 }) {
      const now = Date.now();
      const picked = db.kots
        .filter(
          (k) =>
            k.event_id === p_event_id &&
            (k.print_status === 'queued' || (k.print_status === 'printing' && now - k._claimedAtMs > reclaimMs)),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, Math.max(1, Math.min(p_limit, 50)));
      for (const k of picked) {
        k.print_status = 'printing';
        k.print_claimed_by = p_hub;
        k._claimedAtMs = now;
        k.print_claimed_at = new Date(now).toISOString();
        k.print_attempts += 1;
      }
      return picked.map((k) => {
        const kt = kitchenOf(k);
        const row = { ...k };
        delete row._claimedAtMs; // internal to the mock
        return {
          ...row,
          target_ip: (k.printer_ip || null) ?? kt?.printer_ip ?? null,
          target_port: kt?.printer_port ?? 9100,
          backup_ip: kt?.backup_printer_ip ?? null,
          event_name: eventOf(k)?.name ?? null,
        };
      });
    },
    hub_report({ p_kot_id, p_ok, p_error }) {
      const k = db.kots.find((x) => x.id === p_kot_id);
      if (k) {
        if (p_ok) Object.assign(k, { print_status: 'printed', printed_at: new Date().toISOString(), last_error: null });
        else Object.assign(k, { print_status: 'failed', last_error: String(p_error ?? 'print failed').slice(0, 300) });
      }
      return undefined; // void -> empty body
    },
    // p_printer_port given: only that printer (IP + port); null: every kitchen with that IP text
    hub_printer_status({ p_event_id, p_printer_ip, p_status, p_printer_port = null }) {
      const ip = String(p_printer_ip ?? '').trim();
      const samePrinter = (ipText, port) => {
        if (p_printer_port == null) return ipText === p_printer_ip;
        const ep = endpointOf(ipText, port);
        return ep.host === ip && ep.port === p_printer_port;
      };
      for (const kt of db.kitchens) {
        const match = p_printer_port == null ? kt.printer_ip === p_printer_ip : samePrinter(kt.printer_ip, kt.printer_port);
        if (kt.event_id === p_event_id && match) {
          kt.printer_status = p_status;
          kt.printer_checked_at = new Date().toISOString();
        }
      }
      let requeued = 0;
      if (p_status === 'online' || p_status === 'paper_low') {
        for (const k of db.kots) {
          const kt = kitchenOf(k);
          if (!kt || k.event_id !== p_event_id || k.print_status !== 'failed') continue;
          if (k.kind === 'order' && k.status === 'cancelled') continue;
          if (!samePrinter(k.printer_ip || kt.printer_ip, kt.printer_port)) continue;
          k.print_status = 'queued';
          k.last_error = null;
          requeued++;
        }
      }
      return requeued;
    },
    // mirrors db/2026-10-09_printer_discovery.sql: learn a kitchen printer's MAC, follow it to a new address
    hub_found_printers({ p_event_id, p_printers }) {
      const key = (ip, port) => {
        const ep = endpointOf(ip, port);
        if (!ep.host) return null;
        return ep.port === 9100 ? ep.host : `${ep.host}:${ep.port}`;
      };
      const seen = (p_printers || []).map((f) => ({ ip: key(f.ip), mac: f.mac ? String(f.mac).toLowerCase() : null, status: f.status }));
      db.found.push({ event_id: p_event_id, printers: seen });
      const moved = [];
      let learned = 0;
      for (const k of db.kitchens.filter((x) => x.event_id === p_event_id)) {
        const kk = key(k.printer_ip, k.printer_port);
        if (!kk) continue;
        const at = seen.find((f) => f.ip === kk);
        if (!k.printer_mac) {
          if (at?.mac) {
            k.printer_mac = at.mac;
            learned++;
          }
        } else if (!at || (at.mac && at.mac !== k.printer_mac)) {
          const nw = seen.find((f) => f.mac === k.printer_mac && f.ip !== kk);
          if (nw) {
            k.printer_moved_from = kk;
            k.printer_ip = nw.ip;
            if (!/:\d+$/.test(nw.ip)) k.printer_port = 9100;
            moved.push({ kitchen: k.name, from: kk, to: nw.ip });
          }
        }
      }
      return { moved, learned };
    },
  };

  // PostgREST-style filters: col=eq.value ; select=a,b,c
  function selectRows(rows, params) {
    let out = rows;
    for (const [key, value] of params) {
      if (key === 'select' || key === 'order') continue;
      if (value.startsWith('in.(') && value.endsWith(')')) {
        const set = new Set(value.slice(4, -1).split(','));
        out = out.filter((r) => set.has(String(r[key])));
        continue;
      }
      if (!value.startsWith('eq.')) throw new Error(`mock supports only eq and in filters (${key}=${value})`);
      const want = value.slice(3);
      out = out.filter((r) => String(r[key]) === want);
    }
    const sel = params.get('select');
    if (sel && sel !== '*') {
      const cols = sel.split(',');
      out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    }
    return out;
  }

  const server = http.createServer((req, res) => {
    if (mode === 'down') return req.socket.destroy();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, data) => {
        if (data === undefined) {
          res.writeHead(status === 200 ? 204 : status);
          return res.end();
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      try {
        if (req.headers.apikey !== anonKey || req.headers.authorization !== `Bearer ${anonKey}`) {
          return send(401, { message: 'Invalid API key' });
        }
        const url = new URL(req.url, 'http://mock');
        const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
        if (m && req.method === 'POST') {
          const fn = m[1];
          if (fn === 'hub_report' && mode === 'reports-down') return req.socket.destroy();
          const args = body ? JSON.parse(body) : {};
          calls.push({ name: fn, args, at: Date.now() });
          if (fn === 'hub_printer_status' && legacyStatus && 'p_printer_port' in args) {
            return send(404, { code: 'PGRST202', message: 'Could not find the function public.hub_printer_status(p_event_id, p_printer_ip, p_printer_port, p_status) in the schema cache' });
          }
          if (!rpc[fn] || (noDiscovery && fn === 'hub_found_printers')) return send(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
          return send(200, rpc[fn](args));
        }
        const t = url.pathname.match(/^\/rest\/v1\/(events|kitchens)$/);
        if (t && req.method === 'GET') {
          calls.push({ name: `GET ${t[1]}`, args: Object.fromEntries(url.searchParams), at: Date.now() });
          return send(200, selectRows(db[t[1]], url.searchParams));
        }
        send(404, { message: 'not found' });
      } catch (e) {
        send(500, { message: e.message });
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    anonKey,
    db,
    calls,
    setMode(m) {
      mode = m;
    },
    addEvent(e) {
      const row = { id: randomUUID(), name: 'Test Event', date: null, multi_kitchen: true, printer_scan_at: null, ...e };
      db.events.push(row);
      return row;
    },
    addKitchen(k) {
      const row = {
        id: randomUUID(),
        name: 'Kitchen',
        prefix: 'K',
        printer_ip: null,
        printer_port: 9100,
        backup_printer_ip: null,
        is_active: true,
        sort_order: db.kitchens.length,
        printer_status: null,
        ...k,
      };
      db.kitchens.push(row);
      return row;
    },
    /** kitchen: a kitchen row; other fields as in the kots table */
    addKot({ kitchen, ...k }) {
      clock += 1000; // keep created_at strictly increasing
      const row = {
        id: randomUUID(),
        event_id: kitchen.event_id,
        order_id: randomUUID(),
        kitchen_id: kitchen.id,
        kitchen_name: kitchen.name,
        kind: 'order',
        kot_no: null,
        table_number: null,
        chairs: null,
        captain_name: null,
        items: [],
        status: 'open',
        print_status: 'queued',
        print_attempts: 0,
        print_claimed_by: null,
        print_claimed_at: null,
        printer_ip: null,
        printed_at: null,
        last_error: null,
        created_at: new Date(clock).toISOString(),
        _claimedAtMs: 0,
        ...k,
      };
      db.kots.push(row);
      return row;
    },
    kot: (id) => db.kots.find((k) => k.id === id),
    callsTo: (name) => calls.filter((c) => c.name === name),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// End-to-end: real TCP fake printers + an in-memory PostgREST + the real hub loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startHub, localDate, renderBoard, parseEndpoint, printerError, probePrinter } from '../printhub.mjs';
import { startFakePrinter } from '../fake-printer.mjs';
import { startMockPostgrest } from './mock-postgrest.mjs';

// Fast timings so the whole suite runs in seconds.
const FAST = {
  pollMs: 100,
  probeMs: 300,
  heartbeatMs: 5000,
  kitchensRefreshMs: 300,
  eventsRefreshMs: 1000,
  connectTimeoutMs: 1000,
  jobTimeoutMs: 3000,
  preCheckMs: 300,
  statusReplyMs: 300,
  retryDelaysMs: [50, 100],
  downRetryMs: 500,
  backoffMs: [100, 200, 300],
  requestTimeoutMs: 2000,
  stopWaitMs: 3000,
  display: 'none',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, what, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/** A port with nothing listening on it. */
async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const jobTexts = (printer) => printer.jobs.map((j) => j.decoded.lines.map((l) => l.text.trim()));
const hasLine = (lines, re) => lines.some((l) => (re instanceof RegExp ? re.test(l) : l === re));

/** Common setup: mock server, today's event, a hub; everything is cleaned up afterwards. */
async function setup(t, { reclaimMs, legacyStatus, hub: hubOptions = {} } = {}) {
  const mock = await startMockPostgrest({ reclaimMs, legacyStatus });
  const event = mock.addEvent({ name: 'Sharma Wedding', date: localDate() });
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-test-'));
  const printers = [];
  let stop = null;
  const ctx = {
    mock,
    event,
    logDir,
    async printer(opts) {
      const p = await startFakePrinter({ host: '127.0.0.1', quiet: true, ...opts });
      printers.push(p);
      return p;
    },
    start(extra = {}) {
      stop = startHub({ ...FAST, url: mock.url, anonKey: mock.anonKey, hubName: 'test-hub', logDir, ...hubOptions, ...extra });
      ctx.state = stop.state;
      return stop;
    },
  };
  t.after(async () => {
    if (stop) await stop();
    for (const p of printers) await p.close();
    await mock.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });
  return ctx;
}

test('prints each KOT once on its own kitchen printer and reports ok', async (t) => {
  const ctx = await setup(t);
  const { mock, event } = ctx;
  const p1 = await ctx.printer();
  const p2 = await ctx.printer();
  const italian = mock.addKitchen({ event_id: event.id, name: 'Italian', prefix: 'IT', printer_ip: '127.0.0.1', printer_port: p1.port });
  const arabic = mock.addKitchen({ event_id: event.id, name: 'Arabic', prefix: 'AR', printer_ip: '127.0.0.1', printer_port: p2.port });
  const items = [
    { name: 'Penne Arrabbiata', qty: 2, note: 'Jain', veg: true },
    { name: 'Lasagna', qty: 1, note: null, veg: false },
  ];
  const k1 = mock.addKot({ kitchen: italian, kot_no: 'IT-001', table_number: 8, chairs: [2, 3], captain_name: 'Rahul', items });
  const k2 = mock.addKot({ kitchen: italian, kot_no: 'IT-002', table_number: 5, chairs: [1], captain_name: 'Rahul', items: [items[1]] });
  const k3 = mock.addKot({ kitchen: arabic, kot_no: 'AR-001', table_number: 8, chairs: [2], captain_name: 'Rahul', items: [{ name: 'Hummus', qty: 3 }] });
  const k4 = mock.addKot({ kitchen: italian, kind: 'cancel', status: 'cancelled', kot_no: 'IT-001', table_number: 8, chairs: [2, 3], items });
  const k5 = mock.addKot({ kitchen: arabic, kind: 'test' });
  const all = [k1, k2, k3, k4, k5];

  ctx.start();
  await waitFor(() => all.every((k) => mock.kot(k.id).print_status === 'printed'), 'all KOTs printed');
  await sleep(400); // give a duplicate a chance to show up

  const t1 = jobTexts(p1);
  const t2 = jobTexts(p2);
  assert.equal(p1.jobs.length, 3, 'Italian printer got IT-001, IT-002 and the cancel slip');
  assert.equal(p2.jobs.length, 2, 'Arabic printer got AR-001 and the test print');
  // the right KOT on the right printer, in order
  assert.ok(hasLine(t1[0], 'ITALIAN') && hasLine(t1[0], /^KOT IT-001 /) && hasLine(t1[0], 'TABLE 8'));
  assert.ok(hasLine(t1[0], 'CHAIRS 2, 3') && hasLine(t1[0], '2 x Penne Arrabbiata') && hasLine(t1[0], '>> JAIN <<'));
  assert.ok(hasLine(t1[0], 'Total items: 3') && hasLine(t1[0], /Sharma Wedding/));
  assert.ok(hasLine(t1[1], /^KOT IT-002 /));
  assert.ok(hasLine(t1[2], '*** CANCELLED ***'));
  assert.ok(hasLine(t2[0], /^KOT AR-001 /) && hasLine(t2[0], '3 x Hummus'));
  assert.ok(hasLine(t2[1], 'TEST PRINT') && hasLine(t2[1], `Printer: 127.0.0.1:${p2.port}`));
  // the paper status was asked before every job
  for (const j of [...p1.jobs, ...p2.jobs]) assert.equal(j.decoded.statusRequests, 1);

  // reported exactly once each, ok, by this hub
  const reports = mock.callsTo('hub_report');
  for (const k of all) {
    const mine = reports.filter((r) => r.args.p_kot_id === k.id);
    assert.equal(mine.length, 1, `one report for ${k.kot_no || k.kind}`);
    assert.equal(mine[0].args.p_ok, true);
    assert.equal(mine[0].args.p_hub, 'test-hub');
    assert.equal(mock.kot(k.id).print_attempts, 1);
  }
  assert.ok(mock.callsTo('hub_claim_kots').every((c) => c.args.p_hub === 'test-hub' && c.args.p_limit <= 20));
  assert.equal(ctx.state.counts.get(italian.id).printed, 3);
  assert.equal(ctx.state.counts.get(arabic.id).printed, 2);
  assert.equal(ctx.state.inFlight.size, 0);

  // a log line per job
  const log = fs.readFileSync(path.join(ctx.logDir, `printhub-${localDate()}.log`), 'utf8');
  assert.match(log, /PRINTED IT-001 Italian T8/);
  assert.match(log, /PRINTED TEST Arabic/);

  // the board shows the kitchens and counts
  const board = renderBoard(ctx.state, { logDir: ctx.logDir }).join('\n');
  assert.match(board, /Sharma Wedding/);
  assert.match(board, /Italian\s+127\.0\.0\.1:\d+\s+ONLINE\s+3\s+0/);
  assert.match(board, /CONNECTED/);
});

test('a KOT handed out again while still printing is not printed twice', async (t) => {
  // the server re-issues 'printing' KOTs after 200 ms here (45 s in real life)
  const ctx = await setup(t, { reclaimMs: 200 });
  const { mock, event } = ctx;
  const slow = await ctx.printer({ closeDelayMs: 900 });
  const k = mock.addKitchen({ event_id: event.id, name: 'Chinese', prefix: 'CH', printer_ip: '127.0.0.1', printer_port: slow.port });
  const a = mock.addKot({ kitchen: k, kot_no: 'CH-001', table_number: 1, items: [{ name: 'Noodles', qty: 1 }] });
  const b = mock.addKot({ kitchen: k, kot_no: 'CH-002', table_number: 2, items: [{ name: 'Rice', qty: 1 }] });

  ctx.start();
  await waitFor(() => [a, b].every((x) => mock.kot(x.id).print_status === 'printed'), 'both printed', 10_000);
  await sleep(400);
  assert.ok(mock.kot(b.id).print_attempts > 1, 'the server really did hand CH-002 out again');
  assert.equal(slow.jobs.length, 2, 'still only one paper per KOT');
});

test('printed but the server could not be told: kept until reported, never reprinted', async (t) => {
  const ctx = await setup(t, { reclaimMs: 200 });
  const { mock, event } = ctx;
  const p = await ctx.printer();
  const k = mock.addKitchen({ event_id: event.id, name: 'Indian', prefix: 'IN', printer_ip: '127.0.0.1', printer_port: p.port });
  mock.setMode('reports-down');
  const a = mock.addKot({ kitchen: k, kot_no: 'IN-001', table_number: 3, items: [{ name: 'Dal', qty: 1 }] });

  ctx.start();
  await waitFor(() => p.jobs.length === 1, 'printed');
  await waitFor(() => ctx.state.pendingReports.size === 1, 'result waiting for the server');
  await waitFor(() => mock.kot(a.id).print_attempts >= 3, 'server handed it out again (twice)');
  assert.equal(p.jobs.length, 1, 'not printed again while the report is pending');
  mock.setMode('up');
  await waitFor(() => mock.kot(a.id).print_status === 'printed', 'report delivered');
  await sleep(300);
  assert.equal(p.jobs.length, 1);
  assert.equal(ctx.state.pendingReports.size, 0);
  assert.equal(ctx.state.inFlight.size, 0);
});

test('closed port fails with a readable error; backup printer takes over; missing IP fails', async (t) => {
  const ctx = await setup(t);
  const { mock, event } = ctx;
  const dead1 = await closedPort();
  const dead2 = await closedPort();
  const backup = await ctx.printer();
  const chinese = mock.addKitchen({ event_id: event.id, name: 'Chinese', prefix: 'CH', printer_ip: '127.0.0.1', printer_port: dead1 });
  // backup written as ip:port (a real one would just be an IP on port 9100)
  const arabic = mock.addKitchen({
    event_id: event.id,
    name: 'Arabic',
    prefix: 'AR',
    printer_ip: '127.0.0.1',
    printer_port: dead2,
    backup_printer_ip: `127.0.0.1:${backup.port}`,
  });
  const indian = mock.addKitchen({ event_id: event.id, name: 'Indian', prefix: 'IN', printer_ip: null });
  const ch = mock.addKot({ kitchen: chinese, kot_no: 'CH-001', table_number: 4, items: [{ name: 'Noodles', qty: 1 }] });
  const ar = mock.addKot({ kitchen: arabic, kot_no: 'AR-001', table_number: 4, items: [{ name: 'Hummus', qty: 2 }] });
  const ind = mock.addKot({ kitchen: indian, kot_no: 'IN-001', table_number: 4, items: [{ name: 'Dal', qty: 1 }] });
  const tst = mock.addKot({ kitchen: arabic, kind: 'test' });
  const all = [ch, ar, ind, tst];

  ctx.start();
  await waitFor(() => all.every((k) => ['printed', 'failed'].includes(mock.kot(k.id).print_status)), 'all finished');

  assert.equal(mock.kot(ch.id).print_status, 'failed');
  assert.equal(mock.kot(ch.id).last_error, `Printer 127.0.0.1:${dead1} not reachable`);

  assert.equal(mock.kot(ar.id).print_status, 'printed', 'printed on the backup');
  const onBackup = jobTexts(backup);
  assert.equal(onBackup.length, 1, 'only the order went to the backup - never the test print');
  assert.ok(hasLine(onBackup[0], 'PRINTED ON BACKUP PRINTER (main printer down)'));
  assert.ok(hasLine(onBackup[0], /^KOT AR-001 /) && hasLine(onBackup[0], '2 x Hummus'));

  assert.equal(mock.kot(ind.id).print_status, 'failed');
  assert.equal(mock.kot(ind.id).last_error, 'No printer IP set for Indian');

  assert.equal(mock.kot(tst.id).print_status, 'failed', 'a test print is never sent to the backup');
  assert.match(mock.kot(tst.id).last_error, /not reachable/);

  const board = renderBoard(ctx.state).join('\n');
  assert.match(board, /FAILED\s+CH-001 Chinese T4 - Printer 127\.0\.0\.1:\d+ not reachable/);
  assert.match(board, /PRINTED AR-001 Arabic T4 on 127\.0\.0\.1:\d+ \(BACKUP\)/);
  assert.match(board, /Indian\s+no printer IP\s+NOT SET/);
});

test('health check reports offline, paper out and online; failed KOTs print when the printer is back', async (t) => {
  const ctx = await setup(t);
  const { mock, event } = ctx;
  const port = await closedPort();
  const italian = mock.addKitchen({ event_id: event.id, name: 'Italian', prefix: 'IT', printer_ip: '127.0.0.1', printer_port: port });
  const statusCalls = (s) =>
    mock
      .callsTo('hub_printer_status')
      .filter((c) => c.args.p_status === s && c.args.p_printer_ip === '127.0.0.1' && c.args.p_printer_port === port && c.args.p_event_id === event.id);

  ctx.start();
  await waitFor(() => statusCalls('offline').length === 1, 'offline reported');
  assert.equal(italian.printer_status, 'offline');
  await sleep(700);
  assert.equal(statusCalls('offline').length, 1, 'an unchanged status is not re-sent every check');

  const a = mock.addKot({ kitchen: italian, kot_no: 'IT-001', table_number: 8, items: [{ name: 'Pasta', qty: 1 }] });
  await waitFor(() => mock.kot(a.id).print_status === 'failed', 'IT-001 failed while printer is off');
  assert.match(mock.kot(a.id).last_error, /not reachable/);

  // printer switched on, but with no paper
  const printer = await ctx.printer({ port, status: 'paper_out' });
  await waitFor(() => statusCalls('paper_out').length === 1, 'paper_out reported');
  const b = mock.addKot({ kitchen: italian, kot_no: 'IT-002', table_number: 9, items: [{ name: 'Pizza', qty: 1 }] });
  await waitFor(() => mock.kot(b.id).print_status === 'failed', 'IT-002 failed: no paper');
  assert.equal(mock.kot(b.id).last_error, `Printer 127.0.0.1:${port} is out of paper`);
  assert.equal(printer.jobs.length + printer.refused.length, 0, 'nothing is sent to a printer without paper');

  // paper loaded: 'online' is reported and the server re-queues both failed KOTs
  printer.setStatus('online');
  await waitFor(() => statusCalls('online').length >= 1, 'online reported');
  await waitFor(() => [a, b].every((k) => mock.kot(k.id).print_status === 'printed'), 'failed KOTs printed after recovery');
  assert.equal(printer.jobs.length, 2);
  assert.ok(ctx.state.recent.some((r) => /is back - 2 failed KOT\(s\) sent again/.test(r.text)));

  // low paper is reported too (after an 'online' so failed KOTs are never stuck)
  printer.setStatus('paper_low');
  await waitFor(() => statusCalls('paper_low').length === 1, 'paper_low reported');
  assert.equal(italian.printer_status, 'paper_low');
});

test('printers sharing one IP (one laptop, several ports) each get their own status and reprints', async (t) => {
  const ctx = await setup(t);
  const { mock, event } = ctx;
  const p1 = await ctx.printer();
  const p2 = await ctx.printer({ status: 'paper_out' });
  const p3 = await ctx.printer();
  const italian = mock.addKitchen({ event_id: event.id, name: 'Italian', prefix: 'IT', printer_ip: '127.0.0.1', printer_port: p1.port });
  const arabic = mock.addKitchen({ event_id: event.id, name: 'Arabic', prefix: 'AR', printer_ip: '127.0.0.1', printer_port: p2.port });
  // the port written in the IP field also works ("ip:port")
  const indian = mock.addKitchen({ event_id: event.id, name: 'Indian', prefix: 'IN', printer_ip: `127.0.0.1:${p3.port}` });
  const statusOf = (k) => k.printer_status;

  ctx.start();
  await waitFor(() => statusOf(italian) === 'online' && statusOf(arabic) === 'paper_out' && statusOf(indian) === 'online', 'three different statuses');
  const calls = mock.callsTo('hub_printer_status');
  assert.ok(calls.every((c) => c.args.p_printer_ip === '127.0.0.1' && Number.isInteger(c.args.p_printer_port)), 'reported per ip + port');
  assert.deepEqual(new Set(calls.map((c) => c.args.p_printer_port)), new Set([p1.port, p2.port, p3.port]));

  const it = mock.addKot({ kitchen: italian, kot_no: 'IT-001', table_number: 1, items: [{ name: 'Pasta', qty: 1 }] });
  const ar = mock.addKot({ kitchen: arabic, kot_no: 'AR-001', table_number: 1, items: [{ name: 'Hummus', qty: 1 }] });
  await waitFor(() => mock.kot(it.id).print_status === 'printed' && mock.kot(ar.id).print_status === 'failed', 'Italian printed, Arabic failed');
  assert.equal(mock.kot(ar.id).last_error, `Printer 127.0.0.1:${p2.port} is out of paper`);
  assert.equal(statusOf(italian), 'online', 'Italian is not marked out of paper by its neighbour on the same IP');

  // paper loaded on the Arabic printer only: only its KOT comes back
  p2.setStatus('online');
  await waitFor(() => mock.kot(ar.id).print_status === 'printed', 'AR-001 printed after paper loaded');
  assert.equal(p2.jobs.length, 1);
  assert.equal(p1.jobs.length, 1, 'IT-001 was not printed twice');
  assert.equal(statusOf(arabic), 'online');

  // power cut on the Indian printer
  await p3.switchOff();
  await waitFor(() => statusOf(indian) === 'offline', 'Indian offline');
  assert.equal(statusOf(italian), 'online');
  assert.equal(statusOf(arabic), 'online');
  const board = renderBoard(ctx.state).join('\n');
  assert.match(board, new RegExp(`Indian\\s+127\\.0\\.0\\.1:${p3.port}\\s+OFFLINE`));
  assert.match(board, new RegExp(`Italian\\s+127\\.0\\.0\\.1:${p1.port}\\s+ONLINE`));
});

test('a server with the old printer-status function (no port) still gets status reports', async (t) => {
  const ctx = await setup(t, { legacyStatus: true });
  const { mock, event } = ctx;
  const port = await closedPort();
  const italian = mock.addKitchen({ event_id: event.id, name: 'Italian', prefix: 'IT', printer_ip: '127.0.0.1', printer_port: port });
  ctx.start();
  await waitFor(() => italian.printer_status === 'offline', 'offline reported the old way');
  const calls = mock.callsTo('hub_printer_status');
  assert.ok(calls.some((c) => !('p_printer_port' in c.args) && c.args.p_printer_ip === '127.0.0.1'));
  assert.equal(calls.filter((c) => 'p_printer_port' in c.args).length, 1, 'the new form is tried once, then not again');
  assert.ok(ctx.state.recent.some((r) => /old printer-status function/.test(r.text)), 'the operator is told');
  const a = mock.addKot({ kitchen: italian, kot_no: 'IT-001', table_number: 1, items: [{ name: 'Pasta', qty: 1 }] });
  await waitFor(() => mock.kot(a.id).print_status === 'failed', 'failed while offline');
  const printer = await ctx.printer({ port });
  await waitFor(() => mock.kot(a.id).print_status === 'printed', 'reprinted after the old-style online report');
  assert.equal(printer.jobs.length, 1);
});

test('server unreachable: the hub says so, keeps running and recovers by itself', async (t) => {
  const ctx = await setup(t);
  const { mock, event } = ctx;
  const p = await ctx.printer();
  const k = mock.addKitchen({ event_id: event.id, name: 'Italian', prefix: 'IT', printer_ip: '127.0.0.1', printer_port: p.port });
  mock.setMode('down');
  ctx.start();
  await waitFor(() => ctx.state.server.reachable === false, 'marked unreachable');
  const board = renderBoard(ctx.state).join('\n');
  assert.match(board, /CANNOT REACH SERVER - RETRYING/);
  assert.match(board, /NOT REACHABLE/);

  const a = mock.addKot({ kitchen: k, kot_no: 'IT-001', table_number: 1, items: [{ name: 'Pasta', qty: 1 }] });
  mock.setMode('up');
  await waitFor(() => mock.kot(a.id).print_status === 'printed', 'printed after the server came back');
  assert.equal(ctx.state.server.reachable, true);
  assert.ok(ctx.state.recent.some((r) => r.text === 'Server reachable again'));
  assert.equal(p.jobs.length, 1);
});

test('auto mode only picks multi-kitchen events dated today', async (t) => {
  const ctx = await setup(t);
  const { mock, event } = ctx;
  const p = await ctx.printer();
  const other = mock.addEvent({ name: 'Old Event', date: '2020-01-01' });
  const plain = mock.addEvent({ name: 'Guest Event', date: localDate(), multi_kitchen: false });
  for (const ev of [event, other, plain]) {
    const k = mock.addKitchen({ event_id: ev.id, name: `K-${ev.name}`, printer_ip: '127.0.0.1', printer_port: p.port });
    mock.addKot({ kitchen: k, kot_no: `${ev.name}-1`, table_number: 1, items: [{ name: 'X', qty: 1 }] });
  }
  ctx.start();
  await waitFor(() => p.jobs.length === 1, 'today\'s KOT printed');
  await sleep(400);
  assert.equal(p.jobs.length, 1);
  assert.ok(mock.callsTo('hub_claim_kots').every((c) => c.args.p_event_id === event.id));
  assert.ok(mock.callsTo('GET events').every((c) => c.args.multi_kitchen === 'eq.true' && /^eq\.\d{4}-\d\d-\d\d$/.test(c.args.date)));
});

test('a fixed event id (--event) is used even if not dated today', async (t) => {
  const ctx = await setup(t);
  const { mock } = ctx;
  const p = await ctx.printer();
  const other = mock.addEvent({ name: 'Rehearsal', date: '2020-01-01' });
  const k = mock.addKitchen({ event_id: other.id, name: 'Italian', printer_ip: `127.0.0.1:${p.port}` });
  mock.addKot({ kitchen: k, kot_no: 'IT-009', table_number: 1, items: [{ name: 'X', qty: 1 }] });
  ctx.start({ eventId: other.id });
  await waitFor(() => p.jobs.length === 1, 'KOT for the chosen event printed');
  assert.ok(hasLine(jobTexts(p)[0], /^KOT IT-009 /));
});

test('helpers: endpoints, errors and an offline probe', async () => {
  assert.deepEqual(parseEndpoint('192.168.1.104', 9100), {
    text: '192.168.1.104',
    host: '192.168.1.104',
    port: 9100,
    key: '192.168.1.104:9100',
    label: '192.168.1.104',
  });
  assert.equal(parseEndpoint(' 192.168.1.20:9101 ', 9100).key, '192.168.1.20:9101');
  assert.equal(parseEndpoint('', 9100), null);
  assert.equal(parseEndpoint(null), null);
  const ep = parseEndpoint('192.168.1.104');
  assert.equal(printerError({ code: 'ECONNREFUSED' }, ep), 'Printer 192.168.1.104 not reachable');
  assert.equal(printerError({ code: 'CONNECT_TIMEOUT' }, ep), 'Printer 192.168.1.104 not reachable');
  assert.equal(printerError({ code: 'JOB_TIMEOUT' }, ep), 'Printer 192.168.1.104 timed out');
  assert.equal(printerError({ code: 'PAPER_OUT' }, ep), 'Printer 192.168.1.104 is out of paper');
  assert.equal(await probePrinter(parseEndpoint(`127.0.0.1:${await closedPort()}`), { connectTimeoutMs: 500 }), 'offline');
  const silent = await startFakePrinter({ host: '127.0.0.1', quiet: true, status: 'silent' });
  try {
    assert.equal(await probePrinter(parseEndpoint(`127.0.0.1:${silent.port}`), { statusReplyMs: 200 }), 'online', 'no answer but connected = online');
  } finally {
    await silent.close();
  }
});

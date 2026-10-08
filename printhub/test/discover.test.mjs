import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normMac, parseArp, scanHosts, findPrinters } from '../discover.mjs';
import { startFakePrinter } from '../fake-printer.mjs';

test('MAC addresses are normalised', () => {
  assert.equal(normMac('0:11:62:a:b:c'), '00:11:62:0a:0b:0c'); // macOS drops leading zeros
  assert.equal(normMac('00-11-62-0A-0B-0C'), '00:11:62:0a:0b:0c'); // Windows
  assert.equal(normMac('(incomplete)'), null);
  assert.equal(normMac('ff:ff:ff:ff:ff:ff'), null);
});

test('ARP tables of macOS, Windows and Linux are read', () => {
  const mac = `? (192.168.1.1) at 4c:ed:fb:12:34:56 on en0 ifscope [ethernet]
? (192.168.1.23) at 0:11:62:a:b:c on en0 ifscope [ethernet]
? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]`;
  const win = `Interface: 192.168.1.5 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.23          00-11-62-0a-0b-0c     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static`;
  const linux = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.23     0x1         0x2         00:11:62:0a:0b:0c     *        wlan0`;
  for (const [name, text] of [['mac', mac], ['windows', win], ['linux', linux]]) {
    const m = parseArp(text);
    assert.equal(m.get('192.168.1.23'), '00:11:62:0a:0b:0c', name);
    assert.equal(m.has('192.168.1.99'), false, name);
    assert.equal(m.has('192.168.1.255'), false, name);
  }
});

test('the laptop network is scanned as a /24 at most, plus the printers already set up', () => {
  const interfaces = {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true, cidr: '127.0.0.1/8' }],
    en0: [{ family: 'IPv4', address: '10.20.30.40', internal: false, cidr: '10.20.30.40/16' }],
    en1: [{ family: 'IPv4', address: '192.168.7.9', internal: false, netmask: '255.255.255.248' }],
    awdl: [{ family: 'IPv4', address: '169.254.3.3', internal: false, cidr: '169.254.3.3/16' }],
  };
  const hosts = scanHosts({ interfaces, extraHosts: ['172.16.0.5'] });
  assert.ok(hosts.includes('10.20.30.1') && hosts.includes('10.20.30.254'));
  assert.ok(!hosts.includes('10.20.31.1'), 'a /16 is cut to the /24 around the laptop');
  assert.ok(!hosts.includes('10.20.30.40'), 'not the laptop itself');
  assert.ok(hosts.includes('192.168.7.14') && !hosts.includes('192.168.7.16'), 'a /29 stays a /29');
  assert.ok(!hosts.some((h) => h.startsWith('127.') || h.startsWith('169.254.')));
  assert.ok(hosts.includes('172.16.0.5'));
  assert.equal(hosts.length, 254 - 1 + 6 - 1 + 1);
});

test('printers answering on the port are found, with their paper status and MAC', async (t) => {
  const a = await startFakePrinter({ host: '127.0.0.1', quiet: true });
  const b = await startFakePrinter({ host: '127.0.0.1', quiet: true, status: 'paper_low' });
  t.after(async () => { await a.close(); await b.close(); });
  const found = await findPrinters({
    hosts: [`127.0.0.1:${a.port}`, `127.0.0.1:${b.port}`, '127.0.0.1:1'],
    timeoutMs: 300,
    arp: async () => new Map([['127.0.0.1', '00:11:62:0a:0b:0c']]),
  });
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.ip).sort(), [`127.0.0.1:${a.port}`, `127.0.0.1:${b.port}`].sort());
  assert.ok(found.every((f) => f.mac === '00:11:62:0a:0b:0c'));
  assert.equal(found.find((f) => f.port === b.port).status, 'paper_low');
  assert.equal(found.find((f) => f.port === a.port).status, 'online');
  assert.equal(a.jobs.length + b.jobs.length, 0, 'a search prints nothing');
});

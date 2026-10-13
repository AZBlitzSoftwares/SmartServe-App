import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobIdOf, uuidOfJob, printRequestXml, parseResponseFile, formOf, reasonOf } from '../sdp.mjs';
import { buildKot, decodeEscPos } from '../escpos.mjs';

test('server direct print: KOT id <-> print job id (25 characters, back to the same id)', () => {
  for (const id of ['00000000-0000-4000-8000-0000000de304', 'ffffffff-ffff-4fff-bfff-ffffffffffff', '9b2c6f1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f']) {
    const j = jobIdOf(id);
    assert.match(j, /^[0-9a-z]{25}$/);
    assert.equal(uuidOfJob(j), id);
  }
  assert.equal(jobIdOf('not-a-uuid'), null);
  assert.equal(uuidOfJob('bad id!'), null);
});

test('server direct print: one ePOSPrint per KOT, the KOT as raw ESC/POS, nothing when empty', () => {
  assert.equal(printRequestXml([]), '');
  const bytes = buildKot({ kind: 'test', kot_no: 'TEST', kitchen_name: 'Italian', items: [] }, { now: new Date() });
  const x = printRequestXml([{ jobId: 'abc', bytes }, { jobId: 'def', bytes }]);
  assert.match(x, /^<\?xml version="1.0" encoding="utf-8"\?>/);
  assert.match(x, /<PrintRequestInfo Version="2.00">/);
  assert.equal((x.match(/<ePOSPrint>/g) || []).length, 2);
  assert.match(x, /<devid>local_printer<\/devid>/);
  assert.match(x, /<printjobid>abc<\/printjobid>/);
  assert.match(x, /<epos-print xmlns="http:\/\/www.epson-pos.com\/schemas\/2011\/03\/epos-print"><command>[0-9a-f]+<\/command><\/epos-print>/);
  // the hex is the exact KOT
  const hex = x.match(/<command>([0-9a-f]+)<\/command>/)[1];
  const back = Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
  assert.deepEqual(decodeEscPos(back).lines.map((l) => l.text), decodeEscPos(bytes).lines.map((l) => l.text));
});

test('server direct print: the printer report, version 2.00 and older', () => {
  const v2 = '<PrintResponseInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><printjobid>abc</printjobid></Parameter>' +
    '<PrintResponse><response success="true" code="" status="251658262" battery="0" xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"/></PrintResponse></ePOSPrint>' +
    '<ePOSPrint><Parameter><devid>local_printer</devid><printjobid>def</printjobid></Parameter>' +
    '<PrintResponse><response success="false" code="EPTR_REC_EMPTY" status="0" battery="0"/></PrintResponse></ePOSPrint></PrintResponseInfo>';
  assert.deepEqual(parseResponseFile(v2), [
    { jobId: 'abc', ok: true, code: '', status: '251658262' },
    { jobId: 'def', ok: false, code: 'EPTR_REC_EMPTY', status: '0' },
  ]);
  const v1 = '<PrintResponseInfo Version="1.00"><response success="true" code="" status="0" battery="0"/></PrintResponseInfo>';
  assert.deepEqual(parseResponseFile(v1), [{ jobId: null, ok: true, code: '', status: '0' }]);
  assert.equal(reasonOf('EPTR_REC_EMPTY'), 'printer out of paper');
});

test('server direct print: the request fields, form-encoded or already parsed', () => {
  assert.deepEqual(formOf('ConnectionType=GetRequest&ID=ITALIAN-1'), { ConnectionType: 'GetRequest', ID: 'ITALIAN-1' });
  assert.deepEqual(formOf({ ConnectionType: 'SetResponse', ID: 'X' }, { a: '1' }), { a: '1', ConnectionType: 'SetResponse', ID: 'X' });
});

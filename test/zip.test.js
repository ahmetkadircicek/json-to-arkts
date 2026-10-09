import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, createZip } from '../src/zip.js';

// Reads a stored (uncompressed) ZIP back through its central directory.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central directory entry');
    assert.equal(view.getUint16(at + 10, true), 0, 'stored');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, 'local header');
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    files.push({ name, content: decoder.decode(data) });
    at += 46 + nameLength;
  }
  return files;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('round-trips files, including UTF-8 names and content', () => {
  const files = [
    { name: 'Root.ets', content: 'export class Root {}\n' },
    { name: 'ÜrünAdı.ets', content: "const a: string = 'çğış';\n" },
    { name: 'Empty.ets', content: '' },
  ];
  assert.deepEqual(readZip(createZip(files, new Date(2026, 9, 15, 12, 30, 10))), files);
});

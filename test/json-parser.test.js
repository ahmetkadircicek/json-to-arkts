import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatJson, JsonParseError, locate, parseJson, toPlain } from '../src/json-parser.js';

const parse = (text) => toPlain(parseJson(text).value);

function parseError(text) {
  try {
    parseJson(text);
  } catch (error) {
    assert.ok(error instanceof JsonParseError, `expected JsonParseError, got ${error}`);
    return { message: error.message, line: error.line, column: error.column };
  }
  assert.fail(`expected ${JSON.stringify(text)} to fail`);
}

test('parses the same values as JSON.parse', () => {
  const samples = [
    '{"a":1,"b":[true,false,null],"c":{"d":"e"}}',
    '[1, -2, 3.5, 1e3, -0.5E-2, 0]',
    '"text with \\"quotes\\", \\\\ \\/ \\b\\f\\n\\r\\t and \\u00e7\\ud83d\\ude00"',
    '  \n\t{ "nested" : { "deep" : [ [ [ ] ] ] } }  ',
    '﻿{"bom": true}',
    '{"ünicode": "çğış"}',
  ];
  for (const text of samples) assert.deepEqual(parse(text), JSON.parse(text.replace(/^﻿/, '')));
});

test('keeps keys in written order, including integer-like keys', () => {
  const { value } = parseJson('{"b": 1, "2": 2, "a": 3, "1": 4}');
  assert.deepEqual(
    value.entries.map((e) => e.key),
    ['b', '2', 'a', '1'],
  );
});

test('keeps the raw text of numbers', () => {
  const { value } = parseJson('[1.0, 12345678901234567890, -0]');
  assert.deepEqual(
    value.items.map((n) => n.raw),
    ['1.0', '12345678901234567890', '-0'],
  );
});

test('reports duplicate keys and keeps the last value at the first position', () => {
  const { value, warnings } = parseJson('{"a": 1, "b": 2, "a": 3}');
  assert.deepEqual(toPlain(value), { a: 3, b: 2 });
  assert.deepEqual(
    value.entries.map((e) => e.key),
    ['a', 'b'],
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /Duplicate key "a"/);
  assert.equal(warnings[0].column, 18);
});

test('reports errors with line and column', () => {
  assert.deepEqual(parseError('{\n  "a": 1,\n  "b": [1, 2,]\n}'), {
    message: 'Trailing comma is not allowed in JSON',
    line: 3,
    column: 14,
  });
  assert.deepEqual(parseError('{"a": 1,}'), { message: 'Trailing comma is not allowed in JSON', line: 1, column: 9 });
  assert.deepEqual(parseError('{"a": 1 "b": 2}'), {
    message: "Expected ',' or '}' after the property value, found '\"'",
    line: 1,
    column: 9,
  });
  assert.deepEqual(parseError('{a: 1}'), {
    message: "Expected a property name in double quotes, found 'a'",
    line: 1,
    column: 2,
  });
  assert.deepEqual(parseError("{'a': 1}"), { message: 'Property names must use double quotes', line: 1, column: 2 });
  assert.deepEqual(parseError('{"a": \'x\'}'), { message: 'Strings must use double quotes', line: 1, column: 7 });
  assert.deepEqual(parseError('{"a": "x'), { message: 'Unterminated string', line: 1, column: 7 });
  assert.deepEqual(parseError('{"a": "x\ny"}'), { message: 'Line break inside a string; use \\n instead', line: 1, column: 9 });
  assert.deepEqual(parseError('{"a": "\\x"}'), { message: "Invalid escape sequence '\\x'", line: 1, column: 8 });
  assert.deepEqual(parseError('{"a": "\\u12"}'), {
    message: 'Invalid Unicode escape, expected four hex digits after \\u',
    line: 1,
    column: 8,
  });
  assert.deepEqual(parseError('[01]'), { message: 'Numbers cannot have leading zeros', line: 1, column: 2 });
  assert.deepEqual(parseError('[1.]'), { message: 'Expected a digit after the decimal point', line: 1, column: 4 });
  assert.deepEqual(parseError('[1e]'), { message: 'Expected a digit in the exponent', line: 1, column: 4 });
  assert.deepEqual(parseError('[-]'), { message: "Expected a digit after '-'", line: 1, column: 2 });
  assert.deepEqual(parseError('{"a": undefined}'), { message: "'undefined' is not valid in JSON", line: 1, column: 7 });
  assert.deepEqual(parseError('{"a": tru}'), { message: "Unexpected word 'tru', expected a value", line: 1, column: 7 });
  assert.deepEqual(parseError('{"a": 1} // note'), {
    message: "Unexpected '/' after the end of the JSON value",
    line: 1,
    column: 10,
  });
  assert.deepEqual(parseError('// note\n{}'), { message: 'Comments are not allowed in JSON', line: 1, column: 1 });
  assert.deepEqual(parseError('{"a": 1'), { message: "Unexpected end of input, expected ',' or '}'", line: 1, column: 8 });
  assert.deepEqual(parseError('[1, 2'), { message: "Unexpected end of input, expected ',' or ']'", line: 1, column: 6 });
  assert.deepEqual(parseError('{"a":'), { message: 'Unexpected end of input, expected a value', line: 1, column: 6 });
  assert.deepEqual(parseError('{"a" 1}'), { message: "Expected ':' after the property name, found '1'", line: 1, column: 6 });
  assert.deepEqual(parseError('   '), { message: 'The input is empty', line: 1, column: 4 });
  assert.deepEqual(parseError('{"a": "\u0001"}'), { message: 'Control characters must be escaped in strings', line: 1, column: 8 });
});

test('rejects nesting deeper than the limit instead of overflowing the stack', () => {
  const error = parseError(`${'['.repeat(600)}${']'.repeat(600)}`);
  assert.match(error.message, /Nesting is deeper than 512 levels/);
});

test('locates offsets across line breaks', () => {
  assert.deepEqual(locate('ab\ncd\r\nef', 0), { line: 1, column: 1 });
  assert.deepEqual(locate('ab\ncd\r\nef', 3), { line: 2, column: 1 });
  assert.deepEqual(locate('ab\ncd\r\nef', 8), { line: 3, column: 2 });
});

test('formats with two spaces, keeping order and number text', () => {
  const { value } = parseJson('{"b":[1.50,{"x":null}],"a":{},"c":[],"d":"\\u00e7\\n"}');
  assert.equal(
    formatJson(value),
    ['{', '  "b": [', '    1.50,', '    {', '      "x": null', '    }', '  ],', '  "a": {},', '  "c": [],', '  "d": "ç\\n"', '}'].join('\n'),
  );
});

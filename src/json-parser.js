// A strict JSON parser. Unlike JSON.parse it keeps the key order exactly as
// written (JSON.parse moves integer-like keys first), keeps the raw text of
// numbers, and reports errors with a line and column in the same words in
// every browser.

const MAX_DEPTH = 512;

export class JsonParseError extends Error {
  constructor(message, offset, line, column) {
    super(message);
    this.name = 'JsonParseError';
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

/** Line and column (both from 1) of an offset in text. */
export function locate(text, offset) {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /[A-Za-z_$][\w$]*/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Parses JSON text into a tree of nodes:
 *   { type: 'object', entries: [{ key, value }] }
 *   { type: 'array', items: [node] }
 *   { type: 'string', value } | { type: 'number', value, raw }
 *   { type: 'boolean', value } | { type: 'null' }
 * Returns { value, warnings } where warnings are { message, line, column }.
 * Throws JsonParseError on invalid input.
 */
export function parseJson(text) {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let depth = 0;
  const warnings = [];

  const fail = (message, at = i) => {
    const { line, column } = locate(text, at);
    throw new JsonParseError(message, at, line, column);
  };

  const found = (at = i) => {
    if (at >= n) return 'the end of the input';
    const code = text.charCodeAt(at);
    if (code < 32) return `a control character (U+${code.toString(16).toUpperCase().padStart(4, '0')})`;
    return `'${text[at]}'`;
  };

  const skipWhitespace = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  const enter = () => {
    if (++depth > MAX_DEPTH) fail(`Nesting is deeper than ${MAX_DEPTH} levels`);
  };

  function parseValue() {
    skipWhitespace();
    if (i >= n) fail('Unexpected end of input, expected a value');
    const c = text[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return { type: 'string', value: parseString() };
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (c === "'") fail('Strings must use double quotes');
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('Comments are not allowed in JSON');
    WORD.lastIndex = i;
    const word = WORD.exec(text);
    if (word) {
      const w = word[0];
      if (w === 'true' || w === 'false') {
        i += w.length;
        return { type: 'boolean', value: w === 'true' };
      }
      if (w === 'null') {
        i += 4;
        return { type: 'null' };
      }
      if (w === 'undefined' || w === 'NaN' || w === 'Infinity') fail(`'${w}' is not valid in JSON`);
      fail(`Unexpected word '${w}', expected a value`);
    }
    fail(`Unexpected ${found()}, expected a value`);
  }

  function parseObject() {
    enter();
    i++;
    const entries = [];
    const index = new Map();
    skipWhitespace();
    if (text[i] === '}') {
      i++;
      depth--;
      return { type: 'object', entries };
    }
    for (;;) {
      skipWhitespace();
      if (text[i] !== '"') {
        if (text[i] === '}') fail('Trailing comma is not allowed in JSON');
        if (i >= n) fail('Unexpected end of input, expected a property name');
        if (text[i] === "'") fail('Property names must use double quotes');
        fail(`Expected a property name in double quotes, found ${found()}`);
      }
      const keyAt = i;
      const key = parseString();
      skipWhitespace();
      if (text[i] !== ':') fail(`Expected ':' after the property name, found ${found()}`);
      i++;
      const value = parseValue();
      if (index.has(key)) {
        // Same as JSON.parse: the first position, the last value.
        entries[index.get(key)].value = value;
        warnings.push({ message: `Duplicate key "${key}"; the last value is used`, ...locate(text, keyAt) });
      } else {
        index.set(key, entries.length);
        entries.push({ key, value });
      }
      skipWhitespace();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        depth--;
        return { type: 'object', entries };
      }
      if (i >= n) fail("Unexpected end of input, expected ',' or '}'");
      fail(`Expected ',' or '}' after the property value, found ${found()}`);
    }
  }

  function parseArray() {
    enter();
    i++;
    const items = [];
    skipWhitespace();
    if (text[i] === ']') {
      i++;
      depth--;
      return { type: 'array', items };
    }
    for (;;) {
      skipWhitespace();
      if (text[i] === ']') fail('Trailing comma is not allowed in JSON');
      items.push(parseValue());
      skipWhitespace();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        depth--;
        return { type: 'array', items };
      }
      if (i >= n) fail("Unexpected end of input, expected ',' or ']'");
      fail(`Expected ',' or ']' after the list item, found ${found()}`);
    }
  }

  function parseString() {
    const start = i;
    i++;
    let out = '';
    let chunk = i;
    for (;;) {
      if (i >= n) fail('Unterminated string', start);
      const code = text.charCodeAt(i);
      if (code === 34) {
        out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (code === 92) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid Unicode escape, expected four hex digits after \\u');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
          out += ESCAPES[e];
          i += 2;
        } else {
          fail(e === undefined ? 'Unterminated string' : `Invalid escape sequence '\\${e}'`, e === undefined ? start : i);
        }
        chunk = i;
        continue;
      }
      if (code < 32) {
        fail(code === 10 || code === 13 ? 'Line break inside a string; use \\n instead' : 'Control characters must be escaped in strings');
      }
      i++;
    }
  }

  function parseNumber() {
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text);
    if (!match) fail(text[i] === '-' ? "Expected a digit after '-'" : 'Invalid number');
    const raw = match[0];
    const next = text[i + raw.length];
    if (raw === '0' || raw === '-0' || /^-?0[.eE]/.test(raw)) {
      if (next >= '0' && next <= '9') fail('Numbers cannot have leading zeros', i);
    }
    if (next === '.') {
      fail(/[.eE]/.test(raw) ? 'Invalid number' : 'Expected a digit after the decimal point', i + raw.length + 1);
    }
    if (next === 'e' || next === 'E') {
      fail(/[eE]/.test(raw) ? 'Invalid number' : 'Expected a digit in the exponent', i + raw.length + 1);
    }
    i += raw.length;
    return { type: 'number', value: Number(raw), raw };
  }

  skipWhitespace();
  if (i >= n) fail('The input is empty');
  const value = parseValue();
  skipWhitespace();
  if (i < n) fail(`Unexpected ${found()} after the end of the JSON value`);
  return { value, warnings };
}

/** Pretty prints a parsed tree, keeping key order and number text. */
export function formatJson(node, indent = 2) {
  const unit = ' '.repeat(indent);
  const write = (value, level) => {
    switch (value.type) {
      case 'object': {
        if (value.entries.length === 0) return '{}';
        const inner = unit.repeat(level + 1);
        const body = value.entries.map((e) => `${inner}${JSON.stringify(e.key)}: ${write(e.value, level + 1)}`);
        return `{\n${body.join(',\n')}\n${unit.repeat(level)}}`;
      }
      case 'array': {
        if (value.items.length === 0) return '[]';
        const inner = unit.repeat(level + 1);
        const body = value.items.map((item) => `${inner}${write(item, level + 1)}`);
        return `[\n${body.join(',\n')}\n${unit.repeat(level)}]`;
      }
      case 'string':
        return JSON.stringify(value.value);
      case 'number':
        return value.raw;
      case 'boolean':
        return String(value.value);
      default:
        return 'null';
    }
  };
  return write(node, 0);
}

/** Converts a parsed tree back to a plain JavaScript value. */
export function toPlain(node) {
  switch (node.type) {
    case 'object': {
      const out = {};
      for (const { key, value } of node.entries) out[key] = toPlain(value);
      return out;
    }
    case 'array':
      return node.items.map(toPlain);
    case 'null':
      return null;
    default:
      return node.value;
  }
}

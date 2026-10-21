// Random JSON through the converter. Two checks:
//  1. every generated file passes the ArkTS compiler checks, with random options;
//  2. for JSON the classes can represent exactly (no null, empty list, mixed
//     type or missing key), toJson(fromJson(json)) gives the JSON back.
// The generator is seeded, so a failure always repeats; the seed is in the message.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { convertJson } from '../src/converter.js';
import { checkArkTS } from './arkts-check.js';

const require = createRequire(import.meta.url);
const ts = require('ohos-typescript');

// mulberry32: a small seeded generator.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = [
  'id', 'name', 'user_name', 'userName', 'first-name', 'first_name', 'class', 'default', 'delete', 'constructor',
  'toJson', 'fromJson', 'image', 'text', 'list', 'data', 'items', 'categories', 'children', 'status', 'Text',
  'Image', 'Link', 'Column', 'Row', 'Object', 'Array', 'String', '2fa', '$ref', "it's", 'a b', 'ürün_adı', 'ID',
  'URL', 'HTTPCode', '', '__proto__', 'x', 'y', 'value', 'type', 'new', 'this', 'null', 'address', 'geo',
];

function generate(rand, depth, strict) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const scalar = () => {
    const kind = pick(strict ? ['s', 'n', 'b'] : ['s', 'n', 'b', 'null', 's', 'n']);
    if (kind === 's') return pick(['', 'text', 'ç ğ ı', '"quoted"', 'line\nbreak', '2026-10-21T12:00:00Z']);
    if (kind === 'n') return pick([0, 1, -2, 3.5, 1e21, 12345]);
    if (kind === 'b') return rand() < 0.5;
    return null;
  };
  const object = (d) => {
    const out = {};
    const count = 1 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const key = pick(KEYS);
      if (key === '__proto__') Object.defineProperty(out, key, { value: value(d + 1), enumerable: true, writable: true, configurable: true });
      else out[key] = value(d + 1);
    }
    return out;
  };
  // Every list item has the same shape in strict mode, as the classes need.
  const list = (d) => {
    const count = strict ? 1 + Math.floor(rand() * 3) : Math.floor(rand() * 4);
    if (strict) {
      const first = value(d + 1, true);
      return Array.from({ length: count }, (_, i) => (i === 0 ? first : structuredCloneSafe(first)));
    }
    return Array.from({ length: count }, () => value(d + 1));
  };
  const value = (d, noList) => {
    if (d >= depth) return scalar();
    const r = rand();
    if (r < 0.4) return scalar();
    if (r < 0.75) return object(d);
    return noList && strict ? scalar() : list(d);
  };
  return object(0);
}

const structuredCloneSafe = (v) => JSON.parse(JSON.stringify(v), (k, x) => x);

function stringify(value) {
  // JSON.stringify drops nothing here; __proto__ is an own property set above.
  return JSON.stringify(value);
}

function randomOptions(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const output = rand() < 0.25 ? 'interface' : 'class';
  const filePerClass = rand() < 0.3;
  return {
    output,
    nullStyle: pick(['default', 'optional', 'nullable']),
    privateFields: rand() < 0.4,
    observed: pick(['none', 'v1', 'v2']),
    camelCase: rand() < 0.6,
    exportClasses: filePerClass ? true : rand() < 0.7,
    filePerClass,
  };
}

const CASES = 160;
const SEED = Number(process.env.FUZZ_SEED) || 20261021;

test(`random JSON passes the ArkTS checks (${CASES} cases, seed ${SEED})`, () => {
  const rand = random(SEED);
  const projects = [];
  for (let i = 0; i < CASES; i++) {
    const json = stringify(generate(rand, 1 + Math.floor(rand() * 4), false));
    const options = randomOptions(rand);
    let result;
    try {
      result = convertJson(json, options);
    } catch (error) {
      // Only an empty or scalar top level may be refused, and never by a crash.
      assert.ok(error.name === 'ConvertError', `case ${i}: ${error.stack}\\n${json}`);
      continue;
    }
    const files = result.files.map((file) => ({ ...file }));
    if (!options.exportClasses) files[0].content += '\nexport {};\n';
    projects.push({ name: `case${i}`, files, json, options });
  }
  const diagnostics = checkArkTS(projects.map(({ name, files }) => ({ name, files })));
  const failing = new Set(diagnostics.map((d) => d.split('/')[0]));
  const first = projects.find((p) => failing.has(p.name));
  assert.deepEqual(diagnostics.slice(0, 5), [], first ? `${diagnostics.length} diagnostics; first failing: ${first.json} with ${JSON.stringify(first.options)}` : '');
});

test(`fromJson and toJson round-trip random JSON (${CASES} cases, seed ${SEED})`, () => {
  const rand = random(SEED + 1);
  const load = (code) => {
    const { outputText } = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } });
    const module = { exports: {} };
    new Function('module', 'exports', 'Observed', 'ObservedV2', 'Trace', outputText)(module, module.exports, (c) => c, (c) => c, () => {});
    return module.exports;
  };
  let checked = 0;
  for (let i = 0; i < CASES; i++) {
    const data = generate(rand, 1 + Math.floor(rand() * 3), true);
    const json = stringify(data);
    const options = { ...randomOptions(rand), output: 'class', filePerClass: false, exportClasses: true, nullStyle: 'default', camelCase: rand() < 0.5 };
    const result = convertJson(json, options);
    // Hints about unknown, mixed or null values mean the sample is not exact; skip it.
    if (result.warnings.some((w) => /null|empty|mixes|built-in|larger/.test(w.message))) continue;
    const classes = load(result.files[0].content);
    const Root = classes[result.classNames[0]];
    const back = JSON.parse(JSON.stringify(Root.fromJson(JSON.parse(json)).toJson()));
    assert.deepEqual(back, JSON.parse(json), `case ${i}: ${json} with ${JSON.stringify(options)}`);
    checked++;
  }
  assert.ok(checked >= CASES / 4, `only ${checked} of ${CASES} cases were exact enough to check`);
});

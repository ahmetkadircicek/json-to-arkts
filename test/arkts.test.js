// The generated code against the ArkTS compiler's own checks, for every
// combination of options, and run for real to see fromJson and toJson
// round-trip the JSON.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { convertJson } from '../src/converter.js';
import { checkArkTS } from './arkts-check.js';

const require = createRequire(import.meta.url);
const ts = require('ohos-typescript');

const FIXTURES = ['profile.json', 'weather.json', 'list.json', 'tricky.json'];
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function* combinations() {
  for (const nullStyle of ['default', 'optional', 'nullable'])
    for (const privateFields of [false, true])
      for (const observed of ['none', 'v1', 'v2'])
        for (const camelCase of [true, false])
          for (const exportClasses of [true, false])
            for (const filePerClass of [false, true]) {
              if (filePerClass && !exportClasses) continue;
              yield { nullStyle, privateFields, observed, camelCase, exportClasses, filePerClass };
            }
}

const label = (options) =>
  Object.entries(options)
    .map(([key, value]) => `${key}-${value}`)
    .join('_');

// The usage snippet as a function, so its code is checked too.
function usageFile(result) {
  const root = result.classNames[0];
  const body = result.usage
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .map((line) => (line ? `  ${line}` : ''))
    .join('\n');
  return {
    name: 'Usage.ets',
    content: `import { ${root} } from './${root}';\n\nexport function convert(text: string): string {\n${body}\n  return output;\n}\n`,
  };
}

test('the checker reports ArkTS errors (control)', () => {
  const diagnostics = checkArkTS([
    { name: 'control', files: [{ name: 'Bad.ets', content: 'let a: any = 1;\nlet o = { x: 1 };\nconst n: number = "1";\nexport {};\n' }] },
  ]);
  assert.equal(diagnostics.length, 3, diagnostics.join('\n'));
  assert.ok(diagnostics.some((d) => d.includes('arkts-no-any-unknown')));
  assert.ok(diagnostics.some((d) => d.includes('arkts-no-untyped-obj-literals')));
});

test('every fixture with every option combination passes the ArkTS checks', () => {
  const projects = [];
  for (const name of FIXTURES) {
    for (const options of combinations()) {
      const result = convertJson(fixture(name), options);
      const files = result.files.map((file) => ({ ...file }));
      if (options.exportClasses) {
        files.push(usageFile(result));
      } else {
        // Without exports a file is a script; keep each one in its own scope.
        files[0].content += '\nexport {};\n';
      }
      projects.push({ name: `${name.replace('.json', '')}/${label(options)}`, files });
    }
  }
  const diagnostics = checkArkTS(projects);
  assert.deepEqual(diagnostics.slice(0, 20), [], `${diagnostics.length} diagnostics`);
});

// --- Running the generated code ---------------------------------------------------

function load(code) {
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
  });
  const module = { exports: {} };
  const run = new Function('module', 'exports', 'Observed', 'ObservedV2', 'Trace', outputText);
  run(module, module.exports, (cls) => cls, (cls) => cls, () => {});
  return module.exports;
}

function roundTrip(text, options) {
  const result = convertJson(text, options);
  const classes = load(result.files[0].content);
  const Root = classes[result.classNames[0]];
  const input = JSON.parse(text);
  if (Array.isArray(input)) return input.map((item) => Root.fromJson(item).toJson());
  return Root.fromJson(input).toJson();
}

test('fromJson then toJson gives back the JSON, with every option', () => {
  for (const name of ['profile.json', 'weather.json']) {
    const text = fixture(name);
    for (const options of combinations()) {
      if (options.filePerClass || !options.exportClasses) continue;
      assert.deepEqual(JSON.parse(JSON.stringify(roundTrip(text, options))), JSON.parse(text), `${name} ${label(options)}`);
    }
  }
});

test('missing keys: defaults, undefined or null, by null style', () => {
  const text = fixture('list.json');
  const [first, second] = JSON.parse(text);

  // Default values fill keys only some items have.
  const filled = roundTrip(text, { nullStyle: 'default' });
  assert.deepEqual(JSON.parse(JSON.stringify(filled)), [{ ...first, badge: '' }, second]);

  // Optional and nullable leave them out.
  for (const nullStyle of ['optional', 'nullable']) {
    assert.deepEqual(JSON.parse(JSON.stringify(roundTrip(text, { nullStyle }))), [first, second], nullStyle);
  }
});

test('null and missing values keep the initial field value', () => {
  const json = { id: 1, name: 'a', tags: ['t'], user: { age: 3 } };
  const read = (options, input) => {
    const result = convertJson(JSON.stringify(json), options);
    return load(result.files[0].content).Root.fromJson(input);
  };
  const empty = { id: null, name: null, tags: null, user: null };

  const defaults = read({}, empty);
  assert.deepEqual([defaults.id, defaults.name, defaults.tags, defaults.user.age], [0, '', [], 0]);
  assert.deepEqual(read({}, {}).toJson(), { id: 0, name: '', tags: [], user: { age: 0 } });

  const optional = read({ nullStyle: 'optional' }, empty);
  assert.deepEqual([optional.id, optional.name, optional.tags, optional.user], [undefined, undefined, undefined, undefined]);
  assert.deepEqual(optional.toJson(), {});

  const nullable = read({ nullStyle: 'nullable' }, {});
  assert.deepEqual([nullable.id, nullable.name, nullable.tags, nullable.user], [null, null, null, null]);
  assert.deepEqual(nullable.toJson(), {});
});

test('private fields work through their getters and setters', () => {
  const result = convertJson('{"user_name": "a", "address": {"city": "c"}}', { privateFields: true, observed: 'v2' });
  const { Root } = load(result.files[0].content);
  const model = Root.fromJson({ user_name: 'ahmet', address: { city: 'Istanbul' } });
  assert.equal(model.userName, 'ahmet');
  assert.equal(model.address.city, 'Istanbul');
  model.userName = 'kadir';
  assert.deepEqual(model.toJson(), { user_name: 'kadir', address: { city: 'Istanbul' } });
});

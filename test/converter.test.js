import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ConvertError, convertJson } from '../src/converter.js';
import { JsonParseError } from '../src/json-parser.js';
import { singularize, toCamelCase, toPascalCase } from '../src/names.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const code = (json, options) => convertJson(typeof json === 'string' ? json : JSON.stringify(json), options).files[0].content;

test('writes a class with fromJson and toJson', () => {
  const expected = `export class Root {
  id: number = 0;
  userName: string = '';
  tags: string[] = [];
  address: Address = new Address();
  orders: Order[] = [];
  note: Object | null = null;

  static fromJson(json: Record<string, Object>): Root {
    const model: Root = new Root();
    model.id = (json['id'] ?? 0) as number;
    model.userName = (json['user_name'] ?? '') as string;
    model.tags = (json['tags'] ?? []) as string[];
    if (json['address']) {
      model.address = Address.fromJson(json['address'] as Record<string, Object>);
    }
    if (json['orders']) {
      model.orders = (json['orders'] as Record<string, Object>[]).map((item: Record<string, Object>) => Order.fromJson(item));
    }
    model.note = json['note'] ?? null;
    return model;
  }

  toJson(): Record<string, Object> {
    const json: Record<string, Object> = {};
    json['id'] = this.id;
    json['user_name'] = this.userName;
    json['tags'] = this.tags;
    json['address'] = this.address.toJson();
    json['orders'] = this.orders.map((item: Order) => item.toJson());
    if (this.note !== null) {
      json['note'] = this.note;
    }
    return json;
  }
}

export class Address {
  city: string = '';

  static fromJson(json: Record<string, Object>): Address {
    const model: Address = new Address();
    model.city = (json['city'] ?? '') as string;
    return model;
  }

  toJson(): Record<string, Object> {
    const json: Record<string, Object> = {};
    json['city'] = this.city;
    return json;
  }
}

export class Order {
  total: number = 0;

  static fromJson(json: Record<string, Object>): Order {
    const model: Order = new Order();
    model.total = (json['total'] ?? 0) as number;
    return model;
  }

  toJson(): Record<string, Object> {
    const json: Record<string, Object> = {};
    json['total'] = this.total;
    return json;
  }
}
`;
  const json = { id: 1, user_name: 'a', tags: ['x'], address: { city: 'c' }, orders: [{ total: 1.5 }], note: null };
  assert.equal(code(json), expected);
});

test('optional style: name?: T, missing and null read as undefined, undefined left out of toJson', () => {
  const out = code({ id: 1, user: { name: 'n' }, any: null }, { nullStyle: 'optional' });
  assert.match(out, /^  id\?: number;$/m);
  assert.match(out, /^  user\?: User;$/m);
  assert.match(out, /^  any\?: Object;$/m);
  assert.match(out, /model\.id = \(json\['id'\] \?\? undefined\) as number \| undefined;/);
  assert.match(out, /model\.any = json\['any'\] \?\? undefined;/);
  assert.match(out, /if \(this\.user !== undefined\) \{\n {6}json\['user'\] = this\.user\.toJson\(\);\n {4}\}/);
});

test('nullable style: name: T | null = null, null left out of toJson', () => {
  const out = code({ id: 1, tags: ['a'], user: { name: 'n' } }, { nullStyle: 'nullable' });
  assert.match(out, /^  id: number \| null = null;$/m);
  assert.match(out, /^  tags: string\[\] \| null = null;$/m);
  assert.match(out, /^  user: User \| null = null;$/m);
  assert.match(out, /model\.tags = \(json\['tags'\] \?\? null\) as string\[\] \| null;/);
  assert.match(out, /if \(this\.id !== null\) \{\n {6}json\['id'\] = this\.id;\n {4}\}/);
});

test('private fields get a getter and a setter, and fromJson and toJson use the field', () => {
  const out = code({ user_name: 'a' }, { privateFields: true });
  assert.match(out, /^  private _userName: string = '';$/m);
  assert.match(out, / {2}get userName\(\): string \{\n {4}return this\._userName;\n {2}\}/);
  assert.match(out, / {2}set userName\(value: string\) \{\n {4}this\._userName = value;\n {2}\}/);
  assert.match(out, /model\._userName = /);
  assert.match(out, /json\['user_name'\] = this\._userName;/);

  const optional = code({ id: 1 }, { privateFields: true, nullStyle: 'optional' });
  assert.match(optional, /private _id\?: number;/);
  assert.match(optional, /get id\(\): number \| undefined \{/);
  assert.match(optional, /set id\(value: number \| undefined\) \{/);
});

test('state management decorators', () => {
  const v1 = code({ a: 1, b: { c: 1 } }, { observed: 'v1' });
  assert.equal(v1.match(/^@Observed\nexport class/gm).length, 2);
  assert.doesNotMatch(v1, /@Trace/);

  const v2 = code({ a: 1, b: { c: 1 } }, { observed: 'v2', privateFields: true });
  assert.equal(v2.match(/^@ObservedV2\nexport class/gm).length, 2);
  assert.match(v2, /^  @Trace private _a: number = 0;$/m);
  assert.match(v2, /^  @Trace private _b: B = new B\(\);$/m);
});

test('camelCase can be turned off; names stay valid identifiers', () => {
  const out = code({ user_name: 'a', 'first-name': 'b', 'two words': 1 }, { camelCase: false });
  assert.match(out, /^  user_name: string = '';$/m);
  assert.match(out, /^  first_name: string = '';$/m);
  assert.match(out, /^  two_words: number = 0;$/m);
  assert.match(out, /json\['first-name'\]/);
});

test('export can be turned off', () => {
  const out = code({ a: { b: 1 } }, { exportClasses: false });
  assert.match(out, /^class Root \{/m);
  assert.match(out, /^class A \{/m);
  assert.doesNotMatch(out, /export/);
});

test('one file per class imports what it uses and always exports', () => {
  const result = convertJson(fixture('profile.json'), { filePerClass: true, exportClasses: false });
  assert.deepEqual(
    result.files.map((f) => f.name),
    ['Root.ets', 'Address.ets', 'Location.ets', 'Order.ets', 'Item.ets'],
  );
  const [root, address, location, order] = result.files.map((f) => f.content);
  assert.ok(root.startsWith("import { Address } from './Address';\nimport { Order } from './Order';\n\nexport class Root {"));
  assert.ok(address.startsWith("import { Location } from './Location';\n\nexport class Address {"));
  assert.ok(location.startsWith('export class Location {'));
  assert.ok(order.startsWith("import { Item } from './Item';\n\n"));
  assert.match(result.usage, /^import \{ Root \} from '\.\/Root';/);
});

test('list items merge every sample into one class', () => {
  const out = code({ items: [{ a: 1 }, { b: 'x' }, { a: 2.5, c: [true] }] });
  assert.match(out, /export class Item \{\n {2}a: number = 0;\n {2}b: string = '';\n {2}c: boolean\[\] = \[\];/);
});

test('class names: UpperCamelCase, singular list items, built-in names get the parent in front', () => {
  const names = (json, options) => convertJson(JSON.stringify(json), options).classNames;
  assert.deepEqual(names({ user_info: { a: 1 }, categories: [{ a: 1 }], people: [{ a: 1 }], addresses: [{ a: 1 }] }), [
    'Root',
    'UserInfo',
    'Category',
    'Person',
    'Address',
  ]);
  assert.deepEqual(names({ text: { a: 1 }, image: { a: 1 }, list: [{ a: 1 }], object: { a: 1 } }), [
    'Root',
    'RootText',
    'RootImage',
    'RootList',
    'RootObject',
  ]);
  // Same name, other shape: parent in front. Same name, same shape: one class.
  assert.deepEqual(names({ user: { data: { id: 1 } }, owner: { data: { name: 'n' } }, admin: { data: { id: 2 } } }), [
    'Root',
    'User',
    'Data',
    'Owner',
    'OwnerData',
    'Admin',
  ]);
  // A key that is no identifier, and classes named like their parents.
  assert.deepEqual(names({ 123: { a: 1 }, data: { data: { b: 1 } } }, { className: 'Data' }), ['Data', 'Data123', 'DataData', 'DataDataData']);
  // Taken by another shape twice: a number after the parent name.
  assert.deepEqual(names({ aX: { q: 1 }, x: { p: 1 }, a: { x: { r: 1 } } }), ['Root', 'AX', 'X', 'A', 'AX2']);
});

test('the root class name is cleaned up', () => {
  assert.deepEqual(convertJson('{}', { className: 'user response' }).classNames, ['UserResponse']);
  assert.deepEqual(convertJson('{}', { className: '' }).classNames, ['Root']);
  assert.deepEqual(convertJson('{}', { className: '9lives' }).classNames, ['Model9lives']);
  const warnings = convertJson('{"a": 1}', { className: 'Text' }).warnings;
  assert.ok(warnings.some((w) => /hides a built-in/.test(w.message)));
});

test('field names avoid members the class already has and never repeat', () => {
  const out = code({ constructor: 1, toJson: 2, fromJson: 3, first_name: 'a', firstName: 'b', '': 4, '2fa': true });
  for (const line of [
    'constructorValue: number = 0;',
    'toJsonValue: number = 0;',
    'fromJsonValue: number = 0;',
    "firstName: string = '';",
    "firstName2: string = '';",
    'field: number = 0;',
    '_2fa: boolean = false;',
  ]) {
    assert.ok(out.includes(`  ${line}`), line);
  }
});

test('keys are quoted safely', () => {
  const out = code({ "it's": 1, 'a\\b': 2, 'line\nbreak': 3 });
  assert.match(out, /json\['it\\'s'\]/);
  assert.match(out, /json\['a\\\\b'\]/);
  assert.match(out, /json\['line\\nbreak'\]/);
});

test('lists of lists convert item by item', () => {
  const out = code({ grid: [[{ cell: 1 }]], numbers: [[1, 2]] });
  assert.match(
    out,
    /model\.grid = \(json\['grid'\] as Record<string, Object>\[\]\[\]\)\.map\(\(list: Record<string, Object>\[\]\) => list\.map\(\(item: Record<string, Object>\) => RootGrid\.fromJson\(item\)\)\);/,
  );
  assert.match(out, /json\['grid'\] = this\.grid\.map\(\(list: RootGrid\[\]\) => list\.map\(\(item: RootGrid\) => item\.toJson\(\)\)\);/);
  assert.match(out, /model\.numbers = \(json\['numbers'\] \?\? \[\]\) as number\[\]\[\];/);
});

test('hints for unknown and lossy types', () => {
  const { warnings } = convertJson(fixture('tricky.json'));
  const text = warnings.map((w) => `${w.path} ${w.message}`).join('\n');
  assert.match(text, /\$\.mixed\[\] mixes numbers and strings, so it is typed as Object/);
  assert.match(text, /\$\.nothing is always null/);
  assert.match(text, /\$\.empty_list is an empty list/);
  assert.match(text, /\$\.empty_object is an empty object/);
  assert.match(text, /\$\.maybe has null items/);
  assert.match(text, /\$\.big 12345678901234567890 is larger than a number can hold exactly/);
  assert.match(text, /\$\["2fa"\] is named _2fa in Root/);
});

test('duplicate keys show up as hints', () => {
  const { warnings } = convertJson('{"a": 1, "a": 2}');
  assert.deepEqual(warnings, [{ path: 'line 1', message: 'Duplicate key "a"; the last value is used' }]);
});

test('a top-level list of objects becomes one class and a list usage', () => {
  const result = convertJson(fixture('list.json'), { className: 'Post' });
  // Link is the @Link decorator in every .ets file.
  assert.deepEqual(result.classNames, ['Post', 'Author', 'AuthorLink']);
  assert.equal(result.rootIsList, true);
  assert.match(result.usage, /const list: Post\[\] = \(JSON\.parse\(text\) as Record<string, Object>\[\]\)/);
});

test('the usage variable never takes a keyword', () => {
  assert.match(convertJson('{}', { className: 'Default' }).usage, /const model: Default = Default\.fromJson/);
  assert.match(convertJson('{}', { className: 'UserProfile' }).usage, /const userProfile: UserProfile = /);
});

test('input that cannot become classes', () => {
  assert.throws(() => convertJson('[]'), ConvertError);
  assert.throws(() => convertJson('[1, 2]'), /must contain objects/);
  assert.throws(() => convertJson('"text"'), /must be an object, or a list of objects/);
  assert.throws(() => convertJson('{"a": }'), JsonParseError);
});

test('name helpers', () => {
  assert.equal(toCamelCase('user_name'), 'userName');
  assert.equal(toCamelCase('UserName'), 'userName');
  assert.equal(toCamelCase('HTTPCode'), 'httpCode');
  assert.equal(toCamelCase('ID'), 'id');
  assert.equal(toCamelCase('user_ID'), 'userId');
  assert.equal(toCamelCase('_id'), 'id');
  assert.equal(toCamelCase("it's"), 'its');
  assert.equal(toPascalCase('zip-code'), 'ZipCode');
  assert.equal(toPascalCase('ürün_adı'), 'ÜrünAdı');
  const plurals = {
    Items: 'Item',
    Categories: 'Category',
    UserAddresses: 'UserAddress',
    Boxes: 'Box',
    Matches: 'Match',
    Statuses: 'Status',
    Photos: 'Photo',
    Movies: 'Movie',
    Children: 'Child',
    IDs: 'ID',
    Data: 'Data',
    Settings: 'Settings',
    Status: 'Status',
    Analysis: 'Analysis',
    Item: 'Item',
  };
  for (const [plural, singular] of Object.entries(plurals)) assert.equal(singularize(plural), singular, plural);
});

test('interface output: types only, fields are the JSON keys', () => {
  const result = convertJson(JSON.stringify({ id: 1, user_name: 'a', tags: ['x'], address: { city: 'c' }, orders: [{ total: 1.5 }], note: null }), {
    output: 'interface',
    camelCase: true,
    observed: 'v2',
    privateFields: true,
  });
  assert.equal(
    result.files[0].content,
    `export interface Root {
  id: number;
  user_name: string;
  tags: string[];
  address: Address;
  orders: Order[];
  note: Object | null;
}

export interface Address {
  city: string;
}

export interface Order {
  total: number;
}
`,
  );
  assert.match(result.usage, /const root: Root = JSON\.parse\(text\) as Root;/);
  assert.match(result.warnings[0].message, /checked when you compile/);

  const optional = convertJson('{"a": 1, "b": {"c": "x"}}', { output: 'interface', nullStyle: 'optional', exportClasses: false }).files[0].content;
  assert.match(optional, /^interface Root \{\n {2}a\?: number;\n {2}b\?: B;\n\}/);
  const nullable = convertJson('{"a": 1}', { output: 'interface', nullStyle: 'nullable' }).files[0].content;
  assert.match(nullable, /a: number \| null;/);
});

test('interface output: per file imports, list usage and keys that cannot be fields', () => {
  const files = convertJson(fixture('profile.json'), { output: 'interface', filePerClass: true }).files;
  assert.ok(files[0].content.startsWith("import { Address } from './Address';\nimport { Order } from './Order';\n\nexport interface Root {"));
  const list = convertJson(fixture('list.json'), { output: 'interface', className: 'Post' });
  assert.match(list.usage, /const list: Post\[\] = JSON\.parse\(text\) as Post\[\];/);
  const odd = convertJson('{"first-name": "a", "constructor": 1}', { output: 'interface' });
  assert.match(odd.files[0].content, / {2}first_name: string;/);
  assert.match(odd.files[0].content, / {2}constructor: number;/);
  assert.ok(odd.warnings.some((w) => /cannot be an interface field/.test(w.message)));
});

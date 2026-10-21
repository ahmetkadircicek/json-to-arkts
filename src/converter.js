// JSON to ArkTS. Reads a parsed JSON tree, infers one class per object shape
// and writes ArkTS classes with static fromJson() and toJson() that pass the
// ArkTS linter (no any, no untyped object literals, explicit types).

import { parseJson } from './json-parser.js';
import {
  isIdentifier,
  isReservedClassName,
  KEYWORDS,
  lowerFirst,
  RESERVED_MEMBERS,
  singularize,
  toCamelCase,
  toIdentifierChars,
  toPascalCase,
} from './names.js';

export const DEFAULT_OPTIONS = Object.freeze({
  className: 'Root',
  /** 'class' (fromJson and toJson) or 'interface' (types only, used as JSON.parse(text) as Root). */
  output: 'class',
  /** 'default' (name: string = ''), 'optional' (name?: string) or 'nullable' (name: string | null = null). */
  nullStyle: 'default',
  /** private _name with get name() and set name(). */
  privateFields: false,
  /** 'none', 'v1' (@Observed) or 'v2' (@ObservedV2 with @Trace). */
  observed: 'none',
  camelCase: true,
  exportClasses: true,
  /** One .ets file per class, with imports between them. Implies exportClasses. */
  filePerClass: false,
});

export class ConvertError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConvertError';
  }
}

/** Parses JSON text and converts it. Throws JsonParseError or ConvertError. */
export function convertJson(text, options = {}) {
  const { value, warnings } = parseJson(text);
  const result = convertTree(value, options);
  result.warnings.unshift(...warnings.map((w) => ({ path: `line ${w.line}`, message: w.message })));
  return result;
}

/**
 * Converts a tree from parseJson. Returns
 *   { files: [{ name, content }], classNames, warnings: [{ path, message }], usage, rootIsList }
 */
export function convertTree(root, options = {}) {
  const opts = normalizeOptions(options);
  const notes = new Notes();

  let shape;
  let rootIsList = false;
  if (root.type === 'object') {
    shape = infer(root, '$', notes);
  } else if (root.type === 'array') {
    const list = infer(root, '$', notes);
    if (list.element.kind === 'empty') throw new ConvertError('The top-level list is empty, so there is nothing to build classes from.');
    if (list.element.kind !== 'object') {
      throw new ConvertError('The top-level list must contain objects to build classes from.');
    }
    shape = list.element;
    rootIsList = true;
  } else {
    throw new ConvertError('The JSON must be an object, or a list of objects, to build classes from.');
  }

  const rootName = rootClassName(opts.className, notes);
  const classes = new ClassBuilder(notes, opts.camelCase, opts.output === 'interface').build(shape, rootName, rootIsList ? '$[]' : '$');
  const writer = new Writer(opts);

  if (opts.output === 'interface') {
    notes.list.unshift({
      path: '$',
      message: 'interfaces are checked when you compile, not when the app runs: a key missing from the JSON is undefined at run time, whatever the type says. Use class output for default values and checks',
    });
  }

  let files;
  if (opts.filePerClass) {
    files = classes.map((cls) => ({ name: `${cls.name}.ets`, content: writer.file(cls) }));
  } else {
    files = [{ name: `${classes[0].name}.ets`, content: `${classes.map((cls) => writer.classCode(cls)).join('\n\n')}\n` }];
  }

  return {
    files,
    classNames: classes.map((cls) => cls.name),
    warnings: notes.list,
    usage: usage(classes[0].name, rootIsList, opts),
    rootIsList,
  };
}

export function normalizeOptions(options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!['default', 'optional', 'nullable'].includes(opts.nullStyle)) opts.nullStyle = 'default';
  if (!['none', 'v1', 'v2'].includes(opts.observed)) opts.observed = 'none';
  if (!['class', 'interface'].includes(opts.output)) opts.output = 'class';
  for (const key of ['privateFields', 'camelCase', 'exportClasses', 'filePerClass']) opts[key] = Boolean(opts[key]);
  if (opts.filePerClass) opts.exportClasses = true;
  if (opts.output === 'interface') {
    // An interface has no methods, defaults or decorators, and its fields are the JSON keys.
    opts.observed = 'none';
    opts.privateFields = false;
    opts.camelCase = false;
  }
  return opts;
}

class Notes {
  constructor() {
    this.list = [];
    this.seen = new Set();
  }

  add(path, message) {
    const id = `${path}\n${message}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.list.push({ path, message });
  }
}

// --- Shapes ---------------------------------------------------------------
// A shape is what one JSON position holds across every sample of it:
//   { kind: 'string' | 'number' | 'boolean' | 'null' | 'any' | 'empty' }
//   { kind: 'array', element: shape }       ('empty' element: no items seen)
//   { kind: 'object', fields: Map<key, shape> }

const ANY = { kind: 'any' };
const EMPTY = { kind: 'empty' };

// Names every JavaScript object already has: reading a missing key of one of these
// returns the built-in, and assigning __proto__ changes the prototype instead of
// adding a key.
const BUILT_IN_KEYS = new Set([
  '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'constructor',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf',
]);

const childPath = (path, key) => (isIdentifier(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);

function infer(node, path, notes) {
  switch (node.type) {
    case 'string':
    case 'boolean':
    case 'null':
      return { kind: node.type };
    case 'number':
      if (/^-?\d+$/.test(node.raw) && !Number.isSafeInteger(node.value)) {
        notes.add(path, `${node.raw} is larger than a number can hold exactly; ask for it as a string if every digit matters`);
      }
      return { kind: 'number' };
    case 'array': {
      let element = EMPTY;
      let nullItems = false;
      for (const item of node.items) {
        if (item.type === 'null') nullItems = true;
        element = merge(element, infer(item, `${path}[]`, notes), `${path}[]`, notes);
      }
      if (nullItems && element.kind !== 'null') {
        notes.add(path, 'has null items; the generated code expects every item to be present');
      }
      return { kind: 'array', element };
    }
    default: {
      const fields = new Map();
      for (const { key, value } of node.entries) {
        if (BUILT_IN_KEYS.has(key)) {
          notes.add(childPath(path, key), 'is also a built-in name of every JavaScript object, so a missing key may read that built-in and __proto__ is not written back; rename the key in your API if you can');
        }
        fields.set(key, infer(value, childPath(path, key), notes));
      }
      return { kind: 'object', fields };
    }
  }
}

const describe = (shape) =>
  ({ string: 'strings', number: 'numbers', boolean: 'booleans', array: 'lists', object: 'objects' })[shape.kind];

function merge(a, b, path, notes) {
  if (a.kind === 'empty') return b;
  if (b.kind === 'empty') return a;
  if (a.kind === 'null') return b;
  if (b.kind === 'null') return a;
  if (a.kind === 'any' || b.kind === 'any') return ANY;
  if (a.kind !== b.kind) {
    notes.add(path, `mixes ${describe(a)} and ${describe(b)}, so it is typed as Object`);
    return ANY;
  }
  if (a.kind === 'array') return { kind: 'array', element: merge(a.element, b.element, `${path}[]`, notes) };
  if (a.kind === 'object') {
    const fields = new Map(a.fields);
    for (const [key, shape] of b.fields) {
      fields.set(key, fields.has(key) ? merge(fields.get(key), shape, childPath(path, key), notes) : shape);
    }
    return { kind: 'object', fields };
  }
  return a;
}

function signature(shape) {
  switch (shape.kind) {
    case 'array':
      return `[${signature(shape.element)}]`;
    case 'object': {
      const keys = [...shape.fields.keys()].sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${signature(shape.fields.get(key))}`).join(',')}}`;
    }
    default:
      return shape.kind;
  }
}

// --- Classes ----------------------------------------------------------------
// A class is { name, fields: [{ key, name, type }] } and a type is
//   { kind: 'string' | 'number' | 'boolean' | 'any' } | { kind: 'class', cls } | { kind: 'array', element }

function rootClassName(input, notes) {
  const raw = String(input ?? '').trim();
  let name = isIdentifier(raw) ? raw : toPascalCase(raw);
  if (!isIdentifier(name)) name = name ? `Model${name}` : DEFAULT_OPTIONS.className;
  if (!isIdentifier(name)) name = DEFAULT_OPTIONS.className;
  if (isReservedClassName(name)) notes.add('$', `the class name ${name} hides a built-in ArkTS or ArkUI name; consider another one`);
  return name;
}

class ClassBuilder {
  constructor(notes, camelCase, asInterface) {
    this.notes = notes;
    this.camelCase = camelCase;
    this.asInterface = asInterface;
    this.classes = [];
    this.byName = new Map();
  }

  build(shape, rootName, path) {
    this.makeClass(shape, rootName, path);
    return this.classes;
  }

  makeClass(shape, name, path) {
    const cls = { name, signature: signature(shape), fields: [] };
    this.byName.set(name, cls);
    this.classes.push(cls);
    if (shape.fields.size === 0) this.notes.add(path, 'is an empty object, so its class has no fields');

    const used = new Set();
    for (const [key, fieldShape] of shape.fields) {
      const fieldName = this.fieldName(key, used, cls.name, childPath(path, key));
      used.add(fieldName);
      cls.fields.push({ key, name: fieldName, type: this.typeOf(fieldShape, key, cls.name, childPath(path, key), false) });
    }
    return cls;
  }

  typeOf(shape, key, parentName, path, inList) {
    switch (shape.kind) {
      case 'string':
      case 'number':
      case 'boolean':
        return { kind: shape.kind };
      case 'null':
        this.notes.add(path.replace(/(\[\])+$/, ''), 'is always null in this sample, so its type is unknown and it is typed as Object');
        return ANY;
      case 'empty':
        this.notes.add(path.replace(/(\[\])+$/, ''), 'is an empty list in this sample, so its item type is unknown and it is typed as Object');
        return ANY;
      case 'any':
        return ANY;
      case 'array':
        return { kind: 'array', element: this.typeOf(shape.element, key, parentName, `${path}[]`, true) };
      default:
        return { kind: 'class', cls: this.classFor(shape, key, parentName, path, inList) };
    }
  }

  // UpperCamelCase of the key, in the singular for list items. A name that is
  // taken by another shape, or hides a built-in name, gets the parent class
  // name in front ("Image" in Product becomes ProductImage), then a number.
  classFor(shape, key, parentName, path, inList) {
    const pascal = toPascalCase(key);
    const candidate = inList ? singularize(pascal) : pascal;
    const sig = signature(shape);
    const tries = [];
    if (isIdentifier(candidate) && !isReservedClassName(candidate)) tries.push(candidate);
    tries.push(parentName + (candidate || 'Item'));

    for (const name of tries) {
      const existing = this.byName.get(name);
      if (!existing) return this.makeClass(shape, name, path);
      if (existing.signature === sig) return existing;
    }
    const base = tries[tries.length - 1];
    for (let n = 2; ; n++) {
      const name = `${base}${n}`;
      const existing = this.byName.get(name);
      if (!existing) return this.makeClass(shape, name, path);
      if (existing.signature === sig) return existing;
    }
  }

  fieldName(key, used, className, path) {
    let name = this.camelCase ? toCamelCase(key) : toIdentifierChars(key);
    if (!name) name = 'field';
    if (!isIdentifier(name)) name = `_${name}`;
    if (RESERVED_MEMBERS.has(name) && !this.asInterface) name = `${name}Value`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    if (this.asInterface && name !== key) {
      this.notes.add(path, `cannot be an interface field as written, so ${className} calls it ${name}, which does not match the JSON key; use class output for this key`);
    } else if (name !== key && !(this.camelCase && toCamelCase(key) === name)) {
      this.notes.add(path, `is named ${name} in ${className}`);
    }
    return name;
  }
}

// --- Code ---------------------------------------------------------------

const PRIMITIVE_DEFAULTS = { number: '0', string: "''", boolean: 'false' };
const JSON_OBJECT = 'Record<string, Object>';

function typeName(type) {
  switch (type.kind) {
    case 'any':
      return 'Object';
    case 'class':
      return type.cls.name;
    case 'array':
      return `${typeName(type.element)}[]`;
    default:
      return type.kind;
  }
}

// The type a value has in parsed JSON: objects are Record<string, Object>.
function jsonTypeName(type) {
  if (type.kind === 'class') return JSON_OBJECT;
  if (type.kind === 'array') return `${jsonTypeName(type.element)}[]`;
  return typeName(type);
}

const hasClass = (type) => type.kind === 'class' || (type.kind === 'array' && hasClass(type.element));

const listDepth = (type) => (type.kind === 'array' ? 1 + listDepth(type.element) : 0);

// Lambda parameter for items of a list: 'item' for the innermost level,
// 'list', 'list2', ... for lists of lists, so nested lambdas never shadow.
function paramName(itemType) {
  const depth = listDepth(itemType);
  if (depth === 0) return 'item';
  return depth === 1 ? 'list' : `list${depth}`;
}

// A single-quoted ArkTS string literal for a JSON key.
const quote = (key) =>
  `'${key.replace(/[\\'\n\r\u2028\u2029]/g, (ch) => ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r' })[ch] ?? `\\u${ch.charCodeAt(0).toString(16)}`)}'`;

class Writer {
  constructor(opts) {
    this.opts = opts;
  }

  member(field) {
    return this.opts.privateFields ? `_${field.name}` : field.name;
  }

  // The declared type of a field, as its getter returns it.
  fieldType(field) {
    const name = typeName(field.type);
    if (this.opts.nullStyle === 'optional') return `${name} | undefined`;
    if (this.opts.nullStyle === 'nullable' || field.type.kind === 'any') return `${name} | null`;
    return name;
  }

  declaration(field) {
    const { opts } = this;
    const name = typeName(field.type);
    const prefix = `${opts.observed === 'v2' ? '@Trace ' : ''}${opts.privateFields ? 'private ' : ''}${this.member(field)}`;
    if (opts.nullStyle === 'optional') return `${prefix}?: ${name};`;
    if (opts.nullStyle === 'nullable' || field.type.kind === 'any') return `${prefix}: ${name} | null = null;`;
    return `${prefix}: ${name} = ${defaultValue(field.type)};`;
  }

  accessors(field) {
    const type = this.fieldType(field);
    const member = this.member(field);
    return [
      `get ${field.name}(): ${type} {`,
      `  return this.${member};`,
      '}',
      '',
      `set ${field.name}(value: ${type}) {`,
      `  this.${member} = value;`,
      '}',
    ];
  }

  // Missing keys and nulls keep the field's initial value: its default, undefined or null.
  read(field) {
    const { nullStyle } = this.opts;
    const target = `model.${this.member(field)}`;
    const source = `json[${quote(field.key)}]`;
    const { type } = field;

    if (!hasClass(type)) {
      if (type.kind === 'any') return [`${target} = ${source} ?? ${nullStyle === 'optional' ? 'undefined' : 'null'};`];
      const name = typeName(type);
      if (nullStyle === 'optional') return [`${target} = (${source} ?? undefined) as ${name} | undefined;`];
      if (nullStyle === 'nullable') return [`${target} = (${source} ?? null) as ${name} | null;`];
      return [`${target} = (${source} ?? ${defaultValue(type)}) as ${name};`];
    }

    const cast = `${source} as ${jsonTypeName(type)}`;
    const value = type.kind === 'class' ? `${type.cls.name}.fromJson(${cast})` : mapItems(`(${cast})`, type.element, fromJsonValue);
    return [`if (${source}) {`, `  ${target} = ${value};`, '}'];
  }

  // null and undefined fields are left out of the JSON.
  write(field) {
    const value = `this.${this.member(field)}`;
    const assign = `json[${quote(field.key)}] = ${toJsonValue(field.type, value)};`;
    const { nullStyle } = this.opts;
    if (nullStyle === 'default' && field.type.kind !== 'any') return [assign];
    return [`if (${value} !== ${nullStyle === 'optional' ? 'undefined' : 'null'}) {`, `  ${assign}`, '}'];
  }

  interfaceCode(cls) {
    const { nullStyle } = this.opts;
    const lines = [`${this.opts.exportClasses ? 'export ' : ''}interface ${cls.name} {`];
    for (const field of cls.fields) {
      const name = typeName(field.type);
      if (nullStyle === 'optional') lines.push(`  ${field.name}?: ${name};`);
      else if (nullStyle === 'nullable' || field.type.kind === 'any') lines.push(`  ${field.name}: ${name} | null;`);
      else lines.push(`  ${field.name}: ${name};`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  classCode(cls) {
    if (this.opts.output === 'interface') return this.interfaceCode(cls);
    const { opts } = this;
    const body = [];
    for (const field of cls.fields) body.push(this.declaration(field));
    if (cls.fields.length) body.push('');
    if (opts.privateFields) {
      for (const field of cls.fields) body.push(...this.accessors(field), '');
    }

    body.push(`static fromJson(json: ${JSON_OBJECT}): ${cls.name} {`, `  const model: ${cls.name} = new ${cls.name}();`);
    for (const field of cls.fields) body.push(...this.read(field).map((line) => `  ${line}`));
    body.push('  return model;', '}', '');

    body.push(`toJson(): ${JSON_OBJECT} {`, `  const json: ${JSON_OBJECT} = {};`);
    for (const field of cls.fields) body.push(...this.write(field).map((line) => `  ${line}`));
    body.push('  return json;', '}');

    const lines = [];
    if (opts.observed === 'v1') lines.push('@Observed');
    if (opts.observed === 'v2') lines.push('@ObservedV2');
    lines.push(`${opts.exportClasses ? 'export ' : ''}class ${cls.name} {`);
    lines.push(...body.map((line) => (line ? `  ${line}` : '')));
    lines.push('}');
    return lines.join('\n');
  }

  file(cls) {
    const imports = [];
    const visit = (type) => {
      if (type.kind === 'array') visit(type.element);
      if (type.kind === 'class' && type.cls !== cls && !imports.includes(type.cls.name)) imports.push(type.cls.name);
    };
    for (const field of cls.fields) visit(field.type);
    const head = imports.map((name) => `import { ${name} } from './${name}';`).join('\n');
    return `${head ? `${head}\n\n` : ''}${this.classCode(cls)}\n`;
  }
}

function defaultValue(type) {
  if (type.kind === 'array') return '[]';
  if (type.kind === 'class') return `new ${type.cls.name}()`;
  return PRIMITIVE_DEFAULTS[type.kind];
}

// receiver.map((item: T) => convert(item)), where receiver is a list typed as JSON.
function mapItems(receiver, itemType, convert) {
  const param = paramName(itemType);
  return `${receiver}.map((${param}: ${jsonTypeName(itemType)}) => ${convert(itemType, param)})`;
}

// A JSON value (already cast to its JSON type) to the model value.
function fromJsonValue(type, value) {
  if (type.kind === 'class') return `${type.cls.name}.fromJson(${value})`;
  if (type.kind === 'array' && hasClass(type)) return mapItems(value, type.element, fromJsonValue);
  return value;
}

// A model value to its JSON value.
function toJsonValue(type, value) {
  if (type.kind === 'class') return `${value}.toJson()`;
  if (type.kind === 'array' && hasClass(type)) {
    const param = paramName(type.element);
    return `${value}.map((${param}: ${typeName(type.element)}) => ${toJsonValue(type.element, param)})`;
  }
  return value;
}

function usage(rootName, rootIsList, opts) {
  const lines = [];
  if (opts.filePerClass) lines.push(`import { ${rootName} } from './${rootName}';`, '');
  if (opts.output === 'interface') {
    if (rootIsList) {
      lines.push(
        '// JSON text to a list',
        `const list: ${rootName}[] = JSON.parse(text) as ${rootName}[];`,
        '',
        '// List to JSON text',
        'const output: string = JSON.stringify(list);',
      );
    } else {
      let variable = lowerFirst(rootName);
      if (KEYWORDS.has(variable) || variable === 'text' || variable === 'output' || variable === rootName) variable = 'model';
      lines.push(
        '// JSON text to an object',
        `const ${variable}: ${rootName} = JSON.parse(text) as ${rootName};`,
        '',
        '// Object to JSON text',
        `const output: string = JSON.stringify(${variable});`,
      );
    }
    return lines.join('\n');
  }
  if (rootIsList) {
    lines.push(
      '// JSON text to models',
      `const list: ${rootName}[] = (JSON.parse(text) as ${JSON_OBJECT}[])`,
      `  .map((item: ${JSON_OBJECT}) => ${rootName}.fromJson(item));`,
      '',
      '// Models to JSON text',
      `const output: string = JSON.stringify(list.map((item: ${rootName}) => item.toJson()));`,
    );
  } else {
    let variable = lowerFirst(rootName);
    if (KEYWORDS.has(variable) || variable === 'text' || variable === 'output' || variable === rootName) variable = 'model';
    lines.push(
      '// JSON text to model',
      `const ${variable}: ${rootName} = ${rootName}.fromJson(JSON.parse(text) as ${JSON_OBJECT});`,
      '',
      '// Model to JSON text',
      `const output: string = JSON.stringify(${variable}.toJson());`,
    );
  }
  return lines.join('\n');
}

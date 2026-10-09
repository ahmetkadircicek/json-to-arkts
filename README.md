# JSON to ArkTS

**Live: [ahmetkadircicek.github.io/json-to-arkts](https://ahmetkadircicek.github.io/json-to-arkts/)**

Paste JSON, get ArkTS classes with `fromJson` and `toJson` for HarmonyOS. Everything runs in the browser; the JSON never leaves the page.

```json
{ "id": 1, "user_name": "ahmet", "address": { "city": "Istanbul" }, "orders": [{ "total": 9.9 }] }
```

becomes

```ts
export class Root {
  id: number = 0;
  userName: string = '';
  address: Address = new Address();
  orders: Order[] = [];

  static fromJson(json: Record<string, Object>): Root {
    const model: Root = new Root();
    model.id = (json['id'] ?? 0) as number;
    model.userName = (json['user_name'] ?? '') as string;
    if (json['address']) {
      model.address = Address.fromJson(json['address'] as Record<string, Object>);
    }
    if (json['orders']) {
      model.orders = (json['orders'] as Record<string, Object>[]).map((item: Record<string, Object>) => Order.fromJson(item));
    }
    return model;
  }

  toJson(): Record<string, Object> {
    const json: Record<string, Object> = {};
    json['id'] = this.id;
    json['user_name'] = this.userName;
    json['address'] = this.address.toJson();
    json['orders'] = this.orders.map((item: Order) => item.toJson());
    return json;
  }
}

export class Address { ... }
export class Order { ... }
```

and is used as

```ts
const root: Root = Root.fromJson(JSON.parse(text) as Record<string, Object>);
const output: string = JSON.stringify(root.toJson());
```

## Options

| Option | What it does |
| --- | --- |
| Class name | Name of the top-level class. |
| Missing and null fields | **Default values**: `name: string = ''`; a missing or null key keeps the default. **Optional**: `name?: string`, read as `undefined`. **Nullable**: `name: string \| null = null`, read as `null`. `toJson` leaves out `undefined` and `null` fields. |
| State management | **@Observed** (V1) on every class, or **@ObservedV2** with **@Trace** on every field (V2, API 12+). |
| Private fields with get/set | `private _name` with `get name()` and `set name()`. |
| camelCase field names | `user_name` becomes `userName`; `fromJson` and `toJson` keep the JSON key. Off, the key is kept and only made a valid identifier (`first-name` becomes `first_name`). |
| Export classes | `export class`. |
| One file per class | One `.ets` file per class with the imports between them, shown as tabs and downloaded as a `.zip`. |

Format pretty prints the JSON. A JSON error shows its line and column and marks the line. Copy copies the open file, Download saves it as `.ets` (or all files as `.zip`). The JSON and the options are kept in the browser between visits.

## How JSON becomes classes

- Every JSON object is a class. Numbers are `number`, strings `string`, booleans `boolean`.
- Class names are UpperCamelCase keys; list items are in the singular (`categories` makes `Category`). A name that hides an ArkTS global or an ArkUI component or decorator (`Text`, `Image`, `List`, `Link`, `Object` …) gets the parent class name in front (`ProductImage`). Two different shapes under one name do the same, then get a number.
- Objects in a list are merged: the class has every key any item has. Objects with the same name and the same keys and types share one class.
- What cannot be known from the sample is `Object`, with a hint: a value that is always `null`, an empty list, a list or key that mixes types.
- Field names that the class already uses (`constructor`, `fromJson`, `toJson`) get `Value` at the end; names that start with a digit get `_` in front; repeats get a number. The hints list every renamed field.
- Integers too large for `number` get a hint: ask the API for them as strings.

The output follows the ArkTS rules: no `any` or `unknown`, every object literal typed (`Record<string, Object>`), explicit types on lambda parameters, no structural typing.

## Development

The site is plain HTML, CSS and JavaScript modules with no build step.

```sh
npm install
npm start      # http://localhost:8080
npm test
```

| File | Does |
| --- | --- |
| `src/json-parser.js` | Strict JSON parser: keeps key order and number text, errors with line and column, Format. |
| `src/converter.js` | Shapes, classes and the ArkTS code. |
| `src/names.js` | Identifier, camelCase, singular and reserved name rules. |
| `src/app.js` | The page. `src/highlight.js` colors the code, `src/zip.js` writes the `.zip`. |

`npm test` runs the parser and converter tests, then checks the output for four sample JSON files with all 108 option combinations against [`ohos-typescript`](https://www.npmjs.com/package/ohos-typescript), the TypeScript fork DevEco Studio builds ArkTS with, including its ArkTS linter. It also runs the generated classes to check that `toJson(fromJson(json))` gives the JSON back.

## Deploy

`.github/workflows/pages.yml` runs the tests on every push and pull request and publishes `main` to GitHub Pages. Pages must be set to deploy from GitHub Actions once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

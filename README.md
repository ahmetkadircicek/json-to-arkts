# JSON to ArkTS

**English** | [简体中文](README.zh-CN.md)

**Convert JSON to ArkTS classes for HarmonyOS, HarmonyOS NEXT and OpenHarmony.** Paste a JSON response and get typed `.ets` model classes with `fromJson()` and `toJson()` that pass ArkTS strict mode in DevEco Studio. Free, online, and it runs entirely in your browser.

### [Open JSON to ArkTS →](https://ahmetkadircicek.github.io/json-to-arkts/)

![JSON to ArkTS: paste JSON, generate ArkTS classes, switch to @ObservedV2 and copy the code](docs/demo.gif)

If JSON to ArkTS saves you time, please give it a ⭐. It helps other HarmonyOS developers find it.

ArkTS does not allow `any`, `unknown` or untyped object literals, so every JSON response a HarmonyOS app reads needs a typed model class. Writing those classes by hand is slow and easy to get wrong. JSON to ArkTS writes them for you, nested objects and lists included.

## Features

- **ArkTS model classes** with a `static fromJson()` and a `toJson()`, for nested objects and lists of any depth.
- **Passes ArkTS strict mode**: no `any` or `unknown`, every object literal typed as `Record<string, Object>`, typed lambda parameters. Checked against the ArkTS linter for every combination of options.
- **State management**: `@Observed` (V1) or `@ObservedV2` with `@Trace` (V2, API 12+).
- **Null handling**: default values, optional fields (`name?: string`) or nullable fields (`name: string | null`).
- **Private fields** with getters and setters, **camelCase** field names, **one file per class** with imports between them.
- **Smart naming**: UpperCamelCase class names, singular list items (`categories` → `Category`), no names that clash with ArkUI components or decorators (`Image`, `List`, `Text`, `Link` …).
- **Hints** for what a sample cannot tell: values that are always `null`, empty lists, mixed types, numbers too large for `number`.
- JSON errors with line and column, Format, syntax highlighting, copy, `.ets` and `.zip` download, light and dark themes.
- **Private**: the conversion happens in your browser; your JSON and code are never uploaded.

## Example

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

## Use it in a HarmonyOS project

1. Open [JSON to ArkTS](https://ahmetkadircicek.github.io/json-to-arkts/), paste a sample response and set the class name.
2. Download the `.ets` file (or the `.zip` with one file per class) into your module, for example `entry/src/main/ets/model/`.
3. Parse and serialize:

```ts
import { Root } from '../model/Root';

const root: Root = Root.fromJson(JSON.parse(text) as Record<string, Object>);
const output: string = JSON.stringify(root.toJson());
```

For a top-level list:

```ts
const list: Root[] = (JSON.parse(text) as Record<string, Object>[])
  .map((item: Record<string, Object>) => Root.fromJson(item));
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

## How JSON becomes ArkTS

- Every JSON object is a class. Numbers are `number`, strings `string`, booleans `boolean`.
- Objects in a list are merged: the class has every key any item has. Objects with the same name and the same keys and types share one class.
- Class names are UpperCamelCase keys, list items in the singular. A name that hides an ArkTS global or an ArkUI component or decorator gets the parent class name in front (`ProductImage`); two different shapes under one name do the same, then get a number.
- What a sample cannot tell is typed `Object`, with a hint: a value that is always `null`, an empty list, a list or key that mixes types.
- Field names the class already uses (`constructor`, `fromJson`, `toJson`) get `Value` at the end, names that start with a digit get `_` in front, and repeats get a number. The hints list every renamed field.

## FAQ

**How do I parse JSON in ArkTS?**
Cast the parsed value to `Record<string, Object>` and pass it to the generated `fromJson`: `User.fromJson(JSON.parse(text) as Record<string, Object>)`. To turn a model back into text, call `JSON.stringify(user.toJson())`.

**Why not just cast `JSON.parse` to a class?**
A cast does not create an instance. The object has no methods, no default values and no `@Observed` proxy, so the UI does not react to its changes. `fromJson` builds real class instances, nested objects and lists included.

**Does the generated code pass ArkTS strict mode?**
Yes. `npm test` checks four sample files with all 108 option combinations against [`ohos-typescript`](https://www.npmjs.com/package/ohos-typescript), the TypeScript fork DevEco Studio builds ArkTS with, including its ArkTS linter. It also runs the classes to check that `toJson(fromJson(json))` gives the JSON back.

**`@Observed` or `@ObservedV2`?**
Use `@Observed` with `@ObjectLink` in state management V1. For V2 (API 12 and later), choose `@ObservedV2`: every field gets `@Trace`, so changes to nested objects update the UI.

**Does it work with OpenHarmony and HarmonyOS NEXT?**
Yes. They all use ArkTS, so the classes work in any of them.

## Privacy

The converter runs in your browser. Your JSON, the generated code and your options never leave it; the last JSON and options are kept in your browser's local storage only.

The live site counts visits with [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/), without cookies or fingerprinting; Cloudflare does not store IP addresses. It records the page, the referring site, the country and the browser type of a visit; never JSON or code. The beacon loads only on the live site, and not in automated browsers or browsers with Do Not Track or Global Privacy Control turned on. See `src/analytics.js`.

## Development

Plain HTML, CSS and JavaScript modules; no build step, no runtime dependencies.

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
| `src/app.js` | The page. `src/highlight.js` colors the code, `src/zip.js` writes the `.zip`, `src/analytics.js` loads the visit counter. |
| `tool/og.html` | The link preview image; render it with `npx playwright screenshot --viewport-size=1200,630 tool/og.html og.png`. |

## Deploy

`.github/workflows/pages.yml` runs the tests on every push and pull request. On `main` it then replaces the `gh-pages` branch with the site files (`index.html`, `src/`, `favicon.svg`, `og.png`, `sitemap.xml` and the Google Search Console verification file), and GitHub Pages serves that branch.

## Credits

Made by [Ahmet Kadir Çiçek](https://github.com/ahmetkadircicek).

## License

[MIT](LICENSE) © Ahmet Kadir Çiçek

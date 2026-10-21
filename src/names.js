// Identifier rules for the generated ArkTS: field names in lowerCamelCase,
// class names in UpperCamelCase, list item classes in the singular, and no
// class that hides a global or an ArkUI name.

const ID_START = /[\p{L}\p{Nl}$_]/u;
const ID_PART = /^[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$‌‍]$/u;
const NOT_ID_PART = /[^\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$‌‍]/gu;
// Word separators for case conversion: anything outside letters and digits, including '_'.
const SEPARATOR = /[^\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}$]+/u;

export function isIdentifier(name) {
  if (!name || !ID_START.test(name[0])) return false;
  for (const ch of name.slice(1)) if (!ID_PART.test(ch)) return false;
  return true;
}

const isAllUpper = (word) => word === word.toUpperCase() && word !== word.toLowerCase();

// Apostrophes join words ("it's" -> "its") instead of splitting them.
const words = (key) => key.replace(/['\u2019]/g, '').split(SEPARATOR).filter(Boolean);

// First word of lowerCamelCase: "ID" -> "id", "UserName" -> "userName", "HTTPCode" -> "httpCode".
function lowerWord(word) {
  if (isAllUpper(word)) return word.toLowerCase();
  const run = /^\p{Lu}+/u.exec(word);
  if (!run) return word;
  if (run[0].length === 1) return word[0].toLowerCase() + word.slice(1);
  return run[0].slice(0, -1).toLowerCase() + word.slice(run[0].length - 1);
}

// Later words: "name" -> "Name", "ID" -> "Id", "userInfo" -> "UserInfo".
function upperWord(word) {
  if (isAllUpper(word) && word.length > 1) return word[0] + word.slice(1).toLowerCase();
  return word[0].toUpperCase() + word.slice(1);
}

export function toCamelCase(key) {
  return words(key)
    .map((word, i) => (i === 0 ? lowerWord(word) : upperWord(word)))
    .join('');
}

export function toPascalCase(key) {
  return words(key).map(upperWord).join('');
}

/** Replaces characters that cannot appear in an identifier with '_'. */
export function toIdentifierChars(key) {
  return key.replace(NOT_ID_PART, '_');
}

export function lowerFirst(name) {
  return name ? lowerWord(name) : name;
}

// --- Singular names for list item classes -------------------------------

// Kept as written: some of these look plural but name one thing in an API ("settings", "details").
const UNCOUNTABLE = new Set([
  'data', 'metadata', 'info', 'information', 'media', 'news', 'series', 'species', 'status', 'feedback',
  'equipment', 'staff', 'sheep', 'fish', 'deer', 'analytics', 'settings', 'stats', 'details', 'contents',
  'goods', 'means', 'physics', 'mathematics', 'economics', 'lyrics', 'credits', 'thanks', 'jeans', 'glasses',
]);
const IRREGULAR = {
  people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', geese: 'goose',
  feet: 'foot', teeth: 'tooth', indices: 'index', matrices: 'matrix', vertices: 'vertex',
  criteria: 'criterion', phenomena: 'phenomenon', leaves: 'leaf', wolves: 'wolf', knives: 'knife',
  wives: 'wife', lives: 'life', halves: 'half', shelves: 'shelf', thieves: 'thief', loaves: 'loaf',
  calves: 'calf', elves: 'elf', selves: 'self', scarves: 'scarf', hooves: 'hoof', heroes: 'hero',
  potatoes: 'potato', tomatoes: 'tomato', echoes: 'echo', vetoes: 'veto', torpedoes: 'torpedo',
  statuses: 'status', bonuses: 'bonus', campuses: 'campus', viruses: 'virus', buses: 'bus',
  censuses: 'census', syllabuses: 'syllabus', radiuses: 'radius', focuses: 'focus', aliases: 'alias',
  canvases: 'canvas', analyses: 'analysis', axes: 'axis', bases: 'base', caches: 'cache', niches: 'niche',
  headaches: 'headache', avalanches: 'avalanche', moustaches: 'moustache', mustaches: 'mustache',
  movies: 'movie', cookies: 'cookie', rookies: 'rookie', selfies: 'selfie', zombies: 'zombie',
  pies: 'pie', ties: 'tie', calories: 'calorie', brownies: 'brownie', goalies: 'goalie', hoodies: 'hoodie',
  freebies: 'freebie', newbies: 'newbie', lies: 'lie',
};

// Singularizes the last word of a PascalCase name, keeping its case:
// "UserAddresses" -> "UserAddress", "Categories" -> "Category", "IDs" -> "ID".
export function singularize(name) {
  const last = /\p{Lu}?[\p{Ll}\p{Nd}]*$/u.exec(name)[0] || name;
  const singular = singularWord(last);
  return singular ? name.slice(0, name.length - last.length) + singular : name;
}

function singularWord(word) {
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return word;
  const irregular = Object.hasOwn(IRREGULAR, lower) ? IRREGULAR[lower] : undefined;
  if (irregular) return word[0] === lower[0] ? irregular : irregular[0].toUpperCase() + irregular.slice(1);
  if (/[^aeiou]ies$/.test(lower)) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|ch|sh|zz)es$/.test(lower)) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(lower)) return word;
  if (/[^s]s$/.test(lower)) return word.slice(0, -1);
  return word;
}

// --- Names a generated class must not take ------------------------------

const GLOBALS = `
Object Function String Number Boolean Symbol BigInt Array ReadonlyArray Map Set WeakMap WeakSet WeakRef
Date RegExp Error EvalError RangeError ReferenceError SyntaxError TypeError URIError AggregateError
Promise PromiseLike JSON Math Reflect Proxy Intl ArrayBuffer SharedArrayBuffer DataView Atomics Iterator
Generator Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array
Float32Array Float64Array BigInt64Array BigUint64Array ArrayLike Record Partial Required Readonly Pick
Omit Exclude Extract NonNullable ReturnType Parameters InstanceType Awaited ThisType Uppercase Lowercase
Capitalize Uncapitalize PropertyKey ClassDecorator PropertyDecorator MethodDecorator ParameterDecorator
TemplateStringsArray ESObject Sendable Concurrent Console Infinity NaN
`;

// ArkUI components, decorators and common global types, visible in every .ets file.
const ARKUI = `
AlphabetIndexer ArcList ArcListItem Badge Blank Button Calendar CalendarPicker Canvas Checkbox
CheckboxGroup Circle Column ColumnSplit ContainerSpan Counter DataPanel DatePicker Divider Ellipse
EmbeddedComponent Flex FlowItem FolderStack FormComponent FormLink Gauge Grid GridCol GridItem GridRow
Hyperlink Image ImageAnimator ImageSpan IsolatedComponent Line List ListItem ListItemGroup
LoadingProgress Marquee Menu MenuItem MenuItemGroup NavDestination NavRouter Navigation Navigator
NodeContainer Panel Particle Path PatternLock PluginComponent Polygon Polyline Progress QRCode Radio
Rating Rect Refresh RelativeContainer Remote RichEditor RichText Row RowSplit Scroll ScrollBar Search
Select Shape SideBarContainer Slider Span Stack Stepper StepperItem Swiper SymbolGlyph SymbolSpan
TabContent Tabs Text TextArea TextClock TextInput TextPicker TextTimer TimePicker Toggle
UIExtensionComponent Video WaterFlow Web WindowScene XComponent
Component ComponentV2 Entry Preview CustomDialog Reusable ReusableV2 State Prop Link Provide Consume
Observed ObservedV2 ObjectLink Watch Builder BuilderParam LocalBuilder Styles Extend AnimatableExtend
StorageLink StorageProp LocalStorageLink LocalStorageProp Require Track Trace Local Param Once Event
Monitor Computed Provider Consumer Type
AppStorage AppStorageV2 PersistenceV2 LocalStorage PersistentStorage Environment Context Resource
ResourceColor ResourceStr Color Length Dimension Margin Padding Position Offset Area Size SizeOptions
Edges BorderOptions Font FontWeight FontStyle Alignment Axis Curve Direction Visibility ImageFit
TextAlign TextOverflow FlexAlign FlexDirection FlexWrap ItemAlign HorizontalAlign VerticalAlign
BarState EdgeEffect Placement ShadowOptions ShadowStyle LinearGradient Rectangle Point Matrix4
TransitionEffect AnimateParam ClickEvent TouchEvent KeyEvent GestureEvent CustomComponent
`;

const RESERVED_CLASS_NAMES = new Set(`${GLOBALS} ${ARKUI}`.split(/\s+/).filter(Boolean));

export function isReservedClassName(name) {
  return RESERVED_CLASS_NAMES.has(name);
}

// Members every generated class already has, so a field cannot take their name.
export const RESERVED_MEMBERS = new Set(['constructor', 'fromJson', 'toJson']);

// Words that cannot name a local variable in the usage snippet.
export const KEYWORDS = new Set(`
break case catch class const continue debugger default delete do else enum export extends false finally
for function if import in instanceof new null return super switch this throw true try typeof var void
while with as implements interface let package private protected public static yield any boolean
constructor declare get module require number set string symbol type from of async await undefined
`.split(/\s+/).filter(Boolean));

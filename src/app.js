import { startAnalytics } from './analytics.js';
import { ConvertError, convertJson, DEFAULT_OPTIONS } from './converter.js';
import { highlight, highlightLines, escapeHtml } from './highlight.js';
import { formatJson, JsonParseError, parseJson } from './json-parser.js';
import { createZip } from './zip.js';

const STORAGE_KEY = 'json-to-arkts';

const SAMPLE = `{
  "id": 1024,
  "user_name": "ahmet",
  "is_verified": true,
  "rating": 4.8,
  "tags": ["harmonyos", "arkts"],
  "address": {
    "city": "Istanbul",
    "zip_code": "34000",
    "location": { "lat": 41.01, "lng": 28.97 }
  },
  "orders": [
    {
      "order_id": "A-1",
      "total": 99.9,
      "items": [{ "sku": "W-42", "quantity": 1 }]
    },
    {
      "order_id": "A-2",
      "total": 10,
      "coupon": "SAVE10",
      "items": []
    }
  ],
  "avatar": null
}
`;

const $ = (id) => document.getElementById(id);
const el = {
  json: $('json'),
  gutter: $('gutter'),
  error: $('json-error'),
  errorWhere: $('error-where'),
  errorMessage: $('error-message'),
  form: $('options'),
  className: $('className'),
  nullStyle: $('nullStyle'),
  observed: $('observed'),
  privateFields: $('privateFields'),
  camelCase: $('camelCase'),
  exportClasses: $('exportClasses'),
  filePerClass: $('filePerClass'),
  tabs: $('tabs'),
  code: $('code'),
  codeBox: $('code-box'),
  copy: $('copy'),
  download: $('download'),
  stale: $('stale'),
  warningsBox: $('warnings-box'),
  warningsCount: $('warnings-count'),
  warnings: $('warnings'),
  usageBox: $('usage-box'),
  usage: $('usage'),
  status: $('status'),
  theme: $('theme'),
};

let result = null;
let activeFile = 0;
let generatedFrom = null;
let errorLine = 0;
let exportChoice = true;

// --- Storage ------------------------------------------------------------------

function loadState() {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const theme = document.documentElement.dataset.theme ?? null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ json: el.json.value, options: readOptions(), theme }));
    } catch {
      // Private windows and blocked storage: settings are simply not kept.
    }
  }, 250);
}

// --- Options ------------------------------------------------------------------

function readOptions() {
  return {
    className: el.className.value,
    nullStyle: el.nullStyle.value,
    observed: el.observed.value,
    privateFields: el.privateFields.checked,
    camelCase: el.camelCase.checked,
    exportClasses: el.filePerClass.checked ? exportChoice : el.exportClasses.checked,
    filePerClass: el.filePerClass.checked,
  };
}

function writeOptions(options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  el.className.value = typeof opts.className === 'string' ? opts.className : DEFAULT_OPTIONS.className;
  setSelect(el.nullStyle, opts.nullStyle);
  setSelect(el.observed, opts.observed);
  el.privateFields.checked = Boolean(opts.privateFields);
  el.camelCase.checked = Boolean(opts.camelCase);
  exportChoice = Boolean(opts.exportClasses);
  el.exportClasses.checked = exportChoice;
  el.filePerClass.checked = Boolean(opts.filePerClass);
  syncExportCheckbox();
}

function setSelect(select, value) {
  if ([...select.options].some((option) => option.value === value)) select.value = value;
}

// One file per class needs exports to import the classes from each other.
function syncExportCheckbox() {
  const perFile = el.filePerClass.checked;
  el.exportClasses.disabled = perFile;
  el.exportClasses.checked = perFile ? true : exportChoice;
  el.exportClasses.parentElement.title = perFile ? 'Files import each other, so classes are always exported' : '';
}

// --- JSON editor ----------------------------------------------------------------

let gutterLines = 0;
function renderGutter(force = false) {
  const lines = el.json.value.split('\n').length;
  if (!force && lines === gutterLines) return;
  gutterLines = lines;
  let html = '';
  for (let i = 1; i <= lines; i++) html += i === errorLine ? `<span class="error-line">${i}</span>` : `<span>${i}</span>`;
  el.gutter.innerHTML = html;
  el.gutter.scrollTop = el.json.scrollTop;
}

// Replaces the editor text through the browser's editing commands so undo still works.
function replaceJson(text) {
  el.json.focus();
  el.json.select();
  const ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
  if (!ok || el.json.value !== text) el.json.value = text;
  el.json.setSelectionRange(0, 0);
  el.json.scrollTop = 0;
  onJsonInput();
}

function onJsonInput() {
  if (errorLine) clearError();
  renderGutter();
  markStale();
  saveState();
}

function showError(message, error) {
  el.error.hidden = false;
  el.errorMessage.textContent = message;
  if (error) {
    el.errorWhere.textContent = `Line ${error.line}, column ${error.column}`;
    el.errorWhere.onclick = () => jumpTo(error);
    errorLine = error.line;
  } else {
    el.errorWhere.textContent = '';
    errorLine = 0;
  }
  renderGutter(true);
  announce(error ? `Invalid JSON at line ${error.line}, column ${error.column}: ${message}` : message);
}

function clearError() {
  el.error.hidden = true;
  if (errorLine) {
    errorLine = 0;
    renderGutter(true);
  }
}

function jumpTo(error) {
  const end = Math.min(error.offset + 1, el.json.value.length);
  el.json.focus();
  el.json.setSelectionRange(error.offset, end);
  const lineHeight = parseFloat(getComputedStyle(el.json).lineHeight) || 20;
  const target = (error.line - 1) * lineHeight;
  if (target < el.json.scrollTop || target > el.json.scrollTop + el.json.clientHeight - lineHeight * 2) {
    el.json.scrollTop = Math.max(0, target - el.json.clientHeight / 3);
  }
}

function formatInput() {
  try {
    const { value } = parseJson(el.json.value);
    replaceJson(`${formatJson(value)}\n`);
    announce('JSON formatted');
  } catch (error) {
    if (!(error instanceof JsonParseError)) throw error;
    showError(error.message, error);
  }
}

// --- Generate -------------------------------------------------------------------

const snapshot = () => JSON.stringify([el.json.value, readOptions()]);

function markStale() {
  el.stale.hidden = !result || snapshot() === generatedFrom;
}

function generate() {
  let next;
  try {
    next = convertJson(el.json.value, readOptions());
  } catch (error) {
    if (error instanceof JsonParseError) showError(error.message, error);
    else if (error instanceof ConvertError) showError(error.message);
    else throw error;
    markStale();
    return;
  }
  clearError();
  result = next;
  activeFile = 0;
  generatedFrom = snapshot();
  renderOutput();
  saveState();
  const count = result.classNames.length;
  announce(`Generated ${count} ${count === 1 ? 'class' : 'classes'}`);
}

function renderOutput() {
  const { files, warnings, usage } = result;

  el.tabs.hidden = files.length < 2;
  el.tabs.replaceChildren(
    ...files.map((file, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.id = `tab-${index}`;
      tab.textContent = file.name;
      tab.setAttribute('aria-selected', String(index === activeFile));
      tab.setAttribute('aria-controls', 'code-box');
      tab.tabIndex = index === activeFile ? 0 : -1;
      tab.addEventListener('click', () => selectFile(index));
      return tab;
    }),
  );

  renderCode();

  el.copy.disabled = false;
  el.download.disabled = false;
  el.download.textContent = files.length > 1 ? 'Download .zip' : 'Download .ets';

  el.warningsBox.hidden = warnings.length === 0;
  el.warningsCount.textContent = String(warnings.length);
  el.warnings.replaceChildren(
    ...warnings.map(({ path, message }) => {
      const item = document.createElement('li');
      item.innerHTML = `<code>${escapeHtml(path)}</code> ${escapeHtml(message)}`;
      return item;
    }),
  );

  el.usageBox.hidden = false;
  el.usage.innerHTML = highlight(usage);
  el.stale.hidden = true;
}

function renderCode() {
  const file = result.files[activeFile];
  el.code.innerHTML = highlightLines(file.content);
  el.codeBox.setAttribute('aria-label', `Generated ArkTS code, ${file.name}`);
  if (result.files.length > 1) el.codeBox.setAttribute('aria-labelledby', `tab-${activeFile}`);
  else el.codeBox.removeAttribute('aria-labelledby');
}

function selectFile(index, focus = false) {
  activeFile = index;
  [...el.tabs.children].forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    if (focus && i === index) tab.focus();
  });
  renderCode();
  el.codeBox.scrollTop = 0;
}

// --- Copy and download --------------------------------------------------------------

async function copyCode() {
  const { content, name } = result.files[activeFile];
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const area = document.createElement('textarea');
    area.value = content;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  flash(el.copy, 'Copied');
  announce(`${name} copied to the clipboard`);
}

function downloadCode() {
  const { files, classNames } = result;
  let blob;
  let name;
  if (files.length === 1) {
    blob = new Blob([files[0].content], { type: 'text/plain;charset=utf-8' });
    name = files[0].name;
  } else {
    blob = new Blob([createZip(files)], { type: 'application/zip' });
    name = `${classNames[0]}.zip`;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  announce(`${name} downloaded`);
}

function flash(button, text) {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  button.classList.add('done');
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => {
    button.textContent = original;
    button.classList.remove('done');
  }, 1400);
}

function announce(text) {
  el.status.textContent = '';
  requestAnimationFrame(() => {
    el.status.textContent = text;
  });
}

// --- Theme -------------------------------------------------------------------------

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme ?? (prefersDark.matches ? 'dark' : 'light')) === 'dark';

function syncThemeButton() {
  el.theme.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
}

function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  // Back to following the system when the choice matches it.
  if ((next === 'dark') === prefersDark.matches) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  syncThemeButton();
  saveState();
}

// --- Wiring --------------------------------------------------------------------------

function start() {
  const state = loadState();
  writeOptions(state.options ?? {});
  el.json.value = typeof state.json === 'string' ? state.json : SAMPLE;
  renderGutter(true);
  syncThemeButton();

  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) $('mod-key').textContent = '⌘';

  el.json.addEventListener('input', onJsonInput);
  el.json.addEventListener('scroll', () => {
    el.gutter.scrollTop = el.json.scrollTop;
  });

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    generate();
  });
  el.form.addEventListener('input', () => {
    markStale();
    saveState();
  });
  el.exportClasses.addEventListener('change', () => {
    if (!el.filePerClass.checked) exportChoice = el.exportClasses.checked;
  });
  el.filePerClass.addEventListener('change', () => {
    syncExportCheckbox();
    markStale();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      generate();
    }
  });

  el.tabs.addEventListener('keydown', (event) => {
    const count = result?.files.length ?? 0;
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -activeFile, End: count - 1 - activeFile };
    if (!count || !(event.key in moves)) return;
    event.preventDefault();
    selectFile((activeFile + moves[event.key] + count) % count, true);
  });

  $('sample').addEventListener('click', () => replaceJson(SAMPLE));
  $('format').addEventListener('click', formatInput);
  $('clear').addEventListener('click', () => replaceJson(''));
  el.copy.addEventListener('click', copyCode);
  el.download.addEventListener('click', downloadCode);
  el.theme.addEventListener('click', toggleTheme);
  prefersDark.addEventListener('change', syncThemeButton);

  if (el.json.value.trim()) generate();
  startAnalytics();
}

start();

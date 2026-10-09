// Syntax highlighting for the ArkTS this tool writes. Tokens never span
// lines, so the HTML can be split on '\n' afterwards.

const TOKEN = new RegExp(
  [
    String.raw`(\/\/[^\n]*)`, // 1 comment
    String.raw`('(?:\\.|[^'\\\n])*')`, // 2 string
    String.raw`(@[A-Za-z_$][\w$]*)`, // 3 decorator
    String.raw`\b(export|class|static|const|let|new|return|if|this|get|set|private|as|import|from|function)\b`, // 4 keyword
    String.raw`\b(null|undefined|true|false)\b`, // 5 literal
    String.raw`\b(\d+(?:\.\d+)?)\b`, // 6 number
    String.raw`\b(number|string|boolean|Object|Record)\b`, // 7 built-in type
    String.raw`\b([A-Z][\w$]*)\b`, // 8 class name
    String.raw`([A-Za-z_$][\w$]*)(?=\()`, // 9 function call
  ].join('|'),
  'g',
);

const CLASSES = [null, 'tok-comment', 'tok-string', 'tok-decorator', 'tok-keyword', 'tok-literal', 'tok-number', 'tok-type', 'tok-class', 'tok-function'];

export function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

/** Returns HTML for code with each token in a <span class="tok-…">. */
export function highlight(code) {
  let html = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(code); match; match = TOKEN.exec(code)) {
    html += escapeHtml(code.slice(last, match.index));
    const group = match.findIndex((value, i) => i > 0 && value !== undefined);
    html += `<span class="${CLASSES[group]}">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(code.slice(last));
}

/** Highlighted code as one <span class="line"> per line, for numbered display. */
export function highlightLines(code) {
  const body = code.endsWith('\n') ? code.slice(0, -1) : code;
  return highlight(body)
    .split('\n')
    .map((line) => `<span class="line">${line || ' '}</span>`)
    .join('\n');
}

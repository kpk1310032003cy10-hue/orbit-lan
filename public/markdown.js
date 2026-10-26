import MarkdownIt from './vendor/markdown-it.js';
import hljs from './vendor/highlight.js';
import bash from './vendor/highlight/bash.js';
import css from './vendor/highlight/css.js';
import diff from './vendor/highlight/diff.js';
import javascript from './vendor/highlight/javascript.js';
import json from './vendor/highlight/json.js';
import markdown from './vendor/highlight/markdown.js';
import powershell from './vendor/highlight/powershell.js';
import python from './vendor/highlight/python.js';
import sql from './vendor/highlight/sql.js';
import typescript from './vendor/highlight/typescript.js';
import xml from './vendor/highlight/xml.js';
import yaml from './vendor/highlight/yaml.js';

for (const [name, grammar] of Object.entries({
  bash,
  css,
  diff,
  javascript,
  json,
  markdown,
  powershell,
  python,
  sql,
  typescript,
  xml,
  yaml,
}))
  hljs.registerLanguage(name, grammar);
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const parser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
  maxNesting: 32,
});
const aliases = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  ps1: 'powershell',
  ps: 'powershell',
  html: 'xml',
  htm: 'xml',
  yml: 'yaml',
  md: 'markdown',
};
const names = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  powershell: 'PowerShell',
  bash: 'Shell',
  json: 'JSON',
  css: 'CSS',
  xml: 'HTML / XML',
  yaml: 'YAML',
  sql: 'SQL',
  diff: 'Изменения',
  markdown: 'Markdown',
};

export function externalURL(value) {
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const localReference = (href) => {
  let decoded;
  try {
    decoded = decodeURIComponent(href).replaceAll('\\', '/');
  } catch {
    return false;
  }
  const path = decoded
    .replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/, '')
    .replace(/^\/([a-z]:\/)/i, '$1');
  return (
    !/^(?:\/\/|[a-z][a-z\d+.-]*:)/i.test(path.replace(/^[a-z]:\//i, '')) &&
    /[./]/.test(path) &&
    !/[\u0000-\u001f\u007f?]/.test(decoded)
  );
};
parser.validateLink = (value) => Boolean(externalURL(value) || localReference(value));
parser.renderer.rules.link_open = (tokens, index, options, env) => {
  const token = tokens[index];
  const target = token.attrGet('href') || '';
  const url = externalURL(target);
  const kind = url ? 'a' : 'button';
  (env.linkKinds ||= []).push(kind);
  return url
    ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">`
    : `<button type="button" class="file-reference" data-a="file-reference" data-path="${escapeHTML(target)}" title="Открыть файл в рабочей папке">`;
};
parser.renderer.rules.link_close = (tokens, index, options, env) =>
  `</${env.linkKinds?.pop() || 'a'}>`;
parser.renderer.rules.image = (tokens, index) => {
  const token = tokens[index],
    url = externalURL(token.attrGet('src') || '');
  const label = 'Изображение' + (token.content ? ': ' + token.content : '');
  // Remote images are deliberately links, never background network requests.
  return url
    ? `<a class="image-reference" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`
    : `<span class="image-reference">${escapeHTML(label)}</span>`;
};
function codeHTML(text, info, env) {
  const requested = String(info || '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  const language = aliases[requested] || requested;
  let code = escapeHTML(text);
  if (text.length <= 24000 && hljs.getLanguage(language)) {
    try {
      code = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      /* Plain code is always available. */
    }
  }
  const label = names[language] || (/^[a-z\d_+#.-]{1,24}$/i.test(requested) ? requested : 'Код');
  const index = (env.codeIndex = (env.codeIndex ?? -1) + 1);
  return `<figure class="code-block" data-code-index="${index}"><figcaption><span>${escapeHTML(label || 'Код')}</span><button type="button" data-a="copy-code" aria-label="Копировать код">Копировать</button></figcaption><pre tabindex="0" aria-label="${escapeHTML(label || 'Код')}"><code>${code}</code></pre></figure>\n`;
}
parser.renderer.rules.fence = (tokens, index, options, env) =>
  codeHTML(tokens[index].content, tokens[index].info, env);
parser.renderer.rules.code_block = (tokens, index, options, env) =>
  codeHTML(tokens[index].content, '', env);
parser.renderer.rules.table_open = (tokens, index, options, env) => {
  const number = (env.tableIndex = (env.tableIndex ?? -1) + 1);
  return `<figure class="message-table" data-table-index="${number}"><figcaption><span>Таблица</span><div><button type="button" data-a="table-view" aria-pressed="false">Карточки</button><button type="button" data-a="copy-table" aria-label="Копировать таблицу">Копировать</button></div></figcaption><div class="table-scroll" tabindex="0" role="region" aria-label="Таблица сообщения, доступна горизонтальная прокрутка"><table>\n`;
};
parser.renderer.rules.table_close = () =>
  '</table></div><div class="table-cards" hidden></div></figure>\n';
for (const tag of ['th', 'td'])
  parser.renderer.rules[tag + '_open'] = (tokens, index) => {
    const alignment = /text-align:(left|center|right)/.exec(
      tokens[index].attrGet('style') || '',
    )?.[1];
    return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${alignment ? ` class="align-${alignment}"` : ''}>`;
  };
parser.core.ruler.after('inline', 'orbit_task_lists', (state) => {
  for (let i = 0; i < state.tokens.length - 2; i++) {
    if (state.tokens[i].type !== 'list_item_open' || state.tokens[i + 2].type !== 'inline')
      continue;
    const children = state.tokens[i + 2].children;
    const match = children?.[0]?.type === 'text' && /^\[([ xX])\]\s+/.exec(children[0].content);
    if (!match) continue;
    children[0].content = children[0].content.slice(match[0].length);
    const marker = new state.Token('task_marker', '', 0);
    marker.meta = { checked: match[1].toLowerCase() === 'x' };
    children.unshift(marker);
    state.tokens[i].attrJoin('class', 'task-list-item');
  }
});
parser.renderer.rules.task_marker = (tokens, index) =>
  `<span class="task-marker ${tokens[index].meta.checked ? 'checked' : ''}" role="img" aria-label="${tokens[index].meta.checked ? 'Выполнено' : 'Не выполнено'}">${tokens[index].meta.checked ? '✓' : ''}</span>`;

const cache = new Map();
let cacheSize = 0;
export function renderMarkdown(value) {
  const text = String(value ?? '');
  if (cache.has(text)) return cache.get(text);
  let html;
  try {
    html =
      text.length > 250000
        ? `<div class="plain-long-message">${escapeHTML(text)}</div>`
        : parser.render(text, {});
  } catch {
    html = `<div class="plain-long-message">${escapeHTML(text)}</div>`;
  }
  if (text.length < 100000) {
    cache.set(text, html);
    cacheSize += text.length + html.length;
    while (cache.size > 80 || cacheSize > 1500000) {
      const oldest = cache.keys().next().value;
      cacheSize -= oldest.length + cache.get(oldest).length;
      cache.delete(oldest);
    }
  }
  return html;
}

const normalizePath = (value) => {
  const prefix = /^[a-z]:/i.exec(value)?.[0] || (value.startsWith('/') ? '/' : '');
  const parts = value.slice(prefix.length).split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) return null;
      stack.pop();
    } else stack.push(part);
  }
  return prefix === '/' ? '/' + stack.join('/') : prefix + '/' + stack.join('/');
};
export function resolveFileReference(value, cwd, roots) {
  let raw;
  try {
    raw = decodeURIComponent(value).replaceAll('\\', '/');
  } catch {
    return null;
  }
  raw = raw.replace(/^\/([a-z]:\/)/i, '$1');
  if (!localReference(raw) || raw.startsWith('//')) return null;
  const location = /(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?)$/.exec(raw);
  const line = location ? Math.min(1000000, Math.max(1, Number(location[1] || location[2]))) : null;
  if (location) raw = raw.slice(0, location.index);
  if (/[#?:]/.test(raw.replace(/^[a-z]:/i, ''))) return null;
  const absolute = normalizePath(/^(?:[a-z]:\/|\/)/i.test(raw) ? raw : `${cwd || ''}/${raw}`);
  if (!absolute) return null;
  for (const root of [...roots].sort((a, b) => b.path.length - a.path.length)) {
    const normalized = normalizePath(root.path.replaceAll('\\', '/'));
    if (!normalized) continue;
    const windows = /^[a-z]:/i.test(normalized);
    const target = windows ? absolute.toLowerCase() : absolute;
    const base = windows ? normalized.toLowerCase() : normalized;
    if (target.startsWith(base.replace(/\/$/, '') + '/'))
      return { root: root.id, path: absolute.slice(base.replace(/\/$/, '').length + 1), line };
  }
  return null;
}

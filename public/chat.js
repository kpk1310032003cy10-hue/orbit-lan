import { escapeHTML, renderMarkdown } from './markdown.js';

const statusLabels = {
  inProgress: 'В работе',
  completed: 'Готово',
  failed: 'Ошибка',
  declined: 'Отклонено',
};
const copyIcon =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg>';

export function transcriptModel(events) {
  const result = [],
    items = new Map();
  const item = (id, patch, event) => {
    const key = 'item:' + id;
    if (items.has(key)) {
      Object.assign(items.get(key), patch);
      return;
    }
    const entry = { id: key, created: event.created, ...patch };
    items.set(key, entry);
    result.push(entry);
  };
  for (const [index, event] of events.entries()) {
    const p = event.payload || {},
      id = 'event:' + (event.seq ?? index);
    if (['user', 'assistant', 'system', 'error'].includes(event.kind))
      result.push({ id, type: event.kind, text: String(p.text ?? ''), created: event.created });
    if (event.kind === 'delta') {
      const key = p.itemId ?? id;
      item(
        key,
        { type: 'assistant', text: (items.get('item:' + key)?.text || '') + (p.text || '') },
        event,
      );
    }
    if (event.kind === 'item') {
      const value = p.item || {},
        key = value.id ?? id;
      if (value.type === 'agentMessage' && value.text)
        item(key, { type: 'assistant', text: value.text, phase: value.phase }, event);
      else if (value.type === 'commandExecution')
        item(
          key,
          {
            type: 'tool',
            title: value.command || 'Команда',
            text: value.aggregatedOutput || '',
            status: value.status,
          },
          event,
        );
      else if (value.type === 'fileChange')
        item(
          key,
          {
            type: 'tool',
            title: 'Изменения файлов',
            text: (value.changes || [])
              .map((change) => `${change.path}\n${change.diff || ''}`)
              .join('\n\n'),
            status: value.status,
          },
          event,
        );
      else if (['mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(value.type))
        item(
          key,
          {
            type: 'tool',
            title: value.tool || value.type,
            text: JSON.stringify(value.result || value.arguments || value.action || {}, null, 2),
          },
          event,
        );
    }
    if (event.kind === 'output') {
      if (p.itemId) {
        const previous = items.get('item:' + p.itemId);
        item(
          p.itemId,
          {
            type: 'tool',
            title: previous?.title || 'Команда',
            text: (previous?.text || '') + p.text,
          },
          event,
        );
      } else if (result.at(-1)?.type === 'output') result.at(-1).text += p.text;
      else result.push({ id, type: 'output', text: p.text, created: event.created });
    }
    if (event.kind === 'tool')
      result.push({
        id,
        type: 'tool',
        title: p.name,
        text: JSON.stringify(p.input, null, 2),
        created: event.created,
      });
    if (event.kind === 'plan')
      item(
        'plan',
        {
          type: 'plan',
          title: 'План работы',
          steps: p.plan || [],
          text: (p.plan || [])
            .map(
              (step) =>
                `${step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '→' : '○'} ${step.step}`,
            )
            .join('\n'),
        },
        event,
      );
    if (event.kind === 'completed')
      result.push({
        id,
        type: 'system',
        text:
          p.status === 'interrupted'
            ? 'Задача остановлена'
            : p.status === 'failed'
              ? 'Задача завершена с ошибкой'
              : `Задача завершена${p.code !== undefined ? ` · код ${p.code}` : ''}${p.cost ? ` · $${p.cost.toFixed(3)}` : ''}`,
        created: event.created,
      });
  }
  return result;
}

function tableCards(figure) {
  const destination = figure.querySelector('.table-cards');
  destination.replaceChildren();
  const labels = [...figure.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
  for (const row of figure.querySelectorAll('tbody tr')) {
    const card = document.createElement('section');
    card.className = 'table-record';
    const values = [...row.cells];
    const title = document.createElement('div');
    title.className = 'table-record-title';
    title.append(...[...(values[0]?.childNodes || [])].map((node) => node.cloneNode(true)));
    card.append(title);
    const fields = document.createElement('dl');
    for (let i = 1; i < values.length; i++) {
      const label = document.createElement('dt');
      label.textContent = labels[i] || `Столбец ${i + 1}`;
      const value = document.createElement('dd');
      value.append(...[...values[i].childNodes].map((node) => node.cloneNode(true)));
      fields.append(label, value);
    }
    card.append(fields);
    destination.append(card);
  }
}
export function setTableView(figure, cards) {
  if (cards) tableCards(figure);
  figure.classList.toggle('cards-view', cards);
  figure.querySelector('figcaption > span').textContent = cards ? 'Карточки' : 'Таблица';
  figure.querySelector('.table-scroll').hidden = cards;
  figure.querySelector('.table-cards').hidden = !cards;
  const button = figure.querySelector('[data-a="table-view"]');
  button.setAttribute('aria-pressed', String(cards));
  button.textContent = cards ? 'Таблица' : 'Карточки';
}
export function tableText(figure) {
  return [...figure.querySelector('table').rows]
    .map((row) =>
      [...row.cells]
        .map((cell) => {
          const text = cell.textContent.trim();
          return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
        })
        .join('\t'),
    )
    .join('\n');
}
function preserveBodyState(body, html) {
  const tables = [...body.querySelectorAll('.message-table')].map((table) => ({
    index: table.dataset.tableIndex,
    cards: table.classList.contains('cards-view'),
    left: table.querySelector('.table-scroll').scrollLeft,
  }));
  const code = [...body.querySelectorAll('.code-block')].map((block) => ({
    index: block.dataset.codeIndex,
    left: block.querySelector('pre').scrollLeft,
  }));
  const active = document.activeElement;
  const focused = body.contains(active) && active.matches('button,pre,.table-scroll');
  const owner = focused && active.closest('[data-code-index],[data-table-index]');
  const focus = owner
    ? {
        code: owner.dataset.codeIndex,
        table: owner.dataset.tableIndex,
        action: active.dataset.a,
        tag: active.tagName.toLowerCase(),
      }
    : null;
  body.innerHTML = html;
  for (const state of tables) {
    const table = body.querySelector(`[data-table-index="${state.index}"]`);
    if (table) {
      if (state.cards) setTableView(table, true);
      table.querySelector('.table-scroll').scrollLeft = state.left;
    }
  }
  for (const state of code) {
    const pre = body.querySelector(`[data-code-index="${state.index}"] pre`);
    if (pre) pre.scrollLeft = state.left;
  }
  if (focus) {
    const block = body.querySelector(
      focus.code !== undefined
        ? `[data-code-index="${focus.code}"]`
        : `[data-table-index="${focus.table}"]`,
    );
    const control = block?.querySelector(
      focus.action ? `[data-a="${focus.action}"]` : focus.tag === 'pre' ? 'pre' : '.table-scroll',
    );
    control?.focus({ preventScroll: true });
  }
}

export class TranscriptView {
  constructor(container, { provider = 'Агент', empty = '' } = {}) {
    Object.assign(this, { container, provider, empty });
    this.nodes = new Map();
    this.messages = new Map();
    this.hasDeferred = false;
  }
  create(message) {
    const tool = ['tool', 'plan', 'output'].includes(message.type);
    const node = document.createElement(tool && message.type !== 'output' ? 'details' : 'article');
    node.className =
      tool && message.type !== 'output'
        ? 'tool' + (message.type === 'plan' ? ' agent-plan' : '')
        : 'message ' + message.type;
    node.dataset.messageId = message.id;
    if (tool && message.type !== 'output') {
      node.dataset.toolId = message.id;
      node.innerHTML =
        '<summary><span class="tool-title"></span><span class="tool-status"></span></summary><div class="tool-body"></div>';
      if (message.type === 'plan') node.open = true;
    } else {
      const tag = message.type === 'output' ? 'pre' : 'div';
      node.innerHTML = `<div class="message-label"><span class="message-role"></span><time></time><button type="button" class="message-copy" data-a="copy-message" aria-label="Копировать сообщение" title="Копировать сообщение">${copyIcon}<span>Копировать</span></button></div><${tag} class="message-text ${['user', 'assistant'].includes(message.type) ? 'rich-text' : message.type === 'output' ? 'plain-message tool-output' : 'plain-message'}"></${tag}>`;
      node.querySelector('.message-role').textContent =
        message.type === 'user'
          ? 'Вы'
          : message.type === 'system'
            ? 'Система'
            : message.type === 'error'
              ? 'Ошибка'
              : message.type === 'output'
                ? 'Вывод команды'
                : this.provider;
      const time = node.querySelector('time');
      if (Number.isFinite(message.created) && message.created > 0) {
        const date = new Date(message.created);
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        time.title = date.toLocaleString('ru-RU');
      } else time.remove();
    }
    return { node, text: null, status: null, type: message.type };
  }
  update(events) {
    const models = transcriptModel(events);
    this.messages = new Map(models.map((message) => [message.id, message]));
    this.hasDeferred = false;
    if (!models.length) {
      if (this.nodes.size || this.container.innerHTML !== this.empty)
        this.container.innerHTML = this.empty;
      this.nodes.clear();
      return;
    }
    if (!this.nodes.size) this.container.replaceChildren();
    const selection = window.getSelection();
    const selected = selection && !selection.isCollapsed ? selection.anchorNode : null;
    let cursor = this.container.firstElementChild;
    for (const message of models) {
      let entry = this.nodes.get(message.id);
      if (entry && entry.type !== message.type) {
        if (cursor === entry.node) cursor = cursor.nextElementSibling;
        entry.node.remove();
        this.nodes.delete(message.id);
        entry = null;
      }
      if (!entry) {
        entry = this.create(message);
        this.nodes.set(message.id, entry);
      }
      const { node } = entry;
      if (node !== cursor) this.container.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
      if (['tool', 'plan'].includes(message.type)) {
        node.querySelector('.tool-title').textContent = message.title || 'Действие';
        const status =
          message.type === 'plan'
            ? `${message.steps.filter((step) => step.status === 'completed').length} из ${message.steps.length}`
            : statusLabels[message.status] || message.status || '';
        if (entry.status !== status) {
          node.querySelector('.tool-status').textContent = status;
          entry.status = status;
        }
      }
      if (entry.text === message.text) continue;
      const body = node.querySelector('.tool-body,.message-text');
      if (selected && (body.contains(selected) || selection.containsNode(body, true))) {
        this.hasDeferred = true;
        continue;
      }
      if (message.type === 'plan')
        body.innerHTML = `<ol class="plan-steps">${message.steps.map((step) => `<li class="${step.status === 'completed' ? 'completed' : step.status === 'inProgress' ? 'in-progress' : 'pending'}"><span aria-hidden="true">${step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '→' : '○'}</span>${escapeHTML(step.step)}</li>`).join('')}</ol>`;
      else if (message.type === 'tool') {
        let pre = body.querySelector('pre');
        if (!pre) {
          body.innerHTML =
            '<div class="tool-actions"><button type="button" data-a="copy-message">Копировать вывод</button></div><pre class="tool-output" tabindex="0"></pre>';
          pre = body.querySelector('pre');
        }
        const top = pre.scrollTop,
          left = pre.scrollLeft;
        const follow = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 20;
        pre.textContent =
          message.text ||
          (message.status === 'completed' ? 'Без текстового вывода' : 'Выполняется…');
        pre.scrollTop = follow ? pre.scrollHeight : top;
        pre.scrollLeft = left;
      } else if (['user', 'assistant'].includes(message.type))
        preserveBodyState(body, renderMarkdown(message.text));
      else body.textContent = message.text;
      entry.text = message.text;
    }
    for (const [id, entry] of this.nodes)
      if (!this.messages.has(id)) {
        entry.node.remove();
        this.nodes.delete(id);
      }
  }
}

import { limitsHTML } from './limits.js';
const $ = (s) => document.querySelector(s);
const app = $('#app'),
  dialog = $('#dialog');
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  agent:
    '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12v2m8-2v2m-8 3h8M1 11v5m22-5v5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  send: '<path d="m12 4 7 7M12 4l-7 7m7-7v16"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  wifi: '<path d="M3 9a15 15 0 0 1 18 0M6 13a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0"/><circle cx="12" cy="21" r=".5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
  memory:
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4m5-4v4m5-4v4M6 18v3m4-3v3m4-3v3m4-3v3"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v15a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9zm0 0v6h6M8 13h8m-8 4h6"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4M10 5h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  terminal: '<path d="m5 6 6 6-6 6m8 0h6"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 1l1 5M4 12l1 5a8 8 0 0 0 13 1"/>',
  leaf: '<path d="M20 3C10 3 4 5 4 12a7 7 0 0 0 7 7c7 0 9-6 9-16ZM3 22 15 10"/>',
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.agent}</svg>`;
const button = (label, action, cls = 'secondary', name, attrs = '') =>
  `<button type="button" class="button ${cls}" data-a="${action}" ${attrs}>${name ? icon(name, 16) : ''}${escape(label)}</button>`;
const date = (ms) =>
  new Date(ms).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const ago = (ms) => {
  const d = Math.max(0, Date.now() - ms);
  return d < 60000
    ? 'только что'
    : d < 3600000
      ? `${Math.floor(d / 60000)} мин назад`
      : d < 86400000
        ? `${Math.floor(d / 3600000)} ч назад`
        : date(ms);
};
const size = (n) =>
  n > 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} ГБ`
    : n > 1024 ** 2
      ? `${Math.round(n / 1024 ** 2)} МБ`
      : n > 1024
        ? `${Math.round(n / 1024)} КБ`
        : `${n} Б`;
const leaf = (p) => p?.split(/[\\/]/).filter(Boolean).at(-1) || '';
const labels = {
  idle: 'Готов',
  running: 'Работает',
  waiting: 'Ждёт вас',
  starting: 'Запускается',
  stopping: 'Останавливается',
  stopped: 'Остановлен',
  failed: 'Ошибка',
  disconnected: 'Связь прервана',
  observed: 'История',
};
const badge = (status) =>
  `<span class="badge ${escape(status)}">${['running', 'waiting', 'starting'].includes(status) ? '● ' : ''}${labels[status] || escape(status)}</span>`;
const providerIcon = (p) =>
  `<span class="provider-icon ${escape(p)}">${p === 'codex' ? icon('agent', 21) : p === 'claude' ? '✳' : icon('terminal', 20)}</span>`;
const providerName = (p) =>
  p === 'codex' ? 'Codex' : p === 'claude' ? 'Claude Code' : 'PowerShell';
const navs = [
  ['overview', 'grid', 'Обзор'],
  ['agents', 'agent', 'Агенты'],
  ['files', 'folder', 'Файлы'],
  ['processes', 'activity', 'Процессы'],
  ['settings', 'settings', 'Подключение'],
];
const S = {
  view: 'overview',
  session: null,
  boot: null,
  overview: { agents: [], tasks: [], discovered: { sessions: [] }, system: {} },
  selected: null,
  events: [],
  externalItems: [],
  cursor: null,
  fileRoot: null,
  filePath: '',
  listing: null,
  projects: [],
  devices: [],
  online: true,
  filter: 'all',
  search: '',
  eventSource: null,
};
let toastTimer,
  refreshBusy = false,
  renderTimer,
  scrollAtBottom = true,
  historyBusy = false,
  fileVersion = null;
function toast(message, duration = 5000) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), duration);
}
async function api(url, data, method = data === undefined ? 'GET' : 'POST') {
  let response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      headers:
        data === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'X-Orbit-CSRF': S.session?.device?.csrf || '' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch {
    setConnection(false);
    throw new Error('Компьютер недоступен. Проверьте Wi-Fi и запущена ли Орбита.');
  }
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401 && S.boot) {
      S.boot = null;
      S.eventSource?.close();
      pairPage();
    }
    throw new Error(value.error || `Ошибка ${response.status}`);
  }
  setConnection(true);
  return value;
}
function setConnection(online) {
  S.online = online;
  const element = $('#connection');
  if (element) {
    element.classList.toggle('offline', !online);
    element.innerHTML = `${icon('wifi', 14)}<span class="local-label">${online ? 'Локальная сеть' : 'Нет связи'}</span><span class="pill">${online ? 'Подключено' : 'Переподключение'}</span>`;
  }
  document.querySelectorAll('[data-online]').forEach((b) => (b.disabled = !online));
}
function nav(mobile = false) {
  return `<nav class="${mobile ? 'mobile-nav' : 'nav'}" aria-label="Навигация">${navs.map(([id, name, title]) => `<button data-a="nav" data-id="${id}" class="${S.view === id ? 'active' : ''}" ${S.view === id ? 'aria-current="page"' : ''}>${icon(name, mobile ? 20 : 18)}<span class="${mobile ? '' : 'nav-text'}">${title}</span>${!mobile && id === 'agents' && liveCount() ? `<span class="nav-count">${liveCount()}</span>` : ''}</button>`).join('')}</nav>`;
}
function liveCount() {
  return S.overview.agents.filter((a) =>
    ['running', 'waiting', 'starting', 'stopping'].includes(a.status),
  ).length;
}
function allSessions() {
  return [
    ...S.overview.agents,
    ...S.overview.tasks,
    ...S.overview.discovered.sessions.filter(
      (x) => ![...S.overview.agents, ...S.overview.tasks].some((a) => a.native_id === x.id),
    ),
  ];
}
function selected() {
  return allSessions().find((a) => a.id === S.selected);
}
function shell() {
  if (!S.boot) return;
  const title = navs.find((n) => n[0] === S.view)?.[2];
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="logo"><span class="orbit-symbol"></span><span class="logo-text">Орбита</span></div><div class="side-label">Рабочее пространство</div>${nav()}<div class="side-bottom"><div class="host-card"><strong><span class="status-dot"></span>${escape(S.overview.system.hostname || 'Ваш компьютер')}</strong><span class="small">Проекты остаются на компьютере.<br>Управление всегда под рукой.</span></div><footer>ЛИЧНОЕ ПРОСТРАНСТВО · WI-FI</footer></div></aside><section class="workspace"><header class="topbar"><div class="breadcrumb"><span>Моё пространство</span>${icon('arrow', 11)}<strong>${escape(title)}</strong></div><div class="connection" id="connection"></div><span class="avatar" aria-label="Личное пространство">Я</span></header><main id="main" class="main ${S.view === 'agents' && S.selected ? 'chat-main' : ''}"></main></section>${nav(true)}</div>`;
  setConnection(S.online);
  renderMain();
}
function heading(title, text, cta = true) {
  return `<div class="page-heading"><div><p class="eyebrow">ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО</p><h1>${title}</h1><p>${text}</p></div>${cta ? button('Новая задача', 'new-agent', 'primary', 'plus', 'data-online') : ''}</div>`;
}
function agentCard(a) {
  return `<button class="card agent-card" data-a="open-session" data-id="${escape(a.id)}"><div class="row">${providerIcon(a.provider)}<div><div class="provider-name">${providerName(a.provider)}</div><div class="provider-meta">${a.external ? escape(a.source === 'vscode' ? 'VS Code · наблюдение' : a.source === 'subagent' ? 'Дочерний агент · наблюдение' : 'Внешняя сессия') : 'Управление из Орбиты'}</div></div>${badge(a.status)}</div><h3>${escape(a.title)}</h3><p class="description">${a.external ? 'История диалога на вашем компьютере' : a.status === 'waiting' ? 'Агенту нужен ваш ответ или разрешение' : a.status === 'running' ? 'Задача выполняется на компьютере' : 'Откройте диалог, чтобы продолжить работу'}</p><div class="card-footer"><span class="folder-meta">${icon('folder', 12)}<span>${escape(leaf(a.cwd))}</span></span><span>${ago(a.updated)}</span></div></button>`;
}
function renderMain() {
  const main = $('#main');
  if (!main) return;
  main.className = `main ${S.view === 'agents' && S.selected ? 'chat-main' : ''}`;
  if (S.view === 'overview') dashboard(main);
  else if (S.view === 'agents') agentsView(main);
  else if (S.view === 'files') filesView(main);
  else if (S.view === 'processes') processesView(main);
  else settingsView(main);
  renderLimits();
  setConnection(S.online);
}
function renderLimits() {
  const existing = $('#quota-panel');
  const compact = S.view === 'agents' && Boolean(S.selected);
  const provider = compact ? selected()?.provider : null;
  if (compact && !['codex', 'claude'].includes(provider)) {
    existing?.remove();
    return;
  }
  const options = { compact, provider };
  const html = limitsHTML(S.overview.limits, options);
  if (existing) {
    existing.outerHTML = html;
    return;
  }
  if (S.view === 'overview') $('#main .stats')?.insertAdjacentHTML('afterend', html);
  else if (compact) $('.chat-heading')?.insertAdjacentHTML('afterend', html);
  else if (S.view === 'agents') $('#main .toolbar')?.insertAdjacentHTML('beforebegin', html);
  else if (S.view === 'settings')
    $('#main .settings-grid')?.insertAdjacentHTML('beforebegin', html);
}
function dashboard(main) {
  const sys = S.overview.system,
    ram = Math.round(((sys.memoryUsed || 0) / (sys.memoryTotal || 1)) * 100);
  const sessions = allSessions()
    .filter((a) => a.provider !== 'task')
    .slice(0, 4);
  const bars = (n) =>
    `<div class="stat-bar">${Array.from({ length: 18 }, (_, i) => `<i class="${i < Math.round(n * 0.18) ? 'filled' : ''}"></i>`).join('')}</div>`;
  main.innerHTML = `${heading('Всё под контролем', 'Ваши проекты и агенты — рядом, где бы вы ни были дома.')}<div class="stats"><div class="stat"><div class="stat-label">${icon('agent', 14)}Активные агенты</div><div class="stat-value">${liveCount()}<span class="stat-sub">из Орбиты</span></div>${bars(liveCount() * 25)}</div><div class="stat"><div class="stat-label">${icon('folder', 14)}Рабочие проекты</div><div class="stat-value">${S.projects.length}<span class="stat-sub">подключено</span></div>${bars(Math.min(S.projects.length * 12, 100))}</div><div class="stat"><div class="stat-label">${icon('cpu', 14)}Загрузка CPU</div><div class="stat-value">${sys.cpu || 0}<span class="stat-sub">%</span></div>${bars(sys.cpu || 0)}</div><div class="stat"><div class="stat-label">${icon('memory', 14)}Память компьютера</div><div class="stat-value">${sys.memoryUsed ? (sys.memoryUsed / 1024 ** 3).toFixed(1) : '—'}<span class="stat-sub">/ ${sys.memoryTotal ? Math.round(sys.memoryTotal / 1024 ** 3) : '—'} ГБ</span></div>${bars(ram)}</div></div><div class="section-heading"><h2>На вашем радаре <span class="count">${sessions.length}</span></h2><button class="text-button" data-a="nav" data-id="agents">Все агенты →</button></div><div class="grid">${sessions.length ? sessions.map(agentCard).join('') : `<div class="empty"><strong>Место для вашей следующей идеи</strong>Создайте сессию и отправьте агенту задачу.</div>`}</div><div class="dashboard-lower"><section><div class="section-heading"><h2>Рабочие папки</h2><button class="text-button" data-a="nav" data-id="files">Открыть все →</button></div><div class="card">${
    S.projects
      .slice(0, 4)
      .map(
        (p) =>
          `<button class="project-line" data-a="project" data-root="${escape(p.root)}" data-path="${escape(p.path)}"><span class="folder-icon">${icon('folder', 17)}</span><span class="grow"><strong>${escape(p.name)}</strong><span class="small">${escape(p.rootName)} · ${p.modified ? ago(p.modified) : 'Рабочая папка'}</span></span>${icon('arrow', 13)}</button>`,
      )
      .join('') || '<p class="small">Подключите папку в разделе «Подключение».</p>'
  }</div></section><section><div class="section-heading"><h2>Всегда под рукой</h2><span class="small">IPHONE + IPAD</span></div><div class="quiet-card"><span class="accent">${icon('leaf', 27)}</span><h2>Компьютер работает.<br>Вы выбираете, откуда.</h2><p>Открывайте проекты, следите за задачами и общайтесь с агентами — с любимого устройства.</p>${button('Подключить устройство', 'nav', '', 'phone', 'data-id="settings"')}</div></section></div><p class="hint-line">${icon('shield', 12)}Управление и файлы передаются внутри вашей Wi-Fi сети.</p>`;
}
function agentsView(main) {
  if (S.selected) return chatView(main);
  const sessions = allSessions().filter((a) => a.provider !== 'task');
  const filtered = sessions.filter(
    (a) =>
      (S.filter === 'all' ||
        (S.filter === 'managed' && !a.external) ||
        (S.filter === 'external' && a.external)) &&
      `${a.title} ${a.cwd} ${a.provider}`.toLowerCase().includes(S.search.toLowerCase()),
  );
  main.innerHTML = `${heading('Ваши агенты', 'Общение, ход работы и решения — в одном месте.')}<div class="toolbar"><label class="search">${icon('search', 15)}<input id="agent-search" type="search" placeholder="Найти диалог или проект" aria-label="Поиск диалогов" value="${escape(S.search)}"></label><div class="segmented">${[
    ['all', 'Все'],
    ['managed', 'Из Орбиты'],
    ['external', 'Из VS Code'],
  ]
    .map(
      ([id, title]) =>
        `<button data-a="filter" data-id="${id}" class="${S.filter === id ? 'active' : ''}">${title}</button>`,
    )
    .join(
      '',
    )}</div></div><div id="agent-grid" class="grid">${filtered.map(agentCard).join('') || '<div class="empty"><strong>Здесь пока тихо</strong>Создайте задачу или измените фильтр.</div>'}</div>${S.overview.discovered.error ? `<p class="notice">${escape(S.overview.discovered.error)}</p>` : ''}<p class="hint-line">${icon('shield', 12)}Полное управление доступно сессиям, которые вы запускаете в Орбите.</p>`;
}
function renderTranscript(events) {
  const result = [],
    itemMessages = new Map();
  const itemEntry = (id, item) => {
    if (!id) return;
    if (itemMessages.has(id)) {
      Object.assign(itemMessages.get(id), item);
      return;
    }
    const entry = { ...item, id };
    itemMessages.set(id, entry);
    result.push(entry);
  };
  for (const e of events) {
    const p = e.payload;
    if (['user', 'assistant', 'system', 'error'].includes(e.kind))
      result.push({ type: e.kind, text: p.text });
    if (e.kind === 'delta') {
      const entry = itemMessages.get(p.itemId);
      itemEntry(p.itemId, { type: 'assistant', text: (entry?.text || '') + p.text });
    }
    if (e.kind === 'item') {
      const i = p.item;
      if (i.type === 'agentMessage' && i.text) itemEntry(i.id, { type: 'assistant', text: i.text });
      else if (i.type === 'commandExecution')
        itemEntry(i.id, {
          type: 'tool',
          title: i.command || 'Команда',
          text: i.aggregatedOutput || '',
          status: i.status,
        });
      else if (i.type === 'fileChange')
        itemEntry(i.id, {
          type: 'tool',
          title: 'Изменения файлов',
          text: (i.changes || []).map((c) => `${c.path}\n${c.diff || ''}`).join('\n\n'),
          status: i.status,
        });
      else if (['mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(i.type))
        itemEntry(i.id, {
          type: 'tool',
          title: i.tool || i.type,
          text: JSON.stringify(i.result || i.arguments || i.action || {}, null, 2),
        });
    }
    if (e.kind === 'output') {
      if (p.itemId) {
        const entry = itemMessages.get(p.itemId);
        itemEntry(p.itemId, {
          type: 'tool',
          title: entry?.title || 'Команда',
          text: (entry?.text || '') + p.text,
        });
      } else {
        const last = result.at(-1);
        if (last?.type === 'output') last.text += p.text;
        else result.push({ type: 'output', text: p.text });
      }
    }
    if (e.kind === 'tool')
      result.push({ type: 'tool', title: p.name, text: JSON.stringify(p.input, null, 2) });
    if (e.kind === 'plan')
      itemEntry('plan', {
        type: 'tool',
        title: 'План работы',
        text: (p.plan || [])
          .map(
            (x) =>
              `${x.status === 'completed' ? '✓' : x.status === 'inProgress' ? '→' : '○'} ${x.step}`,
          )
          .join('\n'),
      });
    if (e.kind === 'completed')
      result.push({
        type: 'system',
        text:
          p.status === 'interrupted'
            ? 'Задача остановлена'
            : p.status === 'failed'
              ? 'Задача завершена с ошибкой'
              : `Задача завершена${p.code !== undefined ? ` · код ${p.code}` : ''}${p.cost ? ` · $${p.cost.toFixed(3)}` : ''}`,
      });
  }
  return result
    .map((m) => {
      if (m.type === 'tool')
        return `<details class="tool"><summary>${escape(m.title)}${m.status ? ` · ${escape(m.status)}` : ''}</summary><pre class="tool-output">${escape(m.text || 'Выполняется…')}</pre></details>`;
      if (m.type === 'output') return `<pre class="tool-output">${escape(m.text)}</pre>`;
      return `<div class="message ${m.type}">${['user', 'assistant'].includes(m.type) ? `<div class="message-label">${m.type === 'user' ? 'ВЫ' : providerName(selected()?.provider)}</div>` : ''}<div class="message-text">${escape(m.text)}</div></div>`;
    })
    .join('');
}
function externalEvents(items) {
  return items.flatMap(({ item: i }) => {
    if (i.type === 'userMessage')
      return [
        {
          kind: 'user',
          payload: { text: (i.content || []).map((c) => c.text || `[${c.type}]`).join('\n') },
        },
      ];
    return [{ kind: 'item', payload: { phase: 'completed', item: i } }];
  });
}
function chatView(main) {
  const a = selected();
  if (!a) {
    S.selected = null;
    return agentsView(main);
  }
  const sessions = allSessions().slice(0, 45);
  main.innerHTML = `<div class="chat-layout has-selected"><aside class="card chat-sessions"><div class="row between">${button('Новая задача', 'new-agent', 'soft', 'plus')}<button class="icon-button" data-a="chat-back" aria-label="Все сессии">${icon('grid', 16)}</button></div>${sessions.map((s) => `<button class="chat-session ${s.id === a.id ? 'active' : ''}" data-a="open-session" data-id="${escape(s.id)}"><strong>${escape(s.title)}</strong><div class="row between"><span class="small">${providerName(s.provider)} · ${escape(leaf(s.cwd))}</span></div></button>`).join('')}</aside><section class="chat-panel"><header class="chat-heading"><button class="mobile-back" data-a="chat-back" aria-label="Назад">${icon('back', 18)}</button>${providerIcon(a.provider)}<div class="grow"><h3>${escape(a.title)}</h3><div class="small">${providerName(a.provider)} · ${escape(leaf(a.cwd))}</div></div><span id="chat-status">${badge(a.status)}</span>${a.external ? button('Продолжить в Орбите', 'fork', 'soft', null, 'data-online') : a.canStop ? button('Стоп', 'stop', 'danger', 'stop', 'data-online') : ''}</header>${a.external ? '<div class="external-info">Диалог открыт в другом клиенте. История обновляется каждые 10 секунд. Для полного управления создайте ветку в Орбите.</div>' : ''}<div class="chat-scroll" id="chat-scroll">${a.external && S.cursor ? button('Загрузить предыдущие сообщения', 'older-external', 'soft') : !a.external && S.events.length >= 300 ? button('Предыдущие события', 'older-events', 'soft') : ''}<div id="transcript">${renderTranscript(a.external ? externalEvents(S.externalItems) : S.events) || '<div class="empty"><strong>Диалог готов</strong>Напишите, с чем вам помочь.</div>'}</div></div><div id="prompt-area">${promptHTML(a)}</div>${a.provider === 'task' ? '' : `<form id="composer" class="chat-compose"><div class="compose-row"><textarea id="message" rows="1" placeholder="${a.external ? 'Сообщение в очередь Codex…' : 'Напишите агенту…'}" aria-label="Сообщение агенту" required maxlength="32000"></textarea><button class="send" aria-label="Отправить" data-online>${icon('send', 17)}</button></div><div class="compose-hint"><span>${a.external ? 'Очередь обработает клиент Codex, если он её поддерживает' : a.provider === 'codex' && a.canStop ? 'Сообщение уточнит выполняемую задачу' : 'Задача выполняется на вашем компьютере'}</span><span>⌘ / Ctrl + Enter</span></div></form>`}</section></div>`;
  const scroll = $('#chat-scroll');
  scrollAtBottom = true;
  scroll.scrollTop = scroll.scrollHeight;
  scroll.addEventListener('scroll', () => {
    scrollAtBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;
  });
}
function promptHTML(a) {
  return (a.pending || [])
    .map((p) => {
      const d = p.details,
        isQuestion = p.method === 'item/tool/requestUserInput' || p.method === 'claude/question';
      return `<form class="prompt-card" data-prompt="${escape(p.id)}"><h3>${isQuestion ? 'Агенту нужен ваш ответ' : 'Разрешить действие?'}</h3>${isQuestion ? (d.questions || []).map((q) => `<label class="field">${escape(q.question)}<input name="q-${escape(q.id || q.question)}" required maxlength="4000" autocomplete="off"><span class="question-options">${(q.options || []).map((o) => `<button type="button" data-a="question-option" data-value="${escape(o.label)}">${escape(o.label)}</button>`).join('')}</span></label>`).join('') : `<pre class="tool-output">${escape(d.command || d.reason || d.tool || p.method)}${d.input ? '\n' + JSON.stringify(d.input, null, 2) : ''}${d.permissions ? '\n' + JSON.stringify(d.permissions, null, 2) : ''}${d.changes ? '\n' + JSON.stringify(d.changes, null, 2) : ''}</pre>${d.requestedSchema ? `<label class="field">Ответ в JSON<textarea name="content" placeholder="{}"></textarea></label>` : ''}`}<div class="row wrap gap"><button type="submit" class="button primary" data-online>${isQuestion ? 'Отправить ответ' : 'Разрешить'}</button>${!isQuestion ? button('Отклонить', 'decline', 'secondary', null, `data-id="${escape(p.id)}" data-online`) : ''}</div></form>`;
    })
    .join('');
}
async function loadHistory(older = false) {
  const id = S.selected,
    a = selected();
  if (!a || historyBusy) return;
  historyBusy = true;
  try {
    if (a.external) {
      const r = await api(
        `/api/external/${id}/history${older && S.cursor ? '?cursor=' + encodeURIComponent(S.cursor) : ''}`,
      );
      if (S.selected !== id) return;
      const combined = older ? [...r.items, ...S.externalItems] : [...S.externalItems, ...r.items];
      S.externalItems = [...new Map(combined.map((x) => [x.item.id, x])).values()];
      if (older || S.externalItems.length <= r.items.length) S.cursor = r.cursor;
    } else {
      const r = await api(
        `/api/agents/${id}/events${older && S.events.length ? '?before=' + S.events[0].seq : ''}`,
      );
      if (S.selected !== id) return;
      S.events = [...new Map([...S.events, ...r.events].map((e) => [e.seq, e])).values()].sort(
        (a, b) => a.seq - b.seq,
      );
    }
    if (older) renderMain();
    else updateChat();
  } catch (e) {
    if (S.selected === id) toast(e.message);
  } finally {
    historyBusy = false;
  }
}
function updateChat() {
  if (S.view !== 'agents' || !S.selected) return;
  const a = selected(),
    transcript = $('#transcript');
  if (!a || !transcript) return;
  const openTools = new Set(
    [...transcript.querySelectorAll('details[open]')].map(
      (d) => d.querySelector('summary').textContent,
    ),
  );
  transcript.innerHTML = renderTranscript(a.external ? externalEvents(S.externalItems) : S.events);
  transcript.querySelectorAll('details').forEach((d) => {
    if (openTools.has(d.querySelector('summary').textContent)) d.open = true;
  });
  if (scrollAtBottom) $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
  $('#chat-status').innerHTML = badge(a.status);
  const heading = $('.chat-heading');
  const stop = heading.querySelector('[data-a="stop"]');
  if (a.canStop && !stop)
    heading.insertAdjacentHTML(
      'beforeend',
      button('Стоп', 'stop', 'danger', 'stop', 'data-online'),
    );
  else if (!a.canStop && stop) stop.remove();
  const area = $('#prompt-area'),
    promptIds = (a.pending || []).map((p) => p.id).join(',');
  if (area.dataset.ids !== promptIds) {
    area.innerHTML = promptHTML(a);
    area.dataset.ids = promptIds;
  }
  setConnection(S.online);
}
function filesView(main) {
  main.innerHTML = `${heading('Рабочие файлы', 'Директории вашего компьютера. Без лишних копий.', false)}<div class="file-layout"><aside class="card file-sidebar"><h3>Подключённые папки</h3>${S.boot.roots.map((r) => `<button class="root-button ${S.fileRoot === r.id ? 'active' : ''}" data-a="root" data-id="${escape(r.id)}">${escape(r.name)}</button>`).join('')}</aside><section class="card"><div class="files-header"><div class="row"><button class="icon-button" data-a="file-up" aria-label="На уровень выше" ${!S.filePath ? 'disabled' : ''}>${icon('back', 15)}</button><div class="grow"><h3>${escape(S.filePath ? leaf(S.filePath) : S.boot.roots.find((r) => r.id === S.fileRoot)?.name || '')}</h3><div class="path">/ ${escape(S.filePath.replaceAll('/', ' / '))}</div></div><button class="icon-button" data-a="files-refresh" aria-label="Обновить">${icon('refresh', 16)}</button></div></div><div id="file-list">${S.listing ? S.listing.items.map((f) => `<div class="row file-row"><button class="row grow" data-a="file-open" data-path="${escape(f.path)}" data-directory="${f.directory}" ${f.link ? 'disabled title="Ссылка: откройте исходную папку"' : ''}>${icon(f.directory ? 'folder' : 'file', 20)}<span class="grow"><strong>${escape(f.name)}</strong><span class="small">${f.link ? 'Ссылка' : f.directory ? 'Папка' : date(f.modified)}</span></span></button><span class="file-size">${f.directory ? '' : size(f.size)}</span>${!f.directory && !f.link ? `<a class="icon-button" href="/api/download?root=${encodeURIComponent(S.fileRoot)}&path=${encodeURIComponent(f.path)}" aria-label="Скачать ${escape(f.name)}">↓</a>` : ''}</div>`).join('') || '<div class="empty">В этой папке пока нет доступных файлов.</div>' : '<div class="skeleton"></div><div class="skeleton"></div>'}</div>${S.listing?.truncated ? '<p class="small">Показаны первые 600 элементов.</p>' : ''}<div class="file-actions">${button('Агент в этой папке', 'agent-here', 'soft', 'plus', 'data-online')}${button('Скопировать путь', 'copy-path', 'secondary', 'copy')}</div></section></div><p class="hint-line">${icon('shield', 12)}Системные каталоги, ключи и скрытые файлы доступа исключены из просмотра.</p>`;
}
async function loadFiles(root = S.fileRoot, p = S.filePath) {
  S.fileRoot = root || S.boot.roots[0]?.id;
  S.filePath = p;
  S.listing = null;
  if (S.view === 'files') renderMain();
  try {
    const r = await api(
      `/api/files?root=${encodeURIComponent(S.fileRoot)}&path=${encodeURIComponent(p)}`,
    );
    if ((S.fileRoot === root && S.filePath === p) || !root) S.listing = r;
  } catch (e) {
    toast(e.message);
    S.listing = { items: [], fullPath: '' };
  }
  if (S.view === 'files') renderMain();
}
function processesView(main) {
  const sys = S.overview.system;
  main.innerHTML = `${heading('Пульс компьютера', 'Важные процессы, команды и их журналы.', false)}<div class="section-heading"><h2>Запустить команду</h2><span class="small">${escape(sys.hostname || '')} · POWERSHELL</span></div><form id="task-form" class="task-form"><select class="input" name="cwd" aria-label="Рабочая папка">${S.projects.map((p) => `<option value="${escape(p.fullPath)}">${escape(p.name)}</option>`).join('')}</select><input class="input" name="command" placeholder="Например: npm run dev" aria-label="Команда PowerShell" required maxlength="4000"><button class="button primary" data-online>${icon('terminal', 16)}Запустить</button></form><div class="grid">${S.overview.tasks
    .slice(0, 8)
    .map(
      (a) =>
        `<div class="card task-card"><div class="row">${providerIcon('task')}<h3 class="grow">${escape(a.title)}</h3>${badge(a.status)}</div><div class="card-footer"><span class="path">${escape(leaf(a.cwd))}</span><div class="row gap">${button('Журнал', 'open-session', 'soft', null, `data-id="${escape(a.id)}"`)}${a.canStop ? button('Стоп', 'stop-task', 'danger', 'stop', `data-id="${escape(a.id)}" data-online`) : ''}</div></div></div>`,
    )
    .join(
      '',
    )}</div><div class="section-heading"><h2>Наблюдаемые процессы <span class="count">${sys.processes?.length || 0}</span></h2><span class="updated-label">${sys.updated ? ago(sys.updated) : 'Обновляем…'}</span></div><div class="card table-wrap"><table><thead><tr><th>Процесс</th><th>PID</th><th>Память</th><th>CPU, накоплено</th></tr></thead><tbody>${(
    sys.processes || []
  )
    .sort((a, b) => b.memory - a.memory)
    .map(
      (p) =>
        `<tr><td>${escape(p.name)}${p.owned ? ' <span class="small">· Орбита</span>' : ''}</td><td class="muted">${p.pid}</td><td>${size(p.memory)}</td><td class="muted">${Math.round(p.cpuSeconds)} с</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table></div>${sys.error ? `<p class="notice">${escape(sys.error)}</p>` : ''}<p class="hint-line">${icon('clock', 12)}Список процессов обновляется каждые 10 секунд. Остановка доступна командам, запущенным из Орбиты.</p>`;
}
function settingsView(main) {
  const b = S.boot;
  main.innerHTML = `${heading('Ближе к вашим устройствам', 'Одна настройка — и ваше рабочее пространство всегда рядом.', false)}<div class="settings-grid"><section class="card"><h2>iPhone и iPad</h2>${b.pairing ? `<div class="row pairing"><img class="qr" src="${b.qr}" alt="QR-код подключения к Орбите"><div class="grow"><p class="small">Сканируйте камерой телефона</p><div class="pair-code"><div class="small">ОДНОРАЗОВЫЙ КОД</div><div class="pin">${b.pairing.pin}</div><div class="small">До ${new Date(b.pairing.expires).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div></div>${button('Обновить код', 'rotate-pin', 'soft', 'refresh')}</div></div>` : `<div class="row">${icon('shield', 22)}<p class="small">Это устройство уже подключено. Для нового устройства откройте Орбиту на компьютере.</p></div>`}<ol><li>Подключите устройство к той же Wi-Fi сети.</li><li>Откройте адрес подключения, установите локальный сертификат и включите доверие к нему.</li><li>Откройте защищённый адрес и введите код с компьютера.</li><li>В Safari: «Поделиться → На экран Домой».</li></ol><div class="path">${escape(b.urls.setup)}</div>${button('Скопировать адрес', 'copy-url', 'soft', 'copy')}<p class="small">Для полного режима приложения нужен доверенный HTTPS-сертификат. В фоне iOS может приостанавливать страницу; при открытии данные синхронизируются.</p>${b.fingerprint ? `<details><summary class="small">Отпечаток сертификата SHA-256</summary><code class="fingerprint">${b.fingerprint}</code></details>` : ''}</section><section class="card"><div class="row between"><h2>Доступные агенты</h2><button class="icon-button" data-a="providers-refresh" aria-label="Проверить подключение агентов">${icon('refresh', 15)}</button></div>${['codex', 'claude'].map((p) => `<div class="provider-status">${providerIcon(p)}<div class="grow"><strong>${providerName(p)}</strong><div class="small">${b.providers[p].authenticated ? 'Аккаунт подключён' : b.providers[p].available ? 'Требуется вход на компьютере' : 'Не удалось подключиться'}</div></div>${badge(b.providers[p].authenticated ? 'idle' : 'waiting')}</div>${b.providers[p].error ? `<p class="small">${escape(b.providers[p].error)}</p>` : ''}`).join('')}<p class="notice">Диалоги, запущенные из Орбиты, поддерживают сообщения, остановку и ответы на запросы. Существующие диалоги VS Code доступны для просмотра и продолжения в отдельной ветке.</p>${!b.providers.claude.authenticated ? '<p class="small">Для Claude откройте файл «Войти в Claude.cmd» на компьютере и войдите в аккаунт. После этого обновите статус.</p>' : ''}<p class="small">ИИ-агенты обращаются к своим провайдерам через интернет. Локальным остаётся доступ телефона к компьютеру.</p></section><section class="card"><h2>Подключённые устройства</h2>${S.devices.length ? S.devices.map((d) => `<div class="device">${icon('phone', 20)}<div class="grow"><strong>${escape(d.name)}</strong><div class="small">${ago(d.seen)}${d.id === S.session.device.id ? ' · это устройство' : ''}</div></div><button class="text-button" data-a="revoke-device" data-id="${escape(d.id)}">Отключить</button></div>`).join('') : '<p class="small">Телефон и планшет появятся здесь после подключения.</p>'}<p class="small">Разрешение действует 30 дней. Отключение сразу закрывает доступ устройства.</p>${!S.session.local ? button('Выйти на этом устройстве', 'logout', 'soft') : ''}</section><section class="card"><h2>Рабочее пространство</h2>${b.roots.map((r) => `<p><strong class="small">${escape(r.name)}</strong><br><span class="path">${escape(r.path)}</span></p>`).join('')}${S.session.local ? button('Подключить папку', 'add-root', 'soft', 'plus') : '<p class="small">Новые корневые папки подключаются с компьютера.</p>'}<p class="notice">Компьютер должен быть включён и подключён к сети. После сна или смены Wi-Fi соединение восстановится при доступности компьютера.</p></section></div>`;
}
function modal(title, description, content, cls = '') {
  dialog.className = cls;
  dialog.innerHTML = `<button class="icon-button dialog-close" data-a="close-modal" aria-label="Закрыть">${icon('close', 17)}</button><h2>${escape(title)}</h2><p class="dialog-description">${escape(description)}</p>${content}`;
  if (!dialog.open) dialog.showModal();
}
async function newAgent({ cwd, forkId, title } = {}) {
  const options = S.projects.length
    ? S.projects
    : S.boot.roots.map((r) => ({ name: r.name, fullPath: r.path }));
  const fields = `<form id="new-agent-form" ${forkId ? `data-fork="${escape(forkId)}"` : ''}><label class="field">Название задачи<input name="title" value="${escape(title || '')}" placeholder="Например: Разобраться с проектом" maxlength="160" required></label><label class="field">Агент<select name="provider" ${forkId ? 'disabled' : ''}><option value="codex">Codex</option><option value="claude" ${!S.boot.providers.claude.authenticated ? 'disabled' : ''}>Claude Code${!S.boot.providers.claude.authenticated ? ' · требуется вход' : ''}</option></select></label><label class="field">Рабочая папка<select name="cwd">${cwd && !options.some((p) => p.fullPath === cwd) ? `<option selected value="${escape(cwd)}">${escape(leaf(cwd))}</option>` : ''}${options.map((p) => `<option value="${escape(p.fullPath)}" ${p.fullPath === cwd ? 'selected' : ''}>${escape(p.name)}</option>`).join('')}</select></label><p class="form-error" role="alert"></p><div class="dialog-actions">${button('Отмена', 'close-modal', 'secondary')}<button class="button primary">${forkId ? 'Создать ветку' : 'Создать сессию'}</button></div></form>`;
  modal(
    forkId ? 'Продолжить в Орбите' : 'Новая задача',
    forkId
      ? 'История сохранится в новой ветке. Исходный диалог останется в своём клиенте.'
      : 'Выберите проект. Агент начнёт работу после вашего первого сообщения.',
    fields,
  );
}
async function openFile(p) {
  let r;
  try {
    r = await api(`/api/file?root=${encodeURIComponent(S.fileRoot)}&path=${encodeURIComponent(p)}`);
  } catch (e) {
    toast(e.message);
    return;
  }
  fileVersion = r.version;
  modal(
    leaf(p),
    p,
    `<form id="edit-file-form" data-path="${escape(p)}"><label class="field"><textarea name="content" spellcheck="false" aria-label="Содержимое файла">${escape(r.content)}</textarea></label><p class="small">При сохранении создаётся резервная копия. Если файл изменился на ПК, сохранение будет отменено.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><a class="button secondary" href="/api/download?root=${encodeURIComponent(S.fileRoot)}&path=${encodeURIComponent(p)}">Скачать</a><button class="button primary">Сохранить</button></div></form>`,
    'file-editor',
  );
}
function pairPage() {
  app.innerHTML = `<main class="pair-page"><div class="brand-mark">◉</div><p class="eyebrow">ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО</p><h1>Добро пожаловать<br>на вашу Орбиту.</h1><p>Проекты, файлы и агенты вашего компьютера — на этом устройстве.</p><form id="pair-form" class="card"><label class="field">Как назвать это устройство<input name="name" value="${/iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? 'Мой iPad' : /iPhone/.test(navigator.userAgent) ? 'Мой iPhone' : 'Моё устройство'}" required maxlength="80" autocomplete="off"></label><label class="field">Одноразовый код с компьютера<input class="pin-input" name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autocomplete="one-time-code"></label><p class="form-error" role="alert"></p><button class="button primary full">Подключить устройство ${icon('arrow', 15)}</button><p class="small">На компьютере: Орбита → Подключение.</p></form><p class="hint-line">${icon('shield', 14)}Подключение только внутри вашей Wi-Fi сети.</p></main>`;
}
async function projects() {
  const result = await Promise.allSettled(
    S.boot.roots.map(async (r) => {
      const f = await api(`/api/files?root=${encodeURIComponent(r.id)}`);
      const children = f.items
        .filter((x) => x.directory && !x.link)
        .map((x) => ({ ...x, root: r.id, rootName: r.name, fullPath: `${f.fullPath}/${x.path}` }));
      return children.length
        ? children
        : [{ name: r.name, root: r.id, rootName: r.name, path: '', fullPath: f.fullPath }];
    }),
  );
  S.projects = result.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
async function refresh(render = true) {
  if (!S.boot || refreshBusy) return;
  refreshBusy = true;
  try {
    const before = JSON.stringify(S.overview.agents.map((a) => [a.id, a.status, a.canStop]));
    S.overview = await api('/api/overview');
    if (S.view === 'agents' && S.selected) updateChat();
    else if (
      render &&
      !dialog.open &&
      !['files', 'settings'].includes(S.view) &&
      !$('#agent-search')?.matches(':focus') &&
      !$('#task-form input')?.matches(':focus')
    )
      renderMain();
    renderLimits();
    if (before !== JSON.stringify(S.overview.agents.map((a) => [a.id, a.status, a.canStop])))
      document.querySelectorAll('.nav-count').forEach((x) => (x.textContent = liveCount()));
  } catch {
  } finally {
    refreshBusy = false;
  }
}
async function navigate(view) {
  if (view !== 'agents') S.selected = null;
  S.view = view;
  history.replaceState(null, '', view === 'overview' ? '/' : `/#${view}`);
  shell();
  if (view === 'files') await loadFiles();
  if (view === 'settings') {
    const result = await Promise.all([api('/api/bootstrap'), api('/api/devices')]);
    S.boot = result[0];
    S.devices = result[1].devices;
    renderMain();
  }
}
async function openSession(id) {
  S.selected = id;
  S.view = 'agents';
  S.events = [];
  S.externalItems = [];
  S.cursor = null;
  historyBusy = false;
  shell();
  await loadHistory();
}
function connectEvents() {
  S.eventSource?.close();
  const stream = new EventSource('/api/events');
  S.eventSource = stream;
  stream.onopen = () => {
    setConnection(true);
    refresh();
    if (S.selected) loadHistory();
  };
  stream.onerror = () => setConnection(false);
  stream.onmessage = (event) => {
    const e = JSON.parse(event.data);
    if (e.kind === 'limits.updated') {
      S.overview.limits = e.payload;
      renderLimits();
      return;
    }
    if (!e.agentId) return;
    const a = allSessions().find((a) => a.id === e.agentId);
    if (e.kind === 'status' && a) {
      a.status = e.payload.status;
      a.canStop = ['running', 'waiting', 'starting', 'stopping'].includes(a.status);
    }
    if (e.kind === 'prompt' && a) a.pending = [...(a.pending || []), e.payload];
    if (e.kind === 'prompt.resolved' && a)
      a.pending = (a.pending || []).filter((p) => p.id !== e.payload.id);
    if (S.selected === e.agentId && !S.events.some((x) => x.seq === e.seq)) {
      S.events.push(e);
      if (S.events.length > 4000) S.events.splice(0, S.events.length - 3000);
      clearTimeout(renderTimer);
      renderTimer = setTimeout(updateChat, 60);
    }
    if (e.kind === 'completed' || e.kind === 'prompt') {
      if (e.kind === 'completed' && S.selected !== e.agentId)
        toast(
          `${a?.title || 'Задача'}: ${e.payload.status === 'failed' ? 'ошибка' : e.payload.status === 'interrupted' ? 'остановлена' : 'завершена'}`,
        );
      refresh();
    }
  };
}
async function start() {
  try {
    S.session = await api('/api/session');
    if (!S.session.authenticated) {
      pairPage();
      return;
    }
    S.boot = await api('/api/bootstrap');
    S.fileRoot = S.boot.roots[0]?.id;
    await Promise.all([refresh(false), projects()]);
    if (navs.some((n) => n[0] === location.hash.slice(1))) S.view = location.hash.slice(1);
    if (S.view === 'settings') S.devices = (await api('/api/devices')).devices;
    shell();
    connectEvents();
    if (S.view === 'files') await loadFiles();
    if ('serviceWorker' in navigator && location.protocol === 'https:')
      navigator.serviceWorker.register('/sw.js').catch(() => {});
  } catch (e) {
    app.innerHTML = `<main class="pair-page"><div class="brand-mark">◉</div><h1>Нужно восстановить связь</h1><p>${escape(e.message)}</p>${button('Попробовать снова', 'retry', 'primary', 'refresh')}</main>`;
  }
}
document.addEventListener('click', async (event) => {
  const b = event.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const { a, id, path: p, root } = b.dataset;
  try {
    if (a === 'nav') await navigate(id);
    else if (a === 'new-agent') newAgent();
    else if (a === 'close-modal') dialog.close();
    else if (a === 'retry') start();
    else if (a === 'open-session') await openSession(id);
    else if (a === 'chat-back') {
      S.selected = null;
      shell();
    } else if (a === 'filter') {
      S.filter = id;
      renderMain();
    } else if (a === 'root') await loadFiles(id, '');
    else if (a === 'project') {
      S.view = 'files';
      S.selected = null;
      S.fileRoot = root;
      S.filePath = p;
      shell();
      await loadFiles(root, p);
    } else if (a === 'file-open') {
      b.dataset.directory === 'true' ? await loadFiles(S.fileRoot, p) : await openFile(p);
    } else if (a === 'file-up')
      await loadFiles(S.fileRoot, S.filePath.split('/').slice(0, -1).join('/'));
    else if (a === 'files-refresh') await loadFiles();
    else if (a === 'agent-here') newAgent({ cwd: S.listing?.fullPath });
    else if (a === 'copy-path') {
      await navigator.clipboard.writeText(S.listing?.fullPath || '');
      toast('Путь скопирован');
    } else if (a === 'copy-url') {
      await navigator.clipboard.writeText(S.boot.urls.setup);
      toast('Адрес скопирован');
    } else if (a === 'fork') {
      const s = selected();
      newAgent({ cwd: s.cwd, forkId: s.id, title: s.title.slice(0, 140) });
    } else if (a === 'stop' || a === 'stop-task') {
      b.disabled = true;
      await api(`/api/agents/${id || S.selected}/stop`, {});
      toast('Запрошена остановка');
      await refresh();
    } else if (a === 'older-external' || a === 'older-events') {
      b.disabled = true;
      await loadHistory(true);
    } else if (a === 'decline') {
      await api(`/api/prompts/${id}`, { decision: 'decline' });
      await refresh();
    } else if (a === 'question-option') {
      b.closest('label').querySelector('input').value = b.dataset.value;
    } else if (a === 'rotate-pin') {
      S.boot.pairing = await api('/api/pairing/rotate', {});
      renderMain();
    } else if (a === 'providers-refresh') {
      b.disabled = true;
      S.boot.providers = await api('/api/providers/refresh', {});
      renderMain();
      toast('Статус агентов обновлён');
    } else if (a === 'limits-refresh') {
      b.disabled = true;
      S.overview.limits = await api('/api/limits/refresh', {});
      renderLimits();
      toast(
        S.overview.limits.codex.state === 'ready'
          ? 'Лимиты Codex обновлены'
          : 'Показаны последние доступные данные',
      );
    } else if (a === 'revoke-device') {
      await api('/api/device/revoke', { id });
      if (id === S.session.device.id) location.reload();
      S.devices = (await api('/api/devices')).devices;
      renderMain();
      toast('Доступ устройства закрыт');
    } else if (a === 'logout') {
      await api('/api/logout', {});
      S.eventSource?.close();
      S.boot = null;
      pairPage();
    } else if (a === 'add-root')
      modal(
        'Подключить папку',
        'Разрешите доступ к ещё одной рабочей директории на этом компьютере.',
        '<form id="root-form"><label class="field">Полный путь<input name="path" required placeholder="C:\\Проекты"></label><label class="field">Название<input name="name" maxlength="80"></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button primary">Подключить</button></div></form>',
      );
  } catch (e) {
    toast(e.message, 8000);
    b.disabled = false;
  }
});
document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type="submit"],button:not([type])');
  const data = Object.fromEntries(new FormData(form));
  if (submit) submit.disabled = true;
  const error = form.querySelector('.form-error');
  if (error) error.textContent = '';
  try {
    if (form.id === 'pair-form') {
      await api('/api/pair', data);
      await start();
    } else if (form.id === 'new-agent-form') {
      const r = await api('/api/agents', {
        ...data,
        provider: data.provider || 'codex',
        ...(form.dataset.fork ? { forkId: form.dataset.fork } : {}),
      });
      dialog.close();
      await refresh(false);
      await openSession(r.id);
    } else if (form.id === 'composer') {
      const input = $('#message'),
        text = input.value.trim();
      if (!text) return;
      const a = selected();
      const r = await api(
        a.external ? `/api/external/${a.id}/queue` : `/api/agents/${a.id}/message`,
        { text },
      );
      input.value = '';
      if (a.external) toast(r.note, 10000);
      await refresh();
      await loadHistory();
    } else if (form.id === 'task-form') {
      const r = await api('/api/tasks', data);
      await refresh(false);
      await openSession(r.id);
    } else if (form.id === 'edit-file-form') {
      const r = await api('/api/file', {
        root: S.fileRoot,
        path: form.dataset.path,
        content: data.content,
        version: fileVersion,
      });
      fileVersion = r.version;
      toast('Файл сохранён. Резервная копия создана.');
      dialog.close();
      await loadFiles();
    } else if (form.id === 'root-form') {
      const r = await api('/api/roots', data);
      S.boot.roots = r.roots;
      dialog.close();
      await projects();
      renderMain();
      toast('Папка подключена');
    } else if (form.dataset.prompt) {
      const answers = Object.fromEntries(
        Object.entries(data)
          .filter(([k]) => k.startsWith('q-'))
          .map(([k, v]) => [k.slice(2), v]),
      );
      await api(`/api/prompts/${form.dataset.prompt}`, {
        decision: 'accept',
        answers,
        ...(data.content ? { content: JSON.parse(data.content) } : {}),
      });
      await refresh();
    }
  } catch (e) {
    if (error) error.textContent = e.message;
    else toast(e.message, 8000);
  } finally {
    if (submit) submit.disabled = false;
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'agent-search') {
    const pos = event.target.selectionStart;
    S.search = event.target.value;
    renderMain();
    const input = $('#agent-search');
    input.focus();
    if (input.type !== 'search') input.setSelectionRange(pos, pos);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'message' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.boot) {
    refresh();
    if (S.selected) loadHistory();
  }
});
window.addEventListener('online', () => {
  if (S.boot) {
    refresh();
    if (S.selected) loadHistory();
  } else start();
});
window.addEventListener('offline', () => setConnection(false));
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  }
});
setInterval(() => {
  if (S.boot && !document.hidden) {
    refresh();
    if (selected()?.external) loadHistory();
  }
}, 10000);
start();

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const time = (value) =>
  new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' МСК';
const names = { codex: 'Codex', claude: 'Claude Code' };
const stateLabels = {
  loading: 'Получаем данные',
  unavailable: 'Нет данных',
  awaiting: 'Ждём данные',
  unauthenticated: 'Нужен вход',
  stale: 'Последние данные',
};
const known = (w) =>
  typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) && !w.expired;
const chevron =
  '<svg class="quota-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m8 5 7 7-7 7"/></svg>';
const refreshButton =
  '<button class="quota-refresh" data-a="limits-refresh" data-online aria-label="Обновить лимиты Codex">↻ <span>Обновить</span></button>';

function resetText(w) {
  return (
    (w.expired
      ? 'Срок окна прошёл; новый остаток пока не получен'
      : w.resetsAt
        ? 'Сброс ' + time(w.resetsAt)
        : 'Время сброса недоступно') +
    (w.status === 'rejected' ? ' · лимит достигнут по данным провайдера' : '')
  );
}
function windowHTML(w, p, provider, summary) {
  const available = known(w);
  const tone = !available
    ? 'unknown'
    : w.remainingPercent <= 10
      ? 'low'
      : w.remainingPercent <= 25
        ? 'warning'
        : 'normal';
  const label = w.expired
    ? 'Ждём обновление окна'
    : available
      ? w.stale || p.stale
        ? 'последний остаток'
        : 'осталось'
      : 'процент недоступен';
  return `<div class="quota-window ${tone}">
    <div class="quota-window-heading"><span>${escape(w.label)}</span><strong class="quota-value">${available ? escape(w.remainingPercent) + '%' : '—'}</strong><span class="quota-remaining-label">${label}</span></div>
    ${available ? `<meter min="0" max="100" value="${w.remainingPercent}" aria-label="${escape(names[provider])}: остаток ${escape(w.label)}">${w.remainingPercent}%</meter>` : ''}
    ${summary ? '' : `<div class="quota-reset">${escape(resetText(w))}</div>`}
  </div>`;
}
function card(provider, data, summary) {
  const p = data || { state: 'loading', buckets: [] };
  const hasWindows = p.buckets.some((b) => b.windows.length);
  const state = p.stale
    ? 'Последние данные'
    : stateLabels[p.state] ||
      (p.status === 'rejected' || p.ordinaryUsageAllowed === false
        ? 'Есть ограничение'
        : 'Осталось');
  const windows = p.buckets
    .map(
      (b) =>
        `${p.buckets.length > 1 ? `<div class="quota-bucket-name">${escape(b.label)}</div>` : ''}<div class="quota-windows">${b.windows.map((w) => windowHTML(w, p, provider, summary)).join('')}</div>`,
    )
    .join('');
  const fallback =
    p.note ||
    (p.state === 'loading'
      ? 'Получаем сведения от провайдера…'
      : provider === 'claude'
        ? 'Показатели появятся после подключения Claude.'
        : 'Провайдер не передал сведения о лимитах.');
  const details =
    p.buckets
      .map(
        (b) =>
          `${summary ? b.windows.map((w) => `<div class="quota-reset"><strong>${escape(w.label)}</strong> · ${escape(resetText(w))}</div>`).join('') : ''}${b.credits ? `<div class="quota-extra">Дополнительные кредиты: ${b.credits.unlimited ? 'без ограничения' : b.credits.balance === null ? 'нет данных' : escape(b.credits.balance)}</div>` : ''}${b.spendControlReached ? '<p class="quota-notice">Провайдер сообщил об ограничении расходов.</p>' : ''}`,
      )
      .join('') +
    `${p.resetCredits !== null && p.resetCredits !== undefined ? `<p class="quota-extra">Доступно сбросов лимита: <strong>${p.resetCredits}</strong></p>` : ''}${hasWindows && p.note ? `<p class="quota-note">${escape(p.note)}</p>` : ''}${p.updatedAt !== null && p.updatedAt !== undefined ? `<div class="quota-observed">${provider === 'codex' ? 'Получено от OpenAI' : 'Получено от Claude'} · ${escape(time(p.updatedAt))}${p.stale ? ' · сведения могли измениться' : ''}</div>` : ''}`;
  return `<article class="quota-card" data-quota-provider="${provider}">
    <div class="quota-provider"><span class="quota-provider-symbol ${provider}">${provider === 'codex' ? '◈' : '✳'}</span><strong>${names[provider]}</strong>${p.buckets[0]?.plan ? `<span class="quota-plan">${escape(p.buckets[0].plan)}</span>` : ''}<span class="quota-state">${escape(state)}</span></div>
    ${windows}${!hasWindows ? `<p class="quota-empty">${escape(fallback)}</p>` : ''}
    ${p.ordinaryUsageAllowed === false ? '<p class="quota-notice">Включённое использование ограничено провайдером.</p>' : ''}
    ${summary && details ? `<details class="quota-details" data-quota-details="${provider}"><summary>Сброс и подробности ${chevron}</summary><div>${details}</div></details>` : details}
  </article>`;
}
function quickSummary(limits, providers) {
  return providers
    .map((provider) => {
      const p = limits?.[provider];
      const windows = p?.buckets[0]?.windows || [];
      const values = windows.length
        ? windows
            .map(
              (w) =>
                `<span>${escape(w.label)} <strong>${known(w) ? escape(w.remainingPercent) + '%' : '—'}</strong></span>`,
            )
            .join('')
        : `<span>${escape(stateLabels[p?.state] || 'Нет данных')}</span>`;
      return `<span class="quota-quick-provider">${providers.length > 1 ? `<span class="quota-quick-name">${names[provider]}</span>` : ''}${values}${p?.stale ? '<span class="quota-quick-stale">последние данные</span>' : ''}</span>`;
    })
    .join('');
}
export function limitsHTML(limits, { compact = false, provider = null, summary = false } = {}) {
  const providers = provider ? [provider].filter((p) => names[p]) : ['codex', 'claude'];
  if (!providers.length) return '';
  const cards = `<div class="quota-grid">${providers.map((p) => card(p, limits?.[p], summary || compact)).join('')}</div>`;
  if (compact)
    return `<details id="quota-panel" class="quota-panel compact" aria-label="Оставшиеся лимиты агентов"><summary class="quota-compact-heading"><span class="quota-summary-name">Лимиты</span><span class="quota-quick-values">${quickSummary(limits, providers)}</span>${chevron}</summary><div class="quota-expanded">${provider !== 'claude' ? refreshButton : ''}${cards}<p class="quota-disclaimer">Значения переданы провайдером. Устаревшие сведения помечаются.</p></div></details>`;
  return `<section id="quota-panel" class="quota-panel ${summary ? 'summary' : ''}" aria-label="Оставшиеся лимиты агентов"><div class="quota-heading"><h2>Лимиты агентов</h2>${refreshButton}</div>${cards}<p class="quota-disclaimer">Показан остаток квоты. Codex обновляется каждую минуту.</p></section>`;
}

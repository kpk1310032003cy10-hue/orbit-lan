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
function card(provider, data, compact) {
  const p = data || { state: 'loading', buckets: [] };
  const hasWindows = p.buckets.some((b) => b.windows.length);
  const state = p.stale
    ? 'Последние данные'
    : stateLabels[p.state] ||
      (p.status === 'rejected' || p.ordinaryUsageAllowed === false
        ? 'Есть ограничение'
        : 'Данные провайдера');
  const windows = p.buckets
    .map(
      (b) =>
        `${p.buckets.length > 1 ? `<div class="quota-bucket-name">${escape(b.label)}</div>` : ''}${b.windows
          .map((w) => {
            const known =
              typeof w.remainingPercent === 'number' &&
              Number.isFinite(w.remainingPercent) &&
              !w.expired;
            const tone = !known
              ? 'unknown'
              : w.remainingPercent <= 10
                ? 'low'
                : w.remainingPercent <= 25
                  ? 'warning'
                  : 'normal';
            const label = w.expired
              ? 'Ждём обновление окна'
              : known
                ? w.stale || p.stale
                  ? 'последний остаток'
                  : 'осталось'
                : 'процент недоступен';
            return `<div class="quota-window ${tone}"><div class="quota-window-heading"><span>${escape(w.label)}</span><strong class="quota-value">${known ? escape(w.remainingPercent) + '%' : '—'}</strong><span class="quota-remaining-label">${label}</span></div>${!compact && known ? `<meter min="0" max="100" value="${w.remainingPercent}" aria-label="${escape(names[provider])}: остаток ${escape(w.label)}">${w.remainingPercent}%</meter>` : ''}<div class="quota-reset">${w.expired ? 'Срок окна прошёл; новый остаток пока не получен' : w.resetsAt ? 'Сброс ' + escape(time(w.resetsAt)) : 'Время сброса недоступно'}${w.status === 'rejected' ? ' · лимит достигнут по данным провайдера' : ''}</div></div>`;
          })
          .join(
            '',
          )}${!compact && b.credits ? `<div class="quota-extra">Дополнительные кредиты: ${b.credits.unlimited ? 'без ограничения' : b.credits.balance === null ? 'нет данных' : escape(b.credits.balance)}</div>` : ''}${b.spendControlReached ? '<p class="quota-notice">Провайдер сообщил об ограничении расходов.</p>' : ''}`,
    )
    .join('');
  const fallback =
    p.note ||
    (p.state === 'loading'
      ? 'Получаем сведения от провайдера…'
      : provider === 'claude'
        ? 'Ждём сведения о лимитах из сессии Claude.'
        : 'Провайдер не передал сведения о лимитах.');
  return `<article class="quota-card" data-quota-provider="${provider}"><div class="quota-provider"><span class="quota-provider-symbol ${provider}">${provider === 'codex' ? '◈' : '✳'}</span><strong>${names[provider]}</strong>${p.buckets[0]?.plan ? `<span class="quota-plan">${escape(p.buckets[0].plan)}</span>` : ''}<span class="quota-state">${escape(state)}</span></div>${windows}${!hasWindows ? `<p class="quota-empty">${escape(fallback)}</p>` : ''}${p.ordinaryUsageAllowed === false ? '<p class="quota-notice">Включённое использование ограничено провайдером.</p>' : ''}${!compact && p.resetCredits !== null && p.resetCredits !== undefined ? `<p class="quota-extra">Доступно сбросов лимита: <strong>${p.resetCredits}</strong></p>` : ''}${!compact && hasWindows && p.note ? `<p class="quota-note">${escape(p.note)}</p>` : ''}${p.updatedAt !== null && p.updatedAt !== undefined ? `<div class="quota-observed">${provider === 'codex' ? 'Получено от OpenAI' : 'Получено от Claude'} · ${escape(time(p.updatedAt))}${p.stale ? ' · сведения могли измениться' : ''}</div>` : ''}</article>`;
}
export function limitsHTML(limits, { compact = false, provider = null } = {}) {
  const providers = provider ? [provider].filter((p) => names[p]) : ['codex', 'claude'];
  if (!providers.length) return '';
  return `<section id="quota-panel" class="quota-panel ${compact ? 'compact' : ''}" data-compact="${compact}" data-provider="${provider || ''}" aria-label="Оставшиеся лимиты агентов"><div class="quota-heading"><h2>${compact ? 'Оставшиеся лимиты' : 'Лимиты ваших агентов'}</h2>${provider !== 'claude' ? '<button class="quota-refresh" data-a="limits-refresh" data-online aria-label="Обновить лимиты Codex">↻ <span>Обновить Codex</span></button>' : ''}</div><div class="quota-grid">${providers.map((p) => card(p, limits?.[p], compact)).join('')}</div>${!compact ? '<p class="quota-disclaimer">Остаток показан в процентах лимита. Точное число будущих сообщений провайдеры не сообщают. Codex проверяется каждую минуту.</p>' : ''}</section>`;
}

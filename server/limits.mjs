import { EventEmitter } from 'node:events';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const percentLeft = (used) =>
  finite(used) && used >= 0 ? Math.round(Math.max(0, 100 - used) * 10) / 10 : null;
const timestamp = (v) => (finite(v) && v > 0 ? v * (v < 100_000_000_000 ? 1000 : 1) : null);
const initial = (provider) => ({
  provider,
  state: provider === 'codex' ? 'loading' : 'awaiting',
  updatedAt: null,
  buckets: [],
  resetCredits: null,
  ordinaryUsageAllowed: null,
  note: null,
});
function windowLabel(minutes, fallback) {
  if (!finite(minutes) || minutes <= 0) return fallback;
  if (minutes === 10080) return 'Неделя';
  if (minutes % 1440 === 0) return `${minutes / 1440} дн.`;
  if (minutes % 60 === 0) return `${minutes / 60} ч`;
  return `${minutes} мин`;
}
function codexBucket(raw, key, now) {
  const windows = ['primary', 'secondary'].flatMap((id, index) => {
    const w = raw[id];
    if (!w || typeof w !== 'object') return [];
    return [
      {
        id,
        label: windowLabel(w.windowDurationMins, index ? 'Дополнительное окно' : 'Основное окно'),
        remainingPercent: percentLeft(w.usedPercent),
        resetsAt: timestamp(w.resetsAt),
        updatedAt: now,
      },
    ];
  });
  const credit = raw.credits;
  return {
    id: raw.limitId || key || 'codex',
    label: raw.limitName || (key && key !== 'codex' ? key : 'Codex'),
    plan: raw.planType || null,
    windows,
    credits: credit
      ? {
          balance:
            typeof credit.balance === 'string' || finite(credit.balance)
              ? String(credit.balance)
              : null,
          unlimited: credit.unlimited === true,
        }
      : null,
    spendControlReached: raw.spendControlReached === true,
  };
}
export function normalizeCodex(data, now = Date.now()) {
  const map = data?.rateLimitsByLimitId;
  const entries =
    map && typeof map === 'object' && Object.keys(map).length
      ? Object.entries(map)
      : data?.rateLimits
        ? [[data.rateLimits.limitId || 'codex', data.rateLimits]]
        : [];
  return {
    ...initial('codex'),
    state: entries.length ? 'ready' : 'unavailable',
    updatedAt: entries.length ? now : null,
    buckets: entries
      .filter(([, b]) => b && typeof b === 'object')
      .map(([id, b]) => codexBucket(b, id, now)),
    resetCredits:
      Number.isInteger(data?.rateLimitResetCredits?.availableCount) &&
      data.rateLimitResetCredits.availableCount >= 0
        ? data.rateLimitResetCredits.availableCount
        : null,
    ordinaryUsageAllowed:
      typeof data?.ordinaryUsageAllowed === 'boolean' ? data.ordinaryUsageAllowed : null,
    note: entries.length ? null : 'Провайдер не передал сведения о лимитах.',
  };
}
// Rolling notifications omit nullable account fields. They are not authoritative
// resets: retain known values until the next complete account snapshot.
function mergeAvailable(previous = {}, next = {}) {
  const out = { ...previous };
  for (const [key, value] of Object.entries(next))
    if (value !== null && value !== undefined) {
      out[key] =
        ['primary', 'secondary', 'credits'].includes(key) && typeof value === 'object'
          ? mergeAvailable(previous[key], value)
          : value;
    }
  return out;
}
export class Limits extends EventEmitter {
  constructor(rpc, { now = Date.now, cooldownMs = 5000, staleMs = 120000 } = {}) {
    super();
    this.rpc = rpc;
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.staleMs = staleMs;
    this.codex = initial('codex');
    this.claude = initial('claude');
    this.rawCodex = null;
    this.inFlight = null;
    this.lastAttempt = -Infinity;
    this.generation = 0;
    this.claudeAuthenticated = null;
    rpc.on('notification', ({ method, params }) => {
      if (method === 'account/rateLimits/updated' && params?.rateLimits)
        this.updateCodex(params, true);
      if (method === 'account/updated') {
        this.generation++;
        this.rawCodex = null;
        this.codex = initial('codex');
        this.lastAttempt = -Infinity;
        this.publish();
        Promise.resolve(this.inFlight).then(() => this.refreshCodex());
      }
    });
    rpc.on('disconnected', () => {
      this.codex.state = this.codex.updatedAt === null ? 'unavailable' : 'stale';
      this.codex.note = 'Связь с Codex прервана. Отображаются последние полученные данные.';
      this.publish();
    });
  }
  updateCodex(data, sparse = false) {
    const incoming = data.rateLimits;
    const previousView = this.codex;
    if (sparse && this.rawCodex) {
      const previous = this.rawCodex.rateLimitsByLimitId || {
        [this.rawCodex.rateLimits?.limitId || 'codex']: this.rawCodex.rateLimits,
      };
      const key = data.rateLimits.limitId || 'codex';
      data = {
        ...this.rawCodex,
        rateLimits: mergeAvailable(this.rawCodex.rateLimits, data.rateLimits),
        rateLimitsByLimitId: { ...previous, [key]: mergeAvailable(previous[key], data.rateLimits) },
      };
    }
    this.rawCodex = data;
    this.codex = normalizeCodex(data, this.now());
    if (sparse && previousView.updatedAt !== null) {
      const key = incoming?.limitId || 'codex';
      this.codex.buckets = this.codex.buckets.map((b) => {
        const previous = previousView.buckets.find((old) => old.id === b.id);
        if (!previous) return b;
        if (b.id !== key) return previous;
        return {
          ...b,
          windows: b.windows.map((w) =>
            !incoming?.[w.id] ? previous.windows.find((old) => old.id === w.id) || w : w,
          ),
        };
      });
    }
    this.publish();
  }
  async refreshCodex() {
    if (this.inFlight) return this.inFlight;
    if (this.now() - this.lastAttempt < this.cooldownMs) return this.snapshot();
    this.lastAttempt = this.now();
    const generation = this.generation;
    this.inFlight = (async () => {
      try {
        const data = await this.rpc.call('account/rateLimits/read', {});
        if (generation === this.generation) this.updateCodex(data);
      } catch {
        if (generation === this.generation) {
          this.codex.state = this.codex.updatedAt === null ? 'unavailable' : 'stale';
          this.codex.note =
            'Не удалось обновить лимиты Codex. Проверьте вход в аккаунт и подключение к интернету.';
          this.publish();
        }
      }
      return this.snapshot();
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  setClaudeAuthentication(authenticated) {
    if (authenticated === this.claudeAuthenticated) return;
    this.claudeAuthenticated = authenticated;
    this.claude = initial('claude');
    this.claude.state = authenticated ? 'awaiting' : 'unauthenticated';
    this.claude.note = authenticated
      ? 'Ждём сведения о лимитах от Claude. Запросы модели ради проверки не отправляются.'
      : 'Войдите в Claude Code на компьютере.';
    this.publish();
  }
  observeClaude(info) {
    if (!info || typeof info !== 'object') return;
    const now = this.now();
    this.claudeAuthenticated = true;
    const names = {
      five_hour: '5 ч',
      seven_day: 'Неделя',
      seven_day_opus: 'Неделя · Opus',
      seven_day_sonnet: 'Неделя · Sonnet',
      overage: 'Дополнительное использование',
    };
    const minutes = {
      five_hour: 300,
      seven_day: 10080,
      seven_day_opus: 10080,
      seven_day_sonnet: 10080,
    };
    let windows = this.claude.buckets[0]?.windows || [];
    if (typeof info.rateLimitType === 'string') {
      const id = info.rateLimitType;
      const window = {
        id,
        label: names[id] || 'Окно Claude',
        remainingPercent: percentLeft(finite(info.utilization) ? info.utilization * 100 : null),
        resetsAt: timestamp(info.resetsAt),
        updatedAt: now,
        status: info.status || null,
      };
      windows = [...windows.filter((w) => w.id !== id), window].sort(
        (a, b) => (minutes[a.id] || Infinity) - (minutes[b.id] || Infinity),
      );
    }
    this.claude = {
      ...initial('claude'),
      state: 'ready',
      updatedAt: now,
      status: info.status || null,
      buckets: [{ id: 'claude', label: 'Claude Code', windows, credits: null }],
      note: 'Последние данные из сессий Claude в Орбите. Если провайдер не передал процент, остаток не рассчитывается.',
    };
    this.publish();
  }
  snapshot() {
    const now = this.now();
    const decorate = (provider) => ({
      ...provider,
      stale:
        provider.state === 'stale' ||
        (provider.updatedAt !== null && now - provider.updatedAt > this.staleMs),
      buckets: provider.buckets.map((b) => ({
        ...b,
        windows: b.windows.map((w) => ({
          ...w,
          expired: w.resetsAt !== null && w.resetsAt <= now,
          stale: now - w.updatedAt > this.staleMs,
        })),
      })),
    });
    return { codex: decorate(this.codex), claude: decorate(this.claude) };
  }
  publish() {
    this.emit('update', this.snapshot());
  }
}

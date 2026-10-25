import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Limits, normalizeCodex } from '../server/limits.mjs';
import { limitsHTML } from '../public/limits.js';

const now = 1800000000000;
const sample = () => ({
  accountId: 'private-account-id',
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: 'codex',
    primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: now / 1000 + 3600 },
    secondary: { usedPercent: 25, windowDurationMins: 10080, resetsAt: now / 1000 + 86400 },
    credits: { balance: '0', hasCredits: false, unlimited: false },
    planType: 'plus',
  },
  rateLimitResetCredits: { availableCount: 2, credits: [{ id: 'private-credit-id' }] },
});
class RPC extends EventEmitter {
  count = 0;
  async call(method) {
    assert.equal(method, 'account/rateLimits/read');
    this.count++;
    return sample();
  }
}
test('Codex shows remaining percent, independent windows and real reset counts', () => {
  const p = normalizeCodex(sample(), now);
  assert.deepEqual(
    p.buckets[0].windows.map((w) => [w.label, w.remainingPercent]),
    [
      ['5 ч', 88],
      ['Неделя', 75],
    ],
  );
  assert.equal(p.buckets[0].windows[0].resetsAt, now + 3600000);
  assert.equal(p.resetCredits, 2);
  assert.equal(p.buckets[0].credits.balance, '0');
  assert.equal(JSON.stringify(p).includes('private'), false);
});
test('zero remains zero; missing and invalid numbers never become 100%', () => {
  const data = sample();
  data.rateLimits.primary.usedPercent = 100;
  data.rateLimits.secondary.usedPercent = null;
  const result = normalizeCodex(data, now);
  assert.equal(result.buckets[0].windows[0].remainingPercent, 0);
  assert.equal(result.buckets[0].windows[1].remainingPercent, null);
  data.rateLimits.primary.usedPercent = -1;
  assert.equal(normalizeCodex(data, now).buckets[0].windows[0].remainingPercent, null);
  data.rateLimits.primary.usedPercent = 120;
  assert.equal(normalizeCodex(data, now).buckets[0].windows[0].remainingPercent, 0);
  assert.equal(normalizeCodex({}, now).state, 'unavailable');
  assert.equal(normalizeCodex({}, now).resetCredits, null);
});
test('sparse updates preserve metadata and freshness of untouched buckets and windows', () => {
  let clock = now;
  const rpc = new RPC(),
    limits = new Limits(rpc, { now: () => clock });
  const data = sample();
  data.rateLimitsByLimitId = {
    codex: data.rateLimits,
    other: { limitId: 'other', primary: { usedPercent: 40 } },
  };
  limits.updateCodex(data);
  clock += 30000;
  rpc.emit('notification', {
    method: 'account/rateLimits/updated',
    params: {
      rateLimits: {
        limitId: 'codex',
        planType: null,
        credits: null,
        primary: { usedPercent: 15, windowDurationMins: null, resetsAt: null },
      },
    },
  });
  const p = limits.snapshot().codex;
  assert.equal(p.buckets[0].plan, 'plus');
  assert.equal(p.buckets[0].credits.balance, '0');
  assert.equal(p.resetCredits, 2);
  assert.equal(p.buckets[0].windows[0].remainingPercent, 85);
  assert.equal(p.buckets[0].windows[0].label, '5 ч');
  assert.equal(p.buckets[0].windows[1].updatedAt, now);
  assert.equal(p.buckets[1].windows[0].updatedAt, now);
});
test('expired and stale snapshots do not claim automatic recovery', () => {
  let clock = now;
  const limits = new Limits(new RPC(), { now: () => clock });
  const data = sample();
  data.ordinaryUsageAllowed = false;
  limits.updateCodex(data);
  clock += 7200000;
  const p = limits.snapshot().codex;
  assert.equal(p.stale, true);
  assert.equal(p.buckets[0].windows[0].expired, true);
  assert.equal(p.ordinaryUsageAllowed, false);
  const html = limitsHTML({ codex: p }, { provider: 'codex' });
  assert.ok(html.includes('Ждём обновление окна'));
  assert.ok(html.includes('Последние данные'));
  assert.equal(html.includes('88%'), false);
});
test('concurrent reads are coalesced and errors retain a clearly stale snapshot', async () => {
  let clock = now;
  const rpc = new RPC(),
    limits = new Limits(rpc, { now: () => clock });
  await Promise.all([limits.refreshCodex(), limits.refreshCodex(), limits.refreshCodex()]);
  assert.equal(rpc.count, 1);
  await limits.refreshCodex();
  assert.equal(rpc.count, 1);
  clock += 6000;
  rpc.call = async () => {
    throw new Error('network');
  };
  await limits.refreshCodex();
  const p = limits.snapshot().codex;
  assert.equal(p.state, 'stale');
  assert.equal(p.buckets[0].windows[0].remainingPercent, 88);
  assert.equal(limitsHTML({ codex: p }, { provider: 'codex' }).includes('последний остаток'), true);
});
test('an account change cannot reuse previous-account percentages or an in-flight response', async () => {
  const rpc = new RPC();
  let resolveRead;
  rpc.call = () =>
    new Promise((resolve) => {
      resolveRead = resolve;
    });
  const limits = new Limits(rpc, { now: () => now });
  limits.updateCodex(sample());
  const pending = limits.refreshCodex();
  rpc.emit('notification', { method: 'account/updated', params: { authMode: null } });
  assert.equal(limits.snapshot().codex.buckets.length, 0);
  rpc.call = async () => {
    throw new Error('signed out');
  };
  resolveRead(sample());
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(limits.snapshot().codex.buckets.length, 0);
  assert.equal(limits.snapshot().codex.state, 'unavailable');
});
test('Claude supports known windows and incomplete SDK events without inventing a quota', () => {
  const limits = new Limits(new RPC(), { now: () => now });
  limits.setClaudeAuthentication(false);
  assert.equal(limits.snapshot().claude.state, 'unauthenticated');
  limits.setClaudeAuthentication(true);
  assert.equal(limits.snapshot().claude.state, 'awaiting');
  limits.observeClaude({
    status: 'allowed',
    rateLimitType: 'five_hour',
    resetsAt: now / 1000 + 100,
  });
  assert.equal(limits.snapshot().claude.buckets[0].windows[0].remainingPercent, null);
  limits.observeClaude({
    status: 'allowed_warning',
    rateLimitType: 'five_hour',
    utilization: 0.85,
    resetsAt: now / 1000 + 100,
  });
  limits.observeClaude({
    status: 'allowed',
    rateLimitType: 'seven_day',
    utilization: 0,
    resetsAt: now + 100000,
  });
  assert.deepEqual(
    limits.snapshot().claude.buckets[0].windows.map((w) => w.remainingPercent),
    [15, 100],
  );
  limits.observeClaude({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1 });
  assert.equal(
    limits.snapshot().claude.buckets[0].windows.find((w) => w.id === 'five_hour').remainingPercent,
    0,
  );
  limits.setClaudeAuthentication(false);
  assert.equal(limits.snapshot().claude.buckets.length, 0);
});
test('quota markup preserves unavailable states and escapes provider labels', () => {
  const data = sample();
  data.rateLimits.limitName = '<script>alert(1)</script>';
  data.rateLimits.primary.usedPercent = 100;
  const html = limitsHTML({
    codex: normalizeCodex(data, now),
    claude: { state: 'unauthenticated', buckets: [] },
  });
  assert.ok(html.includes('0%'));
  assert.ok(html.includes('Нужен вход'));
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('Europe/Moscow') === false);
  assert.ok(html.includes('МСК'));
  const empty = limitsHTML(null);
  assert.equal(empty.includes('100%'), false);
  assert.equal(empty.includes('<meter'), false);
});

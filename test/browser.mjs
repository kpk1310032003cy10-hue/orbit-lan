import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyMobileUI } from './mobile-ui.mjs';
import { verifyThemeUI } from './theme-ui.mjs';
import { verifyChatUI } from './chat-ui.mjs';

const isolatedState = process.env.ORBIT_TEST_URL
  ? null
  : await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-browser-'));
const origin = process.env.ORBIT_TEST_URL || 'http://127.0.0.1:8797';
const server = isolatedState
  ? spawn(process.execPath, ['server/main.mjs'], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ORBIT_STATE_DIR: isolatedState,
        ORBIT_HTTP_PORT: '8797',
        ORBIT_HTTPS_PORT: '8798',
        ORBIT_LAN_IP: '127.0.0.1',
      },
    })
  : null;
if (server) {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + '/api/session')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    server.kill();
    throw new Error('Isolated browser-test server did not start');
  }
}
const browserPath =
  process.env.ORBIT_CHROME_PATH ||
  (process.platform === 'win32'
    ? path.join(
        process.env.PROGRAMFILES || 'C:/Program Files',
        'Google/Chrome/Application/chrome.exe',
      )
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
await fs.mkdir('test-results', { recursive: true });
const failures = [];
const json = async (url, data, csrf = 'local-origin-protected') => {
  const r = await fetch(origin + url, {
    headers: data
      ? { Origin: origin, 'Content-Type': 'application/json', 'X-Orbit-CSRF': csrf }
      : {},
    ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  assert.ok(r.ok, JSON.stringify(b));
  return b;
};
const boot = await json('/api/bootstrap');
const sourceFile = await fetch(
  origin + '/api/download?root=' + encodeURIComponent(boot.roots[0].id) + '&path=package.json',
);
assert.ok(sourceFile.ok);
assert.equal((await sourceFile.json()).name, 'orbit-lan');
const screens = [
  ['desktop', 1440, 1000],
  ['iphone', 390, 844],
  ['ipad', 1024, 1366],
];
try {
  for (const [name, width, height] of screens) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: name !== 'desktop',
      hasTouch: name !== 'desktop',
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => failures.push(`${name}: ${e.message}`));
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
    await page.locator('#quota-panel').waitFor();
    assert.equal(await page.locator('#quota-panel [data-quota-provider]').count(), 2);
    const refreshedLimits = page.waitForResponse(
      (r) => r.url().endsWith('/api/limits/refresh') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Обновить лимиты Codex' }).click();
    await refreshedLimits;
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-quota-provider="codex"] .quota-state')
          ?.textContent.includes('Получаем данные'),
    );
    const quota = await json('/api/limits');
    assert.deepEqual(Object.keys(quota).sort(), ['claude', 'codex']);
    assert.equal(JSON.stringify(quota).includes('accountId'), false);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${name} horizontal overflow`,
    );
    await page.screenshot({ path: `test-results/${name}-overview.png`, fullPage: true });
    const nav = name === 'iphone' ? page.locator('.mobile-nav') : page.locator('.nav');
    await nav.getByRole('button', { name: 'Файлы' }).click();
    await page.getByRole('heading', { name: 'Рабочие файлы' }).waitFor();
    await page.locator('.file-row').first().waitFor();
    await page.screenshot({ path: `test-results/${name}-files.png`, fullPage: true });
    await nav.getByRole('button', { name: 'Подключение' }).click();
    await page.locator('.pin').waitFor();
    assert.match(await page.locator('.pin').innerText(), /^\d{6}$/);
    const wakeStatus = await json('/api/wake');
    assert.equal(wakeStatus.testedFromSleep, false);
    assert.equal('deviceId' in wakeStatus, false);
    await page.route('**/api/wake*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'configured',
          armed: true,
          magicPacket: true,
          testedFromSleep: false,
          profile: {
            ip: '192.168.50.10',
            mac: '02:00:00:00:00:10',
            broadcast: '192.168.51.255',
            protocol: 'UDP',
            port: 9,
          },
        }),
      }),
    );
    await page.getByRole('button', { name: 'Проверить пробуждение' }).click();
    await page.locator('#wake-card').getByText('02:00:00:00:00:10', { exact: true }).waitFor();
    await page.locator('#wake-card summary').click();
    await page.getByRole('button', { name: 'Проверить пробуждение' }).click();
    assert.equal(await page.locator('#wake-card details').evaluate((el) => el.open), true);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Копировать MAC' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '02:00:00:00:00:10');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать памятку' }).click();
    const wakeDownload = await downloadEvent;
    const guide = await fs.readFile(await wakeDownload.path(), 'utf8');
    assert.ok(guide.includes('02:00:00:00:00:10') && guide.includes('192.168.51.255'));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${name} wake guide overflow`,
    );
    await page.screenshot({ path: `test-results/${name}-settings.png`, fullPage: true });
    await nav.getByRole('button', { name: 'Агенты' }).click();
    await page.getByRole('heading', { name: 'Ваши агенты' }).waitFor();
    await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
    await page.locator('#new-agent-form').waitFor();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    const cards = page.locator('.agent-card');
    if (await cards.count()) {
      await cards.first().click();
      await page.locator('#transcript').waitFor();
      await page.locator('#quota-panel.compact').waitFor();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `test-results/${name}-chat.png`, fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${name} chat overflow`,
      );
    }
    await context.close();
  }
  await verifyMobileUI(browser, origin);
  await verifyThemeUI(browser, origin);
  await verifyChatUI(browser, origin);
  // A real shell command, its persisted output, and owned process-tree cancellation.
  const cwd = process.cwd();
  const task = await json('/api/tasks', {
    cwd,
    command: "Write-Output 'ORBIT_TEST_ЖУРНАЛ'; Start-Sleep -Seconds 40",
  });
  const liveContext = await browser.newContext();
  const livePage = await liveContext.newPage();
  await livePage.goto(origin + '/#processes');
  const taskCard = livePage
    .locator('.task-card')
    .filter({ has: livePage.getByRole('heading', { name: /ORBIT_TEST_ЖУРНАЛ/ }) })
    .first();
  await taskCard.getByRole('button', { name: 'Журнал' }).click();
  await livePage
    .locator('#transcript .tool-output')
    .filter({ hasText: 'ORBIT_TEST_ЖУРНАЛ' })
    .first()
    .waitFor();
  assert.equal((await livePage.locator('#transcript').innerText()).includes('CLIXML'), false);
  let events;
  for (let attempt = 0; attempt < 15; attempt++) {
    events = await json(`/api/agents/${task.id}/events`);
    if (events.events.some((e) => e.payload.text?.includes('ORBIT_TEST_ЖУРНАЛ'))) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(
    events.events.some((e) => e.payload.text?.includes('ORBIT_TEST_ЖУРНАЛ')),
    'UTF-8 task output',
  );
  await json(`/api/agents/${task.id}/stop`, {});
  await livePage.locator('#chat-status').getByText('Остановлен', { exact: true }).waitFor();
  await liveContext.close();
  const overview = await json('/api/overview');
  assert.equal(overview.tasks.find((a) => a.id === task.id).status, 'stopped');
  // A separate HTTPS browser has no local administrator privilege.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`https://127.0.0.1:${new URL(boot.urls.secure).port}`);
  await page.locator('#pair-form').waitFor();
  assert.equal(await page.evaluate(async () => (await fetch('/api/limits')).status), 401);
  assert.equal(await page.evaluate(async () => (await fetch('/api/wake')).status), 401);
  const pin = (await json('/api/bootstrap')).pairing.pin;
  await page.locator('[name=name]').fill('Проверка браузером');
  await page.locator('[name=pin]').fill(pin);
  await page.getByRole('button', { name: 'Подключить устройство' }).click();
  await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
  const session = await page.evaluate(async () => (await fetch('/api/session')).json());
  assert.equal(session.local, false);
  assert.equal(session.authenticated, true);
  const cookies = await context.cookies();
  assert.ok(
    cookies.find((c) => c.name === 'orbit' && c.httpOnly && c.secure && c.sameSite === 'Strict'),
  );
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  await json('/api/device/revoke', { id: session.device.id });
  assert.equal(
    (await page.evaluate(async () => (await fetch('/api/session')).json())).authenticated,
    false,
  );
  await context.close();
  // Host and CSRF checks on the real server.
  const badOrigin = await fetch(origin + '/api/tasks', {
    method: 'POST',
    headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(badOrigin.status, 403);
  const badCSRF = await fetch(origin + '/api/tasks', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Orbit-CSRF': 'wrong' },
    body: '{}',
  });
  assert.equal(badCSRF.status, 403);
  assert.deepEqual(failures, []);
  console.log(
    'PASS: desktop, iPhone, iPad; light/dark/system themes, persistence, live OS and tab changes, blocked storage; 320–1440px, landscape, drafts, search focus, live disclosures, composer, send and stop; files; shell UTF-8 output + stop; HTTPS pairing, cookies, revocation, service worker; Origin/CSRF.',
  );
} finally {
  await browser.close();
  if (server) {
    if (process.platform === 'win32')
      await promisify(execFile)('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], {
        windowsHide: true,
      }).catch(() => {});
    else server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    const resolved = path.resolve(isolatedState);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('orbit-browser-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

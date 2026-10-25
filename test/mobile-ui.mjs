import assert from 'node:assert/strict';

// Every API response is synthetic; these flows never start a model or expose local history.
export async function verifyMobileUI(browser, origin) {
  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
    [844, 390],
    [1024, 1366],
    [1440, 1000],
  ]) {
    const phone = width <= 700 || height <= 500;
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
      colorScheme: [320, 390, 844].includes(width) ? 'dark' : 'light',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor() {
          window.orbitTestStream = this;
        }
        close() {}
      };
    });
    const now = Date.now();
    const device = { id: 'demo', local: true, csrf: 'demo-csrf' };
    const agent = {
      id: 'demo-agent',
      provider: 'codex',
      title: 'Проверить адаптацию проекта для телефона',
      cwd: 'C:/Projects/Demo',
      status: 'running',
      canStop: true,
      pending: [],
      updated: now,
    };
    const limits = {
      codex: {
        state: 'ready',
        buckets: [
          {
            label: 'Codex',
            windows: [
              { label: '5 ч', remainingPercent: 62, resetsAt: now + 3600000 },
              { label: 'Неделя', remainingPercent: 71, resetsAt: now + 86400000 },
            ],
          },
        ],
      },
      claude: { state: 'unauthenticated', buckets: [] },
    };
    const events = [
      { seq: 1, kind: 'user', payload: { text: 'Сделай интерфейс удобным на телефоне.' } },
      {
        seq: 2,
        kind: 'assistant',
        payload: {
          text: 'Проверяю навигацию, читаемость и строку ввода. Длинные строки /Projects/Demo/example/very-long-path-without-spaces не должны расширять экран.',
        },
      },
      {
        seq: 3,
        kind: 'item',
        payload: {
          item: {
            type: 'commandExecution',
            id: 'demo-tool',
            command: 'npm run check',
            status: 'inProgress',
            aggregatedOutput: 'Проверка проекта…',
          },
        },
      },
    ];
    let submitted = null;
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let body;
      if (pathname === '/api/session') body = { authenticated: true, local: true, device };
      else if (pathname === '/api/bootstrap')
        body = {
          name: 'Орбита',
          device,
          roots: [{ id: 'demo', name: 'Проекты', path: 'C:/Projects' }],
          providers: { codex: { authenticated: true }, claude: { authenticated: false } },
          urls: { local: origin, setup: origin, secure: origin },
          pairing: { pin: '123456', expires: now + 600000 },
        };
      else if (pathname === '/api/overview')
        body = {
          agents: [agent],
          tasks: [],
          discovered: { sessions: [] },
          limits,
          system: {
            hostname: 'DEMO',
            cpu: 15,
            memoryUsed: 2 * 1024 ** 3,
            memoryTotal: 16 * 1024 ** 3,
            processes: [{ name: 'node', pid: 100, memory: 64 * 1024 ** 2, cpuSeconds: 8 }],
          },
        };
      else if (pathname === '/api/files')
        body = {
          path: '',
          fullPath: 'C:/Projects',
          items: [
            { name: 'Demo', path: 'Demo', directory: true, modified: now },
            {
              name: 'very-long-file-name-that-must-wrap-on-a-small-screen.md',
              path: 'example.md',
              directory: false,
              size: 2000,
              modified: now,
            },
          ],
        };
      else if (pathname === '/api/agents/demo-agent/events') body = { events };
      else if (pathname === '/api/agents/demo-agent/message') {
        submitted = route.request().postDataJSON().text;
        body = {};
      } else if (pathname === '/api/agents/demo-agent/stop') {
        agent.status = 'stopped';
        agent.canStop = false;
        body = {};
      } else if (pathname === '/api/limits/refresh') body = limits;
      else throw new Error(`Unexpected mock request: ${pathname}`);
      await route.fulfill({
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      });
    });
    const noOverflow = async () =>
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${width}×${height} overflow`,
      );
    try {
      await page.goto(origin);
      await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
      await noOverflow();
      const nav = page.locator(phone ? '.mobile-nav' : '.nav');
      await nav.getByRole('button', { name: 'Агенты' }).click();
      const search = page.getByRole('searchbox', { name: 'Поиск диалогов' });
      await search.focus();
      const originalInput = await search.elementHandle();
      await search.pressSequentially('Проверить');
      assert.equal(
        await page.evaluate(
          (element) =>
            document.activeElement === element &&
            element === document.querySelector('#agent-search'),
          originalInput,
        ),
        true,
        'Search retains its input and focus',
      );
      assert.equal(await page.locator('.agent-card').count(), 1);
      await search.fill('');
      await page.locator('.agent-card').click();
      await page.locator('#transcript .tool').waitFor();
      const composer = page.getByRole('textbox', { name: 'Сообщение агенту' });
      const send = page.getByRole('button', { name: 'Отправить', exact: true });
      assert.ok(
        await composer.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16),
        'Readable composer without iOS field zoom',
      );
      for (const control of [send, page.getByRole('button', { name: 'Стоп', exact: true })]) {
        const box = await control.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, 'Touch target at least 44px');
      }
      if (phone) assert.equal(await nav.isVisible(), false, 'Chat uses the full phone screen');
      await composer.fill('Черновик должен сохраниться');
      await page
        .getByRole('button', { name: phone ? 'Назад к диалогам' : 'Все сессии', exact: true })
        .click();
      await page.locator('.agent-card').click();
      assert.equal(await composer.inputValue(), 'Черновик должен сохраниться');
      if (width === 1440) {
        await page.getByRole('button', { name: 'Оформление', exact: true }).click();
        await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark');
        await page.getByRole('button', { name: 'Готово', exact: true }).click();
        assert.equal(
          await composer.inputValue(),
          'Черновик должен сохраниться',
          'Theme switching retains the active chat draft',
        );
      }
      await page.locator('#quota-panel > summary').click();
      await page.evaluate(
        (payload) =>
          window.orbitTestStream.onmessage({
            data: JSON.stringify({ kind: 'limits.updated', payload }),
          }),
        limits,
      );
      assert.equal(
        await page.locator('#quota-panel').evaluate((el) => el.open),
        true,
        'Live quotas retain expanded state',
      );
      await page.locator('#quota-panel > summary').click();
      await page.locator('.tool > summary').click();
      await page.evaluate(() =>
        window.orbitTestStream.onmessage({
          data: JSON.stringify({
            agentId: 'demo-agent',
            seq: 4,
            kind: 'item',
            payload: {
              item: {
                type: 'commandExecution',
                id: 'demo-tool',
                command: 'npm run check',
                status: 'completed',
                aggregatedOutput: 'Проверка завершена',
              },
            },
          }),
        }),
      );
      await page.locator('.tool-output').getByText('Проверка завершена', { exact: true }).waitFor();
      assert.equal(
        await page.locator('.tool').evaluate((el) => el.open),
        true,
        'Live tool updates retain expanded output',
      );
      const question = {
        id: 'demo-question',
        method: 'item/tool/requestUserInput',
        details: { questions: [{ id: 'color', question: 'Какой цвет выбрать?' }] },
      };
      agent.pending = [question];
      await page.evaluate(
        (payload) =>
          window.orbitTestStream.onmessage({
            data: JSON.stringify({ agentId: 'demo-agent', seq: 5, kind: 'prompt', payload }),
          }),
        question,
      );
      const answer = page.getByRole('textbox', { name: 'Какой цвет выбрать?' });
      await answer.fill('Спокойный зелёный');
      await page.evaluate(() =>
        window.orbitTestStream.onmessage({
          data: JSON.stringify({
            agentId: 'demo-agent',
            seq: 6,
            kind: 'assistant',
            payload: { text: 'Жду ваш выбор.' },
          }),
        }),
      );
      await page.getByText('Жду ваш выбор.', { exact: true }).waitFor();
      assert.equal(
        await answer.inputValue(),
        'Спокойный зелёный',
        'Streaming messages preserve an answer being typed',
      );
      agent.pending = [];
      await page.evaluate(() =>
        window.orbitTestStream.onmessage({
          data: JSON.stringify({
            agentId: 'demo-agent',
            seq: 7,
            kind: 'prompt.resolved',
            payload: { id: 'demo-question' },
          }),
        }),
      );
      await page.waitForFunction(() => !document.querySelector('.prompt-card'));
      if (phone) {
        await composer.focus();
        await page.setViewportSize({ width, height: Math.min(height, 430) });
        await page.waitForFunction(
          () =>
            document.querySelector('#composer').getBoundingClientRect().bottom <= innerHeight + 1,
        );
        const box = await send.boundingBox();
        assert.ok(
          box.y >= 0 && box.y + box.height <= Math.min(height, 430) + 1,
          'Send remains visible when available height shrinks',
        );
        await page.screenshot({ path: `test-results/mobile-${width}-composer.png` });
        await page.setViewportSize({ width, height });
      }
      await noOverflow();
      const response = page.waitForResponse((r) => r.url().endsWith('/message'));
      await send.click();
      await response;
      await page.waitForFunction(() => document.querySelector('#message').value === '');
      assert.equal(submitted, 'Черновик должен сохраниться');
      await page.getByRole('button', { name: 'Стоп', exact: true }).click();
      await page.locator('#chat-status').getByText('Остановлен', { exact: true }).waitFor();
      assert.equal(await composer.getAttribute('placeholder'), 'Напишите сообщение…');
      await page.screenshot({ path: `test-results/mobile-${width}-chat.png` });
      await page
        .getByRole('button', { name: phone ? 'Назад к диалогам' : 'Все сессии', exact: true })
        .click();
      await nav.getByRole('button', { name: 'Файлы' }).click();
      await page.locator('.file-row').first().waitFor();
      await noOverflow();
      await nav.getByRole('button', { name: 'Процессы' }).click();
      await page.getByRole('heading', { name: 'Ваш компьютер', exact: true }).waitFor();
      await noOverflow();
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

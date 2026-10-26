import assert from 'node:assert/strict';

export const chatCode = 'const message = "<strong>Привет</strong>";\nconsole.log(message);\n';
export const chatAnswer = [
  '## Готово к проверке',
  '**Главное:** читать ответ удобно и на телефоне. Ссылки открываются по нажатию, а команды можно скопировать отдельно.',
  '### Что изменилось\n\n- **Навигация** — важные действия рядом.\n- **Переписка** — понятные абзацы и выделения.\n  - Длинные ссылки переносятся внутри сообщения.\n- [x] Светлая и тёмная темы\n- [ ] Проверить результат на устройстве',
  '> Изменения сохраняются в проекте. Перед публикацией проверьте результат.',
  '| Раздел | Состояние | Что проверить |\n|:---|:---:|---|\n| Навигация | Готово | Переходы между экранами без потери черновика |\n| Переписка | Готово | Читаемость длинных ответов и корректность ссылок |\n| Файлы | Проверка | Открытие разрешённых файлов из сообщения |',
  '### Пример кода\n\n```javascript\n' + chatCode + '```',
  'Откройте [README.md](README.md:3) или [документацию](https://example.com/docs). [Вне папки](C:/Other/private.md).',
  '![Внешнее изображение](https://example.com/tracking.png)',
  '<img src=x onerror="window.compromised=true">',
  '### Следующие шаги\n\n1. Просмотрите изменения.\n2. Проверьте файлы.\n3. Сохраните результат.',
  ...Array.from(
    { length: 8 },
    (_, i) =>
      `Проверка ${i + 1}. Текст остаётся читаемым при длинном ответе. Новые фрагменты не мешают просматривать уже полученную информацию.`,
  ),
].join('\n\n');

export async function verifyChatUI(browser, origin) {
  for (const [name, width, height, theme] of [
    ['small', 320, 568, 'light'],
    ['phone', 390, 844, 'dark'],
    ['ipad', 1024, 1366, 'dark'],
    ['desktop', 1440, 1000, 'light'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme,
      isMobile: width < 1024,
      hasTouch: width < 1440,
      serviceWorkers: 'block',
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const errors = [],
      externalRequests = [],
      fileRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin)
        externalRequests.push(request.url());
    });
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor() {
          window.chatTestStream = this;
        }
        close() {}
      };
    });
    const now = Date.now(),
      device = { id: 'demo', csrf: 'demo', local: true };
    const agent = {
      id: 'chat-demo',
      provider: 'codex',
      title: 'Подготовить мобильный интерфейс',
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
            windows: [
              { label: '5 ч', remainingPercent: 72 },
              { label: 'Неделя', remainingPercent: 89 },
            ],
          },
        ],
      },
      claude: { state: 'unauthenticated', buckets: [] },
    };
    const events = [
      ...Array.from({ length: 297 }, (_, i) => ({
        seq: i + 100,
        kind: 'status',
        payload: { status: 'running' },
      })),
      {
        seq: 397,
        created: now - 120000,
        kind: 'user',
        payload: { text: 'Подготовь интерфейс и расскажи, что проверить.' },
      },
      {
        seq: 398,
        created: now - 90000,
        kind: 'assistant',
        payload: { text: 'Проверю **читаемость**, навигацию и работу с файлами.' },
      },
      {
        seq: 399,
        created: now - 60000,
        kind: 'item',
        payload: { item: { type: 'agentMessage', id: 'answer', text: chatAnswer } },
      },
    ];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url()),
        p = url.pathname;
      let body;
      if (p === '/api/session') body = { authenticated: true, local: true, device };
      else if (p === '/api/bootstrap')
        body = {
          device,
          roots: [{ id: 'project', name: 'Демо', path: 'C:/Projects/Demo' }],
          providers: { codex: { authenticated: true }, claude: { authenticated: false } },
          urls: { local: origin, secure: origin, setup: origin },
        };
      else if (p === '/api/overview')
        body = {
          agents: [agent],
          tasks: [],
          discovered: {
            sessions: [
              {
                ...agent,
                id: 'observed-demo',
                title: 'История VS Code',
                external: true,
                source: 'vscode',
                status: 'observed',
                canStop: false,
              },
            ],
          },
          limits,
          system: { hostname: 'DEMO' },
        };
      else if (p === '/api/files') body = { path: '', fullPath: agent.cwd, items: [] };
      else if (p === '/api/agents/chat-demo/events')
        body = {
          events: url.searchParams.has('before')
            ? [
                { seq: 98, kind: 'user', payload: { text: 'Предыдущий вопрос' } },
                {
                  seq: 99,
                  kind: 'assistant',
                  payload: { text: 'Предыдущий ответ.\n\n' + 'Сохранённая история. '.repeat(40) },
                },
              ]
            : events,
        };
      else if (p === '/api/external/observed-demo/history')
        body = url.searchParams.has('cursor')
          ? {
              items: [
                {
                  item: {
                    id: 'older-user',
                    type: 'userMessage',
                    content: [{ type: 'inputText', text: 'Ранее' }],
                  },
                },
                { item: { id: 'older-answer', type: 'agentMessage', text: 'Старый ответ.' } },
              ],
              cursor: null,
            }
          : {
              items: [
                {
                  item: {
                    id: 'outside-user',
                    type: 'userMessage',
                    content: [{ type: 'inputText', text: 'Покажи результат' }],
                  },
                },
                {
                  item: {
                    id: 'outside-answer',
                    type: 'agentMessage',
                    text: '**Внешний ответ**\n\n- Списки\n- [Ссылка](https://example.com/docs)',
                  },
                },
              ],
              cursor: 'older',
            };
      else if (p === '/api/file') {
        fileRequests.push({
          root: url.searchParams.get('root'),
          path: url.searchParams.get('path'),
        });
        body = { content: 'Первый\nВторой\nНужная строка\nЧетвёртый\n', version: 'demo' };
      } else throw new Error('Unexpected chat fixture request: ' + p);
      await route.fulfill({
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      });
    });
    const emit = async (event) =>
      page.evaluate(
        (event) =>
          window.chatTestStream.onmessage({
            data: JSON.stringify({ agentId: 'chat-demo', ...event }),
          }),
        event,
      );
    try {
      await page.goto(origin + '/#agents');
      await page.locator('.agent-card[data-id="chat-demo"]').click();
      const answer = page.locator('[data-message-id="item:answer"]');
      await answer.locator('strong').first().waitFor();
      assert.equal(await answer.locator('strong').first().innerText(), 'Главное:');
      assert.ok((await answer.locator('li').count()) >= 8);
      assert.equal(await answer.locator('img,script,iframe').count(), 0);
      const source = answer.getByRole('link', { name: 'документацию', exact: true });
      assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await source.getAttribute('href'), 'https://example.com/docs');
      assert.equal(
        await answer
          .locator('th')
          .first()
          .evaluate((el) => getComputedStyle(el).display),
        'table-cell',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const oldMessage = await page.locator('[data-message-id="event:398"]').elementHandle();
      const table = answer.locator('.message-table');
      await table.getByRole('button', { name: 'Карточки', exact: true }).click();
      assert.equal(await table.locator('.table-record').count(), 3);
      await table.evaluate((el) => {
        const scroller = document.querySelector('#chat-scroll');
        scroller.scrollTop +=
          el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
      });
      await page.screenshot({
        path: `test-results/chat-${name}-${theme}-table.png`,
        animations: 'disabled',
      });
      await table.getByRole('button', { name: 'Копировать таблицу' }).click();
      assert.ok(
        (await page.evaluate(() => navigator.clipboard.readText())).includes(
          'Раздел\tСостояние\tЧто проверить',
        ),
      );
      await answer.getByRole('button', { name: 'Копировать код' }).click();
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'),
        chatCode,
      );
      await answer.getByRole('button', { name: 'Копировать сообщение' }).click();
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'),
        chatAnswer,
      );
      await answer.getByRole('button', { name: 'README.md', exact: true }).click();
      await page.locator('#edit-file-form').waitFor();
      assert.deepEqual(fileRequests, [{ root: 'project', path: 'README.md' }]);
      assert.equal(await page.locator('#edit-file-form').getAttribute('data-root'), 'project');
      await page.locator('#dialog').getByRole('button', { name: 'Закрыть' }).click();
      await page.getByRole('textbox', { name: 'Сообщение агенту' }).fill('Не потерять черновик');
      await page.locator('#chat-scroll').evaluate((el) => {
        el.scrollTop = 380;
        el.dispatchEvent(new Event('scroll'));
      });
      const before = await page.locator('#chat-scroll').evaluate((el) => el.scrollTop);
      await emit({
        seq: 400,
        kind: 'delta',
        payload: { itemId: 'answer', text: '\n\nНовое уточнение в конце ответа.' },
      });
      await answer.getByText('Новое уточнение в конце ответа.', { exact: true }).waitFor();
      assert.ok(
        Math.abs((await page.locator('#chat-scroll').evaluate((el) => el.scrollTop)) - before) <= 2,
        'Streaming preserves reading position',
      );
      assert.equal(
        await page.evaluate(
          (node) =>
            node.isConnected && node === document.querySelector('[data-message-id="event:398"]'),
          oldMessage,
        ),
        true,
        'Earlier messages retain their DOM nodes',
      );
      assert.equal(await table.locator('.table-cards').isVisible(), true);
      await page.evaluate(() => {
        const text = document.querySelector(
          '[data-message-id="item:answer"] .rich-text p strong',
        ).firstChild;
        const range = document.createRange();
        range.selectNodeContents(text);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const selection = await page.evaluate(() => getSelection().toString());
      await emit({
        seq: 401,
        kind: 'delta',
        payload: { itemId: 'answer', text: '\n\nЕщё один фрагмент.' },
      });
      await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => getSelection().toString()), selection);
      await page.evaluate(() => getSelection().removeAllRanges());
      await answer.getByText('Ещё один фрагмент.', { exact: true }).waitFor();
      await page.locator('#chat-latest').click();
      await page.waitForFunction(() => {
        const el = document.querySelector('#chat-scroll');
        return el.scrollHeight - el.scrollTop - el.clientHeight < 5;
      });
      await page.locator('#chat-scroll').evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
      });
      await answer.evaluate((el) => {
        const scroller = document.querySelector('#chat-scroll');
        scroller.scrollTop +=
          el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      });
      await page.locator('#toast.show').waitFor({ state: 'detached' });
      await page.screenshot({
        path: `test-results/chat-${name}-${theme}.png`,
        animations: 'disabled',
      });
      await page.locator('#chat-scroll').evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
      });
      const first = await page.locator('[data-message-id="event:397"]').elementHandle();
      const firstTop = await first.evaluate((el) => el.getBoundingClientRect().top);
      await page.getByRole('button', { name: 'Предыдущие события', exact: true }).click();
      await page.locator('[data-message-id="event:98"]').waitFor();
      assert.ok(
        Math.abs((await first.evaluate((el) => el.getBoundingClientRect().top)) - firstTop) <= 2,
        'Loading older history preserves the visible anchor',
      );
      assert.equal(
        await page.getByRole('textbox', { name: 'Сообщение агенту' }).inputValue(),
        'Не потерять черновик',
      );
      await answer.getByRole('button', { name: 'Вне папки', exact: true }).click();
      assert.equal(fileRequests.length, 1);
      await page
        .getByRole('button', {
          name: width <= 700 ? 'Назад к диалогам' : 'Все сессии',
          exact: true,
        })
        .click();
      await page.locator('.agent-card[data-id="observed-demo"]').click();
      await page
        .locator('#transcript strong')
        .getByText('Внешний ответ', { exact: true })
        .waitFor();
      const observed = await page
        .locator('[data-message-id="event:external:outside-user"]')
        .elementHandle();
      await page.getByRole('button', { name: 'Предыдущие сообщения', exact: true }).click();
      await page.locator('#transcript').getByText('Старый ответ.', { exact: true }).waitFor();
      assert.equal(
        await page.evaluate((node) => node.isConnected, observed),
        true,
        'Observed history preserves message identity too',
      );
      assert.deepEqual(externalRequests, [], 'Markdown never fetches remote assets');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

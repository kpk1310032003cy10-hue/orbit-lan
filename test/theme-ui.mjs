import assert from 'node:assert/strict';

export async function verifyThemeUI(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const expectTheme = async (target, theme) => {
    await target.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme,
    );
    assert.equal(
      await target.locator('html').evaluate((el) => getComputedStyle(el).colorScheme),
      theme,
    );
    assert.equal(
      await target.locator('meta[name="theme-color"]').getAttribute('content'),
      theme === 'dark' ? '#111916' : '#f5f6f2',
    );
  };
  const choose = async (target, theme) => {
    await target.getByRole('button', { name: 'Оформление', exact: true }).click();
    await target
      .locator('#dialog')
      .getByRole('combobox', { name: 'Тема', exact: true })
      .selectOption(theme);
    await target.getByRole('button', { name: 'Готово', exact: true }).click();
  };
  try {
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
    await expectTheme(page, 'dark');
    assert.equal(await page.locator('html').getAttribute('data-theme-preference'), 'system');
    await choose(page, 'light');
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light');
    await page.reload();
    await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
    await expectTheme(page, 'light');
    await choose(page, 'system');
    await expectTheme(page, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');
    const other = await context.newPage();
    await other.goto(origin);
    await other.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
    await choose(other, 'light');
    await expectTheme(page, 'light');
    await other.close();
    await choose(page, 'dark');
    await page.locator('.mobile-nav').getByRole('button', { name: 'Подключение' }).click();
    const setting = page.locator('.theme-settings').getByRole('combobox', { name: 'Тема' });
    assert.equal(await setting.inputValue(), 'dark');
    await setting.selectOption('system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: 'test-results/dark-settings.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  const restricted = await browser.newContext({ colorScheme: 'light' });
  try {
    await restricted.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new DOMException('Storage blocked', 'SecurityError');
      };
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage blocked', 'SecurityError');
      };
    });
    const page = await restricted.newPage();
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
    await choose(page, 'dark');
    await expectTheme(page, 'dark');
    await page.reload();
    await page.getByRole('heading', { name: 'Всё под контролем' }).waitFor();
    await expectTheme(page, 'light');
  } finally {
    await restricted.close();
  }
}

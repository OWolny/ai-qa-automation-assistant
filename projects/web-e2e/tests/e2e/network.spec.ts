import { test, expect } from './fixtures';

test.describe('Slow Resource', () => {
  test('a mocked /slow-external response renders without the real 10s delay', async ({ page }) => {
    await page.route('**/slow-external', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'Mocked slow task result' }),
    );

    await page.goto('/slow');

    await expect(page.getByText('Mocked slow task result')).toBeVisible();
  });
});

test.describe('Random Number', () => {
  test('stubbing Math.random forces a deterministic value', async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0.42;
    });

    await page.goto('/random-number');

    await expect(page.locator('#randomNumber')).toHaveText('0.42');
  });
});

test.describe('Redirector', () => {
  test('following the link redirects through /redirect (302) to /status-codes (200)', async ({ page }) => {
    await page.goto('/redirector');

    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/status-codes'),
      page.getByRole('link', { name: 'here' }).click(),
    ]);

    await expect(page).toHaveURL(/\/status-codes$/);
    expect(response.status()).toBe(200);

    const redirectedFrom = response.request().redirectedFrom();
    expect(redirectedFrom).not.toBeNull();
    expect(new URL(redirectedFrom!.url()).pathname).toBe('/redirect');
    expect((await redirectedFrom!.response())?.status()).toBe(302);
  });
});

test.describe('Status Codes', () => {
  for (const code of [200, 301, 404, 500] as const) {
    test(`/status-codes/${code} returns HTTP ${code}`, async ({ page }) => {
      const response = await page.goto(`/status-codes/${code}`);
      expect(response?.status()).toBe(code);
    });
  }
});

test.describe('Broken Images', () => {
  test('two of the three images fail to load', async ({ page }) => {
    await page.goto('/broken-images');

    const widths = await Promise.all(
      [1, 2, 3].map((n) => page.getByRole('img', { name: `Image ${n}` }).evaluate((img: HTMLImageElement) => img.naturalWidth)),
    );

    expect(widths[0]).toBe(0);
    expect(widths[1]).toBe(0);
    expect(widths[2]).toBeGreaterThan(0);
  });
});

test.describe('Console Logs', () => {
  const cases = [
    { button: 'Log', type: 'log', text: 'simple message' },
    { button: 'Warning', type: 'warning', text: 'warning message' },
    { button: 'Error', type: 'error', text: 'error message' },
    { button: 'Info', type: 'info', text: 'info message' },
    { button: 'Debug', type: 'debug', text: 'debugging message' },
  ] as const;

  for (const { button, type, text } of cases) {
    test(`clicking ${button} emits a console.${type === 'warning' ? 'warn' : type} message`, async ({ page }) => {
      await page.goto('/console-logs');

      const [message] = await Promise.all([
        page.waitForEvent('console', (m) => m.type() === type && m.text().includes(text)),
        page.getByRole('button', { name: button, exact: true }).click(),
      ]);

      expect(message.text()).toContain(text);
    });
  }
});

test.describe('JavaScript Error', () => {
  test('loading the page raises the expected uncaught error', async ({ page }) => {
    const errorPromise = page.waitForEvent('pageerror');

    await page.goto('/javascript-error');

    const error = await errorPromise;
    // Engines phrase this differently (V8 vs SpiderMonkey); both name the missing property and "undefined".
    expect(error.message).toMatch(/xyz/);
    expect(error.message).toMatch(/undefined/);
  });
});

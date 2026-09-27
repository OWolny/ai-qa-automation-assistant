import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const slowResourceMeta = meta({
  feature: Feature.networkHandling,
  capability: Capability.browserNetwork,
  severity: Severity.medium,
  layer: Layer.ui,
});
const randomNumberMeta = meta({
  feature: Feature.dynamicContent,
  capability: Capability.dataPresentation,
  severity: Severity.low,
  layer: Layer.ui,
});
const redirectorMeta = meta({
  feature: Feature.networkHandling,
  capability: Capability.browserNetwork,
  severity: Severity.medium,
  layer: Layer.e2e,
});
const statusCodesMeta = meta({
  feature: Feature.networkHandling,
  capability: Capability.browserNetwork,
  severity: Severity.low,
  layer: Layer.ui,
});
const brokenImagesMeta = meta({
  feature: Feature.networkHandling,
  capability: Capability.browserNetwork,
  severity: Severity.low,
  layer: Layer.ui,
});
const pageDiagnosticsMeta = meta({
  feature: Feature.pageDiagnostics,
  capability: Capability.browserNetwork,
  severity: Severity.low,
  layer: Layer.ui,
});

test.describe('Slow Resource', { annotation: slowResourceMeta }, () => {
  test('the slow-task result is displayed once its resource responds', async ({ page }) => {
    // Fulfilled locally so the test does not wait for the real ~10s delay.
    await page.route('**/slow-external', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'Mocked slow task result' }),
    );

    await page.goto('/slow');

    await expect(page.getByText('Mocked slow task result')).toBeVisible();
  });
});

test.describe('Random Number', { annotation: randomNumberMeta }, () => {
  test('the page displays the generated random number', async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0.42;
    });

    await page.goto('/random-number');

    await expect(page.locator('#randomNumber')).toHaveText('0.42');
  });
});

test.describe('Redirector', { annotation: redirectorMeta }, () => {
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

test.describe('Status Codes', { annotation: statusCodesMeta }, () => {
  for (const code of [200, 301, 404, 500] as const) {
    test(`/status-codes/${code} returns HTTP ${code}`, async ({ page }) => {
      const response = await page.goto(`/status-codes/${code}`);
      expect(response?.status()).toBe(code);
    });
  }
});

test.describe('Broken Images', { annotation: brokenImagesMeta }, () => {
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

test.describe('Console Logs', { annotation: pageDiagnosticsMeta }, () => {
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

test.describe('JavaScript Error', { annotation: pageDiagnosticsMeta }, () => {
  test('loading the page raises the expected uncaught error', async ({ page }) => {
    const errorPromise = page.waitForEvent('pageerror');

    await page.goto('/javascript-error');

    const error = await errorPromise;
    // Engines phrase this differently (V8 vs SpiderMonkey); both name the missing property and "undefined".
    expect(error.message).toMatch(/xyz/);
    expect(error.message).toMatch(/undefined/);
  });
});

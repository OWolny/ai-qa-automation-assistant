import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const browserContextMeta = meta({
  feature: Feature.browserContext,
  capability: Capability.browserNetwork,
  severity: Severity.medium,
  layer: Layer.ui,
});
const httpHeadersMeta = meta({
  feature: Feature.browserContext,
  capability: Capability.browserNetwork,
  severity: Severity.low,
  layer: Layer.ui,
});

test.describe('Geolocation', { annotation: browserContextMeta }, () => {
  test.use({ geolocation: { latitude: 51.5074, longitude: -0.1278 }, permissions: ['geolocation'] });

  test('echoes the granted coordinates and resolved city', async ({ page }) => {
    await page.goto('/geolocation');
    await page.getByRole('button', { name: 'Where am I?' }).click();

    await expect(page.getByTestId('lat-value')).toHaveText('51.5074');
    await expect(page.getByTestId('lon-value')).toHaveText('-0.1278');
    await expect(page.getByTestId('city-name')).toHaveText('City of Westminster');
  });
});

test.describe('Cookie alert', { annotation: browserContextMeta }, () => {
  test('accepting the cookie alert stores the consent cookie', async ({ page, context }) => {
    await page.goto('/cookie-alert');

    const before = await context.cookies();
    expect(before.find((cookie) => cookie.name === 'cookie-box')).toBeUndefined();

    await page.getByRole('button', { name: 'I Accept' }).click();

    await expect
      .poll(async () => (await context.cookies()).find((cookie) => cookie.name === 'cookie-box')?.value)
      .toBe('true');
  });
});

test.describe('HTTP headers', { annotation: httpHeadersMeta }, () => {
  test.use({ extraHTTPHeaders: { 'x-qa-showcase': 'demo-value' } });

  test('echoes a custom request header in the headers table', async ({ page }) => {
    await page.goto('/http-headers');

    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'x-qa-showcase', exact: true }) });
    await expect(row.getByRole('cell').nth(1)).toHaveText('demo-value');
  });
});

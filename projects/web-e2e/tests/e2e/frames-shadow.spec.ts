import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const iframeMeta = meta({
  feature: Feature.embeddedContent,
  capability: Capability.pageInteractions,
  severity: Severity.medium,
  layer: Layer.ui,
});
const shadowDomMeta = meta({
  feature: Feature.embeddedContent,
  capability: Capability.pageInteractions,
  severity: Severity.low,
  layer: Layer.ui,
});

test.describe('Iframe email subscribe', { annotation: iframeMeta }, () => {
  test('subscribing with an email shows the success message', { tag: '@T61bfaf4c' }, async ({ page }) => {
    await page.goto('/iframe');
    const frame = page.frameLocator('#email-subscribe');

    await frame.locator('#email').fill('playwright-user@example.com');
    await frame.getByRole('button', { name: 'Subscribe' }).click();

    await expect(frame.locator('#success-message')).toHaveText('You are now subscribed!');
  });
});

test.describe('Shadow DOM', { annotation: shadowDomMeta }, () => {
  test('a button rendered inside a shadow root is visible and labelled', async ({ page }) => {
    await page.goto('/shadowdom');
    const shadowButton = page.getByRole('button', { name: 'This button is inside a Shadow DOM.' });

    await expect(shadowButton).toBeVisible();
    await expect(page.locator('#shadow-host').getByRole('button')).toHaveText(
      'This button is inside a Shadow DOM.',
    );
  });
});

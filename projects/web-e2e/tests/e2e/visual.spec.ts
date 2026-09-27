import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const visualMeta = meta({
  feature: Feature.visualAppearance,
  capability: Capability.accessibilityLayout,
  severity: Severity.low,
  layer: Layer.ui,
});

test.describe('Visual regression', { tag: '@visual', annotation: visualMeta }, () => {
  // Font rendering differs per OS and engine; baselines are generated for Chromium on Linux in CI.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Baselines exist for Chromium only');
  test.skip(process.platform !== 'linux', 'Baselines are generated on Linux (CI)');

  test('login form matches the approved baseline', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('form#login')).toHaveScreenshot('login-form.png', {
      animations: 'disabled',
    });
  });
});

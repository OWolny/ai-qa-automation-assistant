import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const accessibilityMeta = meta({
  feature: Feature.accessibility,
  capability: Capability.accessibilityLayout,
  severity: Severity.medium,
  layer: Layer.ui,
});

test.describe('Accessibility', { annotation: accessibilityMeta }, () => {
  test('the login form has no WCAG 2 A/AA violations', { annotation: meta({ severity: Severity.high }) }, async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page })
      .include('form#login')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(results.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  });

  test('the inputs page core content has no WCAG 2 A/AA violations', { tag: '@T6913e998' }, async ({ page }) => {
    await page.goto('/inputs');
    const results = await new AxeBuilder({ page })
      .include('#core')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(results.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  });

  test('the login page has no violations outside its two triaged contrast issues', async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // Known site-wide contrast failures, triaged as out of our control: "Buy us a coffee" (3:1)
      // and the footer "Expand Testing" link (4.26:1). Every other node and rule must pass.
      .exclude('.btn-expand')
      .exclude('.my-link')
      .analyze();

    expect(results.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  });

  test('the login form structure matches its expected accessibility tree', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form#login')).toMatchAriaSnapshot(`
      - text: Username
      - textbox "Username"
      - text: Password
      - textbox "Password"
      - button "Login"
    `);
  });
});

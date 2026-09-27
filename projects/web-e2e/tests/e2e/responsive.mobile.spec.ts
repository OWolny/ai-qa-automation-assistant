import { test, expect } from './fixtures';

test.describe('Mobile navigation (Pixel 7 emulation)', () => {
  test('collapses the main nav behind a hamburger toggler', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const toggler = nav.getByRole('button', { name: 'Toggle navigation' });

    // Hidden at desktop widths; visible only because the Pixel 7 viewport crosses the breakpoint.
    await expect(toggler).toBeVisible();
    await expect(toggler).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Test Cases' })).toBeHidden();
  });

  test('tapping the toggler reveals a nav link that can be tapped to navigate', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const toggler = nav.getByRole('button', { name: 'Toggle navigation' });
    const testCasesLink = nav.getByRole('link', { name: 'Test Cases' });

    await toggler.tap();
    await expect(toggler).toHaveAttribute('aria-expanded', 'true');
    await expect(testCasesLink).toBeVisible();

    await testCasesLink.tap();
    await expect(page).toHaveURL(/\/test-cases$/);
    await expect(page.getByRole('heading', { name: 'Practice Test Cases' })).toBeVisible();
  });
});

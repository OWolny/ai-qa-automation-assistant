import { test, expect } from './fixtures';

test.describe('Iframe email subscribe', () => {
  test('subscribing with an email shows the success message', async ({ page }) => {
    await page.goto('/iframe');
    const frame = page.frameLocator('#email-subscribe');

    await frame.locator('#email').fill('playwright-user@example.com');
    await frame.getByRole('button', { name: 'Subscribe' }).click();

    await expect(frame.locator('#success-message')).toHaveText('You are now subscribed!');
  });
});

test.describe('Shadow DOM', () => {
  test('role locators reach a button inside an open shadow root', async ({ page }) => {
    await page.goto('/shadowdom');
    const shadowButton = page.getByRole('button', { name: 'This button is inside a Shadow DOM.' });

    await expect(shadowButton).toBeVisible();
    await expect(page.locator('#shadow-host').getByRole('button')).toHaveText(
      'This button is inside a Shadow DOM.',
    );
  });
});

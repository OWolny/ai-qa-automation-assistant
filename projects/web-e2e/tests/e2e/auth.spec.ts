import { test, expect, blockThirdPartyNoise } from './fixtures';
import { PRACTICE_USER_STORAGE_STATE_PATH } from '../support/auth-state';

const VALID_USERNAME = 'practice';
const VALID_PASSWORD = 'SuperSecretPassword!';

test.describe('Login', () => {
  test('logs in with valid credentials and reaches the secure area', { tag: '@smoke' }, async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await expect(page).toHaveURL('/secure');
    await expect(page.getByRole('main')).toContainText('You logged into a secure area!');
  });

  test('shows an error for an invalid password', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.login(VALID_USERNAME, 'WrongPassword!');
    // The on-page docs claim "Invalid password." but the real alert text differs.
    await expect(loginPage.alert).toContainText('Your password is invalid!');
  });

  test('redirects unauthenticated visitors from the secure area to login', async ({ page }) => {
    await page.goto('/secure');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('alert')).toContainText('You must login to view the secure area!');
  });
});

test.describe('Authenticated via stored session', () => {
  // Loaded from the auth setup project's storageState file instead of logging in through the UI.
  test.use({ storageState: PRACTICE_USER_STORAGE_STATE_PATH });

  test('starts already logged in on the secure area', async ({ page }) => {
    await page.goto('/secure');
    await expect(page).toHaveURL('/secure');
    await expect(page.getByRole('main')).toContainText('Hi, practice!');
    // Never click Logout here: the session is a server-side express-session shared by
    // every test that reuses this stored cookie, so logging out would invalidate it for them.
    await expect(page.getByRole('link', { name: 'Logout' })).toBeVisible();
  });
});

test.describe('OTP login', () => {
  test('logs in with the documented email and OTP code', async ({ page }) => {
    await page.goto('/otp-login');
    await page.getByRole('textbox', { name: 'Your Email Address' }).fill('practice@expandtesting.com');
    await page.getByRole('button', { name: 'Send OTP Code' }).click();
    await expect(page.getByRole('heading', { name: 'OTP Verification' })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Enter OTP code' }).fill('214365');
    await page.getByRole('button', { name: 'Verify OTP Code' }).click();
    await expect(page).toHaveURL('/secure');
  });

  test('shows an error for an incorrect OTP code', async ({ page }) => {
    await page.goto('/otp-login');
    await page.getByRole('textbox', { name: 'Your Email Address' }).fill('practice@expandtesting.com');
    await page.getByRole('button', { name: 'Send OTP Code' }).click();
    await expect(page.getByRole('heading', { name: 'OTP Verification' })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Enter OTP code' }).fill('000000');
    await page.getByRole('button', { name: 'Verify OTP Code' }).click();
    // This error is not exposed with role="alert"; it is a plain paragraph.
    await expect(page.getByText('The provided OTP code is incorrect. Please check your code and try again.')).toBeVisible();
  });
});

test.describe('Session isolation between browser contexts', () => {
  // Distinct from "Authenticated via stored session" above: this builds two contexts with
  // different auth state side by side in one test, and loads storageState from a file path
  // (rather than an inline object) to prove a context without it is genuinely logged out.
  test('a context loaded from stored state is authenticated while a fresh context stays logged out', async ({
    browser,
    baseURL,
  }) => {
    const baseURLOption = baseURL !== undefined ? { baseURL } : {};

    const authedContext = await browser.newContext({
      ...baseURLOption,
      storageState: PRACTICE_USER_STORAGE_STATE_PATH,
    });
    try {
      await blockThirdPartyNoise(authedContext);
      const authedPage = await authedContext.newPage();
      await authedPage.goto('/secure');
      await expect(authedPage).toHaveURL('/secure');
      await expect(authedPage.getByRole('main')).toContainText('Hi, practice!');
    } finally {
      await authedContext.close();
    }

    const freshContext = await browser.newContext(baseURLOption);
    try {
      await blockThirdPartyNoise(freshContext);
      const freshPage = await freshContext.newPage();
      await freshPage.goto('/secure');
      await expect(freshPage).toHaveURL('/login');
    } finally {
      await freshContext.close();
    }
  });
});

test.describe('HTTP Basic auth with valid credentials', () => {
  test.use({ httpCredentials: { username: 'admin', password: 'admin' } });

  test('returns 200 and the success message', async ({ page }) => {
    const response = await page.goto('/basic-auth');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText('Congratulations! You must have the proper credentials.');
  });
});

test.describe('HTTP Basic auth without credentials', () => {
  test('returns 401', async ({ page }) => {
    const response = await page.goto('/basic-auth');
    expect(response?.status()).toBe(401);
  });
});

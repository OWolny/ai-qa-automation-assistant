import { test, expect, blockThirdPartyNoise } from './fixtures';
import { PRACTICE_USER_STORAGE_STATE_PATH } from '../support/auth-state';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const loginMeta = meta({
  feature: Feature.login,
  capability: Capability.userAccess,
  severity: Severity.critical,
  layer: Layer.e2e,
});
const storedSessionMeta = meta({
  feature: Feature.login,
  capability: Capability.userAccess,
  severity: Severity.high,
  layer: Layer.e2e,
});
const otpLoginMeta = meta({
  feature: Feature.otpLogin,
  capability: Capability.userAccess,
  severity: Severity.high,
  layer: Layer.e2e,
});
const sessionIsolationMeta = meta({
  feature: Feature.login,
  capability: Capability.userAccess,
  severity: Severity.high,
  layer: Layer.e2e,
});
const basicAuthMeta = meta({
  feature: Feature.basicAuth,
  capability: Capability.userAccess,
  severity: Severity.high,
  layer: Layer.e2e,
});

const VALID_USERNAME = 'practice';
const VALID_PASSWORD = 'SuperSecretPassword!';

test.describe('Login', { annotation: loginMeta }, () => {
  test('logs in with valid credentials and reaches the secure area', { tag: ['@smoke', '@T0a7cb8f6'] }, async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await expect(page).toHaveURL('/secure');
    await expect(page.getByRole('main')).toContainText('You logged into a secure area!');
  });

  test('shows an error for an invalid password', { tag: '@T25cc9fb5', annotation: meta({ severity: Severity.high }) }, async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.login(VALID_USERNAME, 'WrongPassword!');
    // The on-page docs claim "Invalid password." but the real alert text differs.
    await expect(loginPage.alert).toContainText('Your password is invalid!');
  });

  test('redirects unauthenticated visitors from the secure area to login', { tag: '@T91409ce1' }, async ({ page }) => {
    await page.goto('/secure');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('alert')).toContainText('You must login to view the secure area!');
  });
});

test.describe('Authenticated via stored session', { annotation: storedSessionMeta }, () => {
  // Loaded from the auth setup project's storageState file instead of logging in through the UI.
  test.use({ storageState: PRACTICE_USER_STORAGE_STATE_PATH });

  test('starts already logged in on the secure area', { tag: '@T193d3ac7' }, async ({ page }) => {
    await page.goto('/secure');
    await expect(page).toHaveURL('/secure');
    await expect(page.getByRole('main')).toContainText('Hi, practice!');
    // Never click Logout here: the session is a server-side express-session shared by
    // every test that reuses this stored cookie, so logging out would invalidate it for them.
    await expect(page.getByRole('link', { name: 'Logout' })).toBeVisible();
  });
});

test.describe('OTP login', { annotation: otpLoginMeta }, () => {
  test('logs in with the documented email and OTP code', { tag: '@T43104b77' }, async ({ page }) => {
    await page.goto('/otp-login');
    await page.getByRole('textbox', { name: 'Your Email Address' }).fill('practice@expandtesting.com');
    await page.getByRole('button', { name: 'Send OTP Code' }).click();
    await expect(page.getByRole('heading', { name: 'OTP Verification' })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Enter OTP code' }).fill('214365');
    await page.getByRole('button', { name: 'Verify OTP Code' }).click();
    await expect(page).toHaveURL('/secure');
  });

  test('shows an error for an incorrect OTP code', { tag: '@T2d7bad07' }, async ({ page }) => {
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

test.describe('Session isolation between browser contexts', { annotation: sessionIsolationMeta }, () => {
  // Distinct from "Authenticated via stored session" above: this builds two contexts with
  // different auth state side by side in one test, and loads storageState from a file path
  // (rather than an inline object) to prove a context without it is genuinely logged out.
  test('a saved session stays signed in while a new browser session stays signed out', { tag: '@T193d3ac7' }, async ({
    browser,
    baseURL,
  }) => {
    // Option plumbing, not a branch in the scenario: exactOptionalPropertyTypes forbids `baseURL: undefined`.
    // oxlint-disable-next-line playwright/no-conditional-in-test
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

test.describe('HTTP Basic auth with valid credentials', { annotation: basicAuthMeta }, () => {
  test.use({ httpCredentials: { username: 'admin', password: 'admin' } });

  test('returns 200 and the success message', { tag: '@T83b73f48' }, async ({ page }) => {
    const response = await page.goto('/basic-auth');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText('Congratulations! You must have the proper credentials.');
  });
});

test.describe('HTTP Basic auth without credentials', { annotation: basicAuthMeta }, () => {
  test('returns 401', { tag: '@T01194efc' }, async ({ page }) => {
    const response = await page.goto('/basic-auth');
    expect(response?.status()).toBe(401);
  });
});

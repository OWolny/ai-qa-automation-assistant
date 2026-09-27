import { test as setup, expect } from '../e2e/fixtures';
import { PRACTICE_USER_STORAGE_STATE_PATH } from '../support/auth-state';

// The publicly documented demo user shown on /login itself.
const USERNAME = 'practice';
const PASSWORD = 'SuperSecretPassword!';

setup('authenticate as practice user', async ({ page, loginPage }) => {
  await loginPage.goto();
  await loginPage.login(USERNAME, PASSWORD);
  await expect(page).toHaveURL(/\/secure$/);

  await page.context().storageState({ path: PRACTICE_USER_STORAGE_STATE_PATH });
});

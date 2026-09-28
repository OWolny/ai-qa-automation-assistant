import { test, expect } from '../e2e/fixtures';

// Starting point for the Playwright Test Agents: it runs only in the opt-in `agent-seed` project
// (PW_AGENT_SEED=1) and pauses at the end so the agents drive the page from here. It uses the e2e
// fixture so the agents see the app without ad noise, exactly like the real tests do.
test('seed', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

import { test, expect } from './fixtures';

test.describe('Dynamic Loading', () => {
  for (const example of [1, 2] as const) {
    test(`clicking Start eventually reveals "Hello World!" (example ${example})`, async ({ page }) => {
      await page.clock.install();
      await page.goto(`/dynamic-loading/${example}`);
      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.locator('#loading')).toBeVisible();

      // The page's setTimeout is 5000ms; advance virtual time past it instead of waiting in real time.
      await page.clock.runFor(6000);

      await expect(page.getByText('Hello World!')).toBeVisible();
      await expect(page.locator('#loading')).toBeHidden();
    });
  }
});

test.describe('Dynamic Controls', () => {
  test('enabling the input makes it editable and flips the button to Disable', async ({ page }) => {
    await page.goto('/dynamic-controls');
    const input = page.getByRole('textbox');
    await expect(input).toBeDisabled();

    await page.getByRole('button', { name: 'Enable', exact: true }).click();

    await expect(input).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
  });

  test('removing the checkbox shows the gone message and an Add button', async ({ page }) => {
    await page.goto('/dynamic-controls');
    await expect(page.getByRole('checkbox')).toBeVisible();

    await page.getByRole('button', { name: 'Remove', exact: true }).click();

    await expect(page.getByText("It's gone!")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});

test.describe('Add/Remove Elements', () => {
  test('adding elements and deleting one updates the Delete button count', async ({ page }) => {
    await page.goto('/add-remove-elements');
    const addButton = page.getByRole('button', { name: 'Add Element', exact: true });
    const deleteButtons = page.getByRole('button', { name: 'Delete', exact: true });

    await addButton.click();
    await addButton.click();
    await addButton.click();
    await expect(deleteButtons).toHaveCount(3);

    await deleteButtons.first().click();
    await expect(deleteButtons).toHaveCount(2);
  });
});

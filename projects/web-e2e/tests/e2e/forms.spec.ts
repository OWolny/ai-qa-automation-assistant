import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const formValidationMeta = meta({
  feature: Feature.formValidation,
  capability: Capability.dataEntry,
  severity: Severity.high,
  layer: Layer.ui,
});
const inputsMeta = meta({
  feature: Feature.formControls,
  capability: Capability.dataEntry,
  severity: Severity.medium,
  layer: Layer.ui,
});

test.describe('Form validation', { annotation: formValidationMeta }, () => {
  test('shows validation feedback when required fields are empty', async ({ page }) => {
    await page.goto('/form-validation');
    await page.getByRole('button', { name: 'Register' }).click();

    // Contact Name ships with a default value ("dodo"), so its own message never appears here;
    // the duplicate id="validationCustom05" on Contact number/PickUp Date also rules out getByLabel.
    // Soft so one missing message doesn't hide the status of the other two.
    await expect.soft(page.getByText('Please provide your Contact number.')).toBeVisible();
    await expect.soft(page.getByText('Please provide valid Date.')).toBeVisible();
    await expect.soft(page.getByText('Please select the Paymeny Method.')).toBeVisible();
  });

  test(
    'navigates to the confirmation page on a valid submission',
    { tag: '@smoke', annotation: meta({ severity: Severity.critical, layer: Layer.e2e }) },
    async ({ page }) => {
      await page.goto('/form-validation');
      await page.locator('input[name="ContactName"]').fill('Jane Tester');
      await page.locator('input[name="contactnumber"]').fill('012-3456789');
      await page.locator('input[name="pickupdate"]').fill('2027-01-15');
      await page.getByRole('combobox', { name: 'Payment Method' }).selectOption('cash on delivery');
      await page.getByRole('button', { name: 'Register' }).click();

      await expect(page).toHaveURL('/form-confirmation');
      await expect(page.getByRole('alert')).toContainText('Thank you for validating your ticket');
    },
  );
});

test.describe('Inputs', { annotation: inputsMeta }, () => {
  test('displays and clears the values typed into every input', async ({ page }) => {
    await page.goto('/inputs');
    const number = page.getByRole('spinbutton', { name: 'Input: Number' });
    const text = page.getByRole('textbox', { name: 'Input: Text' });
    const password = page.getByRole('textbox', { name: 'Input: Password' });
    const date = page.getByRole('textbox', { name: 'Input: Date' });

    await number.fill('123');
    await text.fill('hello world');
    await password.fill('secretpw');
    await date.fill('2027-05-20');
    await page.getByRole('button', { name: 'Display Inputs' }).click();

    await expect(page.locator('#output-number')).toHaveText('123');
    await expect(page.locator('#output-text')).toHaveText('hello world');
    await expect(page.locator('#output-password')).toHaveText('secretpw');
    await expect(page.locator('#output-date')).toHaveText('2027-05-20');

    await page.getByRole('button', { name: 'Clear Inputs' }).click();
    await expect(number).toHaveValue('');
    await expect(text).toHaveValue('');
    await expect(password).toHaveValue('');
    await expect(date).toHaveValue('');
  });
});

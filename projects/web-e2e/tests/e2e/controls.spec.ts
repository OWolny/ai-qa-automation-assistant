import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const controlsHighMeta = meta({
  feature: Feature.formControls,
  capability: Capability.dataEntry,
  severity: Severity.high,
  layer: Layer.ui,
});
const controlsMediumMeta = meta({
  feature: Feature.formControls,
  capability: Capability.dataEntry,
  severity: Severity.medium,
  layer: Layer.ui,
});

test.describe('Dropdown', { annotation: controlsHighMeta }, () => {
  test('selects an option from the plain select', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dropdown');
    const dropdown = page.locator('#dropdown');
    await dropdown.selectOption({ label: 'Option 1' });
    await expect(dropdown).toHaveValue('1');
  });

  test('changes the elements per page selection', { annotation: controlsMediumMeta }, async ({ page }) => {
    await page.goto('/dropdown');
    const perPage = page.getByLabel('Elements per Page:');
    await expect(perPage).toHaveValue('10');
    await perPage.selectOption('20');
    await expect(perPage).toHaveValue('20');
  });
});

test.describe('Checkboxes', { annotation: controlsHighMeta }, () => {
  test('toggles both checkboxes', async ({ page }) => {
    await page.goto('/checkboxes');
    const checkbox1 = page.getByRole('checkbox', { name: 'Checkbox 1' });
    const checkbox2 = page.getByRole('checkbox', { name: 'Checkbox 2' });

    await expect(checkbox1).not.toBeChecked();
    await expect(checkbox2).toBeChecked();

    await checkbox1.check();
    await checkbox2.uncheck();

    await expect(checkbox1).toBeChecked();
    await expect(checkbox2).not.toBeChecked();
  });
});

test.describe('Radio buttons', { annotation: controlsHighMeta }, () => {
  test('checking Red unchecks the default Blue selection', async ({ page }) => {
    await page.goto('/radio-buttons');
    const blue = page.getByRole('radio', { name: 'Blue' });
    const red = page.getByRole('radio', { name: 'Red' });

    await expect(blue).toBeChecked();
    await red.check();

    await expect(red).toBeChecked();
    await expect(blue).not.toBeChecked();
  });

  test('changing the color group does not affect the sport group', { annotation: controlsMediumMeta }, async ({ page }) => {
    await page.goto('/radio-buttons');
    const tennis = page.getByRole('radio', { name: 'Tennis' });
    await expect(tennis).toBeChecked();

    await page.getByRole('radio', { name: 'Yellow' }).check();

    await expect(tennis).toBeChecked();
  });

  test('the green radio is disabled and unchecked', { annotation: meta({ severity: Severity.low }) }, async ({ page }) => {
    await page.goto('/radio-buttons');
    const green = page.locator('input[value="green"]');
    await expect(green).toBeDisabled();
    await expect(green).not.toBeChecked();
  });
});

test.describe('Horizontal slider', { annotation: controlsMediumMeta }, () => {
  test('adjusts the value with keyboard navigation', async ({ page }) => {
    await page.goto('/horizontal-slider');
    const slider = page.getByRole('slider');
    const range = page.locator('#range');

    await slider.press('Home');
    await expect(slider).toHaveValue('0');
    await expect(range).toHaveText('0');

    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('0.5');
    await expect(range).toHaveText('0.5');

    for (let i = 0; i < 4; i++) {
      await slider.press('ArrowRight');
    }
    await expect(slider).toHaveValue('2.5');
    await expect(range).toHaveText('2.5');

    await slider.press('End');
    await expect(slider).toHaveValue('5');
    await expect(range).toHaveText('5');
  });
});

test.describe('Autocomplete', { annotation: controlsMediumMeta }, () => {
  test('selects a suggestion and submits the country', async ({ page }) => {
    await page.goto('/autocomplete');
    const input = page.locator('#country');
    await input.fill('Uni');

    const suggestions = page.locator('#countryautocomplete-list > div');
    await expect(suggestions).toHaveCount(3);
    await suggestions.filter({ hasText: 'United Kingdom' }).click();

    await expect(input).toHaveValue('United Kingdom');
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.locator('#result')).toHaveText('You selected: United Kingdom');
  });
});

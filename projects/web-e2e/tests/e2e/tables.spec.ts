import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const dynamicTableMeta = meta({
  feature: Feature.dataTables,
  capability: Capability.dataPresentation,
  severity: Severity.high,
  layer: Layer.ui,
});
const paginationTableMeta = meta({
  feature: Feature.dataTables,
  capability: Capability.dataPresentation,
  severity: Severity.medium,
  layer: Layer.ui,
});

test.describe('Dynamic Table', { annotation: dynamicTableMeta }, () => {
  test(
    'the Chrome CPU value in the table matches the summary banner',
    { tag: ['@smoke', '@T0e0edb58'] },
    async ({ page }) => {
      await page.goto('/dynamic-table');
      const table = page.getByRole('table');

      const headers = await table.getByRole('columnheader').allTextContents();
      const cpuIndex = headers.findIndex((h) => h.trim() === 'CPU');
      expect(cpuIndex).toBeGreaterThanOrEqual(0);

      const chromeRow = table
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: 'Chrome', exact: true }) });
      const chromeCpu = (await chromeRow.getByRole('cell').nth(cpuIndex).textContent())?.trim();

      await expect(page.locator('#chrome-cpu')).toHaveText(`Chrome CPU: ${chromeCpu}`);
    },
  );
});

test.describe('Dynamic Pagination Table', { annotation: paginationTableMeta }, () => {
  test('changing the page size updates the row count and info text', { tag: '@T2ac8183d' }, async ({ page }) => {
    await page.goto('/dynamic-pagination-table');
    const body = page.getByRole('table').getByRole('rowgroup').nth(1);

    await expect(body.getByRole('row')).toHaveCount(3);

    await page.getByRole('combobox', { name: /show entries/i }).selectOption('10');

    await expect(body.getByRole('row')).toHaveCount(10);
    await expect(page.getByText('Showing 1 to 10 of 10 entries')).toBeVisible();
  });

  test('Next page updates the info text', async ({ page }) => {
    await page.goto('/dynamic-pagination-table');
    await page.getByRole('combobox', { name: /show entries/i }).selectOption('5');
    await expect(page.getByText('Showing 1 to 5 of 10 entries')).toBeVisible();

    await page.getByRole('link', { name: 'Next' }).click();

    await expect(page.getByText('Showing 6 to 10 of 10 entries')).toBeVisible();
  });

  test(
    'searching filters the visible rows',
    { tag: '@T8d843c93', annotation: meta({ severity: Severity.high }) },
    async ({ page }) => {
      await page.goto('/dynamic-pagination-table');
      const body = page.getByRole('table').getByRole('rowgroup').nth(1);

      await page.getByRole('searchbox').fill('Emma');

      await expect(body.getByRole('row')).toHaveCount(1);
      await expect(body.getByRole('row').first()).toContainText('Emma Brown');
      await expect(page.getByText('Showing 1 to 1 of 1 entries (filtered from 10 total entries)')).toBeVisible();
    },
  );

  test('clicking the sorted Student Name header reverses the order', { tag: '@Te5de219c' }, async ({ page }) => {
    await page.goto('/dynamic-pagination-table');
    const table = page.getByRole('table');
    await page.getByRole('combobox', { name: /show entries/i }).selectOption('10');

    const headers = await table.getByRole('columnheader').allTextContents();
    const nameIndex = headers.findIndex((h) => h.trim() === 'Student Name');
    expect(nameIndex).toBeGreaterThanOrEqual(0);

    const rows = table.getByRole('rowgroup').nth(1).getByRole('row');
    const header = table.getByRole('columnheader', { name: 'Student Name' });

    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    const rowCount = await rows.count();
    const names: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const text = await rows.nth(i).getByRole('cell').nth(nameIndex).textContent();
      names.push(text?.trim() ?? '');
    }

    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  });
});

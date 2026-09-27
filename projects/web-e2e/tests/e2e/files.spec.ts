import fs from 'node:fs/promises';
import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const fileUploadMeta = meta({
  feature: Feature.fileUpload,
  capability: Capability.fileOperations,
  severity: Severity.critical,
  layer: Layer.e2e,
});
const fileDownloadMeta = meta({
  feature: Feature.fileDownload,
  capability: Capability.fileOperations,
  severity: Severity.critical,
  layer: Layer.e2e,
});

test.describe('File upload', { annotation: fileUploadMeta }, () => {
  test('a user can upload a small file and see it confirmed', async ({ page }) => {
    await page.goto('/upload');
    await page.getByTestId('file-input').setInputFiles({
      name: 'playwright-showcase.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Playwright showcase upload'),
    });

    await page.getByTestId('file-submit').click();

    await expect(page.getByRole('heading', { name: 'File Uploaded!' })).toBeVisible();
    await expect(page.locator('#uploaded-files')).toContainText('playwright-showcase.txt');
  });

  test(
    'a file over 500KB is rejected before submitting',
    { annotation: meta({ severity: Severity.high, layer: Layer.ui }) },
    async ({ page }) => {
      await page.goto('/upload');
      await page.getByTestId('file-input').setInputFiles({
        name: 'too-big.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(600 * 1024, 'a'),
      });

      await expect(page.locator('#flash')).toHaveText(
        'File too large, please select a file less than 500KB'
      );
      await expect(page).toHaveURL('/upload');
    },
  );
});

test.describe('Downloads', { annotation: fileDownloadMeta }, () => {
  test('a user can download an available file with its expected content', { tag: '@smoke' }, async ({ page }, testInfo) => {
    await page.goto('/download');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'some-file.txt', exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('some-file.txt');

    const savePath = testInfo.outputPath('some-file.txt');
    await download.saveAs(savePath);
    const content = await fs.readFile(savePath, 'utf-8');
    expect(content).toBe('Message: Welcome to the Practice Web App');
  });
});

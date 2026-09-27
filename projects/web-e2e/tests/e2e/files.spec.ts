import fs from 'node:fs/promises';
import { test, expect } from './fixtures';

test.describe('File upload', () => {
  test('uploading a small file shows the stored filename', async ({ page }) => {
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

  test('a file over 500KB is rejected before submitting', async ({ page }) => {
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
  });
});

test.describe('Downloads', () => {
  test('downloads some-file.txt with its expected content', async ({ page }, testInfo) => {
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

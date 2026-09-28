import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const dialogsWindowsMeta = meta({
  feature: Feature.dialogsWindows,
  capability: Capability.pageInteractions,
  severity: Severity.medium,
  layer: Layer.ui,
});

test.describe('JS dialogs', { annotation: dialogsWindowsMeta }, () => {
  test('accepting the alert shows OK', { tag: '@T30eea2a0' }, async ({ page }) => {
    await page.goto('/js-dialogs');

    let dialogType = '';
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogType = dialog.type();
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await page.getByRole('button', { name: 'Js Alert' }).click();

    expect(dialogType).toBe('alert');
    expect(dialogMessage).toBe('I am a Js Alert');
    await expect(page.locator('#dialog-response')).toHaveText('OK');
  });

  test('accepting the confirm shows Ok', { tag: '@T333bff45' }, async ({ page }) => {
    await page.goto('/js-dialogs');

    let dialogType = '';
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogType = dialog.type();
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await page.getByRole('button', { name: 'Js Confirm' }).click();

    expect(dialogType).toBe('confirm');
    expect(dialogMessage).toBe('I am a Js Confirm');
    await expect(page.locator('#dialog-response')).toHaveText('Ok');
  });

  test('dismissing the confirm shows Cancel', { tag: '@T333bff45' }, async ({ page }) => {
    await page.goto('/js-dialogs');

    page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });

    await page.getByRole('button', { name: 'Js Confirm' }).click();

    await expect(page.locator('#dialog-response')).toHaveText('Cancel');
  });

  test('accepting the prompt with text fills the response', { tag: '@Td8fc47cb' }, async ({ page }) => {
    await page.goto('/js-dialogs');

    let dialogType = '';
    page.once('dialog', (dialog) => {
      dialogType = dialog.type();
      void dialog.accept('Hello Playwright');
    });

    await page.getByRole('button', { name: 'Js Prompt' }).click();

    expect(dialogType).toBe('prompt');
    await expect(page.locator('#dialog-response')).toHaveText('Hello Playwright');
  });

  test('dismissing the prompt clears the response', { tag: '@Td8fc47cb' }, async ({ page }) => {
    await page.goto('/js-dialogs');

    page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });

    await page.getByRole('button', { name: 'Js Prompt' }).click();

    await expect(page.locator('#dialog-response')).toHaveText('');
  });
});

test.describe('Windows', { annotation: dialogsWindowsMeta }, () => {
  test('clicking Click Here opens a new window with the example page', { tag: '@Tf248022d' }, async ({ page }) => {
    await page.goto('/windows');

    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Click Here' }).click();
    const popup = await popupPromise;

    await expect(popup).toHaveURL(/\/windows\/new$/);
    await expect(
      popup.getByRole('heading', {
        name: 'Example of a new window page for Automation Testing Practice',
      })
    ).toBeVisible();
  });
});

test.describe('Entry ad modal', { annotation: dialogsWindowsMeta }, () => {
  test('is visible on first load and hides after closing', async ({ page }) => {
    await page.goto('/entry-ad');
    const modal = page.locator('#exampleModal');

    await expect(modal).toBeVisible();
    await page.locator('#close-modal-btn').click();
    await expect(modal).toBeHidden();
  });
});

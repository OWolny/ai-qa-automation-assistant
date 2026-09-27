import { test, expect } from './fixtures';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const mouseKeyboardLowMeta = meta({
  feature: Feature.mouseKeyboard,
  capability: Capability.pageInteractions,
  severity: Severity.low,
  layer: Layer.ui,
});
const dragAndDropMeta = meta({
  feature: Feature.mouseKeyboard,
  capability: Capability.pageInteractions,
  severity: Severity.medium,
  layer: Layer.ui,
});

test.describe('Hovers', { annotation: mouseKeyboardLowMeta }, () => {
  for (const n of [1, 2, 3] as const) {
    test(`hovering user ${n} reveals the caption and profile link`, async ({ page }) => {
      await page.goto('/hovers');
      const card = page.getByTestId(`user-${n}`);
      await card.hover();

      await expect(card.getByText(`name: user${n}`)).toBeVisible();
      const profileLink = card.getByRole('link', { name: 'View profile' });
      await expect(profileLink).toBeVisible();
      await expect(profileLink).toHaveAttribute('href', `/users/${n}`);
    });
  }
});

test.describe('Drag and drop', { annotation: dragAndDropMeta }, () => {
  test('dragging column A onto column B swaps their headers', async ({ page }) => {
    await page.goto('/drag-and-drop');
    const columnA = page.locator('#column-a');
    const columnB = page.locator('#column-b');

    await expect(columnA.locator('header')).toHaveText('A');
    await expect(columnB.locator('header')).toHaveText('B');

    await columnA.dragTo(columnB);

    await expect(columnA.locator('header')).toHaveText('B');
    await expect(columnB.locator('header')).toHaveText('A');
  });
});

test.describe('Key presses', { annotation: mouseKeyboardLowMeta }, () => {
  // Enter is excluded: the single-field form implicitly submits and reloads the page
  // (the page's handler never calls preventDefault), so the result is never shown.
  const cases: ReadonlyArray<{ key: string; expected: string }> = [
    { key: 'a', expected: 'A' },
    { key: 'Escape', expected: 'ESCAPE' },
    { key: 'ArrowLeft', expected: 'LEFT' },
  ];

  for (const { key, expected } of cases) {
    test(`pressing ${key} reports "You entered: ${expected}"`, async ({ page }) => {
      await page.goto('/key-presses');
      const input = page.getByRole('textbox');
      await input.press(key);
      await expect(page.locator('#result')).toHaveText(`You entered: ${expected}`);
    });
  }
});

test.describe('Context menu', { annotation: mouseKeyboardLowMeta }, () => {
  test('right-clicking the hot spot shows a native alert', async ({ page }) => {
    await page.goto('/context-menu');

    let dialogType = '';
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogType = dialog.type();
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await page.locator('#hot-spot').click({ button: 'right' });

    expect(dialogType).toBe('alert');
    expect(dialogMessage).toBe('You selected a context menu');
  });
});

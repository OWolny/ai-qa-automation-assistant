import type { Locator, Page } from '@playwright/test';

export class NotesHomePage {
  readonly page: Page;
  readonly noNotesMessage: Locator;
  readonly noteCardTitles: Locator;
  readonly loader: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.noNotesMessage = page.getByTestId('no-notes-message');
    this.noteCardTitles = page.getByTestId('note-card-title');
    this.loader = page.getByTestId('loader');
    this.searchInput = page.getByTestId('search-input');
  }

  async waitForLoaded(): Promise<void> {
    await this.page.waitForURL(/\/notes\/app$/);
  }
}

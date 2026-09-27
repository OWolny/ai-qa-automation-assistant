import type { Locator, Page } from '@playwright/test';

/** The Notes app's /notes/app/login form. Labels collide on this app, so it is keyed by data-testid. */
export class NotesLoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly alertMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('login-email');
    this.passwordInput = page.getByTestId('login-password');
    this.submitButton = page.getByTestId('login-submit');
    this.alertMessage = page.getByTestId('alert-message');
  }

  async goto(): Promise<void> {
    await this.page.goto('/notes/app/login');
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}

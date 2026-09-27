import { test as base, expect, type BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/login-page';
import { NotesLoginPage } from '../pages/notes-login-page';
import { NotesHomePage } from '../pages/notes-home-page';

// The target serves Google ads that inject DOM nodes, iframes and layout shifts which
// collide with locators and interactions. Blocking them keeps the tests about the app.
const THIRD_PARTY_HOSTS =
  /(^|\.)(googlesyndication\.com|doubleclick\.net|googleadservices\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com)$/;

export async function blockThirdPartyNoise(context: BrowserContext): Promise<void> {
  await context.route((url) => THIRD_PARTY_HOSTS.test(url.hostname), (route) => route.abort());
}

type PageObjectFixtures = {
  loginPage: LoginPage;
  notesLoginPage: NotesLoginPage;
  notesHomePage: NotesHomePage;
};

export const test = base.extend<PageObjectFixtures>({
  context: async ({ context }, use) => {
    await blockThirdPartyNoise(context);
    await use(context);
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  notesLoginPage: async ({ page }, use) => {
    await use(new NotesLoginPage(page));
  },
  notesHomePage: async ({ page }, use) => {
    await use(new NotesHomePage(page));
  },
});

export { expect };

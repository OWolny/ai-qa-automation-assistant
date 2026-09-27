import { test as base, expect } from './fixtures';
import {
  registerUser,
  loginUser,
  deleteAccount,
  createNote,
  type RegisteredUser,
  type Note,
  type NotesApiEnvelope,
} from '../support/notes-api';
import { meta, Feature, Capability, Severity, Layer } from '../support/report-metadata';

const notesAppMeta = meta({
  feature: Feature.notes,
  capability: Capability.noteManagement,
  severity: Severity.critical,
  layer: Layer.e2e,
});
const notesAccountMeta = meta({ feature: Feature.notesAccount, capability: Capability.userAccess });
const notesAccountHighMeta = meta({
  feature: Feature.notesAccount,
  capability: Capability.userAccess,
  severity: Severity.high,
});

type NotesAppFixtures = {
  apiUser: RegisteredUser & { token: string };
};

const test = base.extend<NotesAppFixtures>({
  apiUser: async ({ request }, use) => {
    const user = await registerUser(request);
    const login = await loginUser(request, user.email, user.password);
    await use({ ...user, token: login.token });
    await deleteAccount(request, login.token);
  },
});

test.describe('Notes App', { annotation: notesAppMeta }, () => {
  test(
    'an API-registered user can log in through the UI and sees the empty state',
    { tag: '@smoke', annotation: notesAccountMeta },
    async ({ notesLoginPage, notesHomePage, apiUser }) => {
      await notesLoginPage.goto();
      await notesLoginPage.login(apiUser.email, apiUser.password);

      await notesHomePage.waitForLoaded();
      await expect(notesHomePage.noNotesMessage).toBeVisible();
    },
  );

  test('a note created via the API is visible in the UI notes list', async ({
    request,
    notesLoginPage,
    notesHomePage,
    apiUser,
  }) => {
    await test.step('create a note via the API', async () => {
      await createNote(request, apiUser.token, {
        title: 'API created note',
        description: 'Visible from the UI',
        category: 'Personal',
      });
    });

    await test.step('log in through the UI', async () => {
      await notesLoginPage.goto();
      await notesLoginPage.login(apiUser.email, apiUser.password);
      await notesHomePage.waitForLoaded();
    });

    await expect(notesHomePage.noteCardTitles).toHaveText('API created note');
  });

  test(
    'a wrong password shows the incorrect-credentials alert',
    { annotation: notesAccountHighMeta },
    async ({ notesLoginPage, apiUser }) => {
      await notesLoginPage.goto();
      await notesLoginPage.login(apiUser.email, 'WrongPassword123!');

      await expect(notesLoginPage.alertMessage).toHaveText('Incorrect email address or password');
    },
  );

  test(
    'the notes list renders the titles returned by the API',
    { annotation: meta({ severity: Severity.medium }) },
    async ({
      page,
      request,
      notesLoginPage,
      notesHomePage,
      apiUser,
    }) => {
      await test.step('create a note via the API', async () => {
        await createNote(request, apiUser.token, {
          title: 'Original title from the API',
          description: 'Will be rewritten by the route handler',
          category: 'Personal',
        });
      });

      await test.step('intercept the notes list and rewrite the title in the real response', async () => {
        await page.route(
          (url) => url.pathname === '/notes/api/notes',
          async (route) => {
            if (route.request().method() !== 'GET') {
              await route.continue();
              return;
            }
            // Firefox's fetch stack does not decode the server's "content-encoding: zstd";
            // requesting a plain encoding avoids receiving an undecoded body.
            const response = await route.fetch({
              headers: { ...route.request().headers(), 'accept-encoding': 'gzip, deflate, br' },
            });
            const body = (await response.json()) as NotesApiEnvelope<Note[]>;
            const [firstNote] = body.data ?? [];
            if (firstNote) {
              firstNote.title = 'Modified by route.fulfill';
            }
            await route.fulfill({ response, json: body });
          },
        );
      });

      await test.step('log in through the UI', async () => {
        await notesLoginPage.goto();
        await notesLoginPage.login(apiUser.email, apiUser.password);
        await notesHomePage.waitForLoaded();
      });

      await expect(notesHomePage.noteCardTitles).toHaveText('Modified by route.fulfill');
    },
  );

  test(
    'when the notes list request fails, the dashboard does not render',
    { annotation: meta({ severity: Severity.medium }) },
    async ({
      page,
      notesLoginPage,
      notesHomePage,
      apiUser,
    }) => {
      await page.route(
        (url) => url.pathname === '/notes/api/notes',
        (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()),
      );

      await notesLoginPage.goto();
      const failedRequest = page.waitForEvent(
        'requestfailed',
        (request) => new URL(request.url()).pathname === '/notes/api/notes',
      );
      await notesLoginPage.login(apiUser.email, apiUser.password);
      await failedRequest;

      // The SPA has no error state for this failure: the spinner stays and the dashboard never renders.
      await expect(notesHomePage.loader).toBeVisible();
      await expect(notesHomePage.searchInput).toBeHidden();
    },
  );
});

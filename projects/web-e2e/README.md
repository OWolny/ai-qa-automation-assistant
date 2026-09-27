# web-e2e

Playwright + TypeScript tests for the public QA practice application **[practice.expandtesting.com](https://practice.expandtesting.com/)**.

The suite is a showcase of Playwright capabilities rather than a high test count. Each spec covers a distinct capability: browser UI interaction, browser-context features, network control, and API testing with Playwright's built-in `APIRequestContext`.

## Layout

```text
web-e2e/
├── playwright.config.ts   # base URL, projects, reporters, artifacts
├── tsconfig.json          # strict TypeScript, type-check only
├── .env.example           # optional environment variables
└── tests/
    ├── api/               # API tests (no browser)
    ├── setup/             # auth setup project: logs in once and saves storageState
    ├── e2e/               # browser tests; fixtures.ts provides the shared `test` and page-object fixtures
    │                      # *.mobile.spec.ts run only in the mobile project
    ├── pages/             # page objects for pages used by several tests
    └── support/           # Notes API helper, stored auth-state path
```

## Setup

Requires Node.js 20 or newer.

```bash
npm ci
npm run install:browsers    # Chromium and Firefox
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run everything: API, auth setup, Chromium, Firefox, mobile Chromium |
| `npm run test:api` | API tests only |
| `npm run test:e2e` | Browser tests in Chromium and Firefox |
| `npm run test:chromium` | Browser tests in Chromium only (fastest feedback) |
| `npm run test:mobile` | Mobile emulation tests (Pixel 7) |
| `npm run test:smoke` | Tests tagged `@smoke` across all projects |
| `npm run test:headed` | Run with visible browsers |
| `npm run test:ui` | Playwright UI mode |
| `npm run test:debug` | Run with the Playwright inspector |
| `npm run list` | List tests without running them |
| `npm run typecheck` | Type-check with `tsc` |
| `npm run report` | Open the latest HTML report |

Filters combine with Playwright CLI options, for example `npx playwright test tests/e2e/network.spec.ts --project=firefox` or `npx playwright test --grep @api`.

### Projects

| Project | Runs | Notes |
|---------|------|-------|
| `api` | `tests/api` | no browser |
| `setup` | `tests/setup` | logs in the site's demo user once; saves `playwright/.auth/practice-user.json` (git-ignored) |
| `chromium`, `firefox` (+ `webkit`) | `tests/e2e` except `*.mobile.spec.ts` | depend on `setup` |
| `mobile-chromium` | `*.mobile.spec.ts` | Pixel 7 emulation (viewport, touch, mobile UA) |

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `BASE_URL` | `https://practice.expandtesting.com` | Target application |
| `PW_INCLUDE_WEBKIT` | unset | `1` adds the `webkit` project |

WebKit is opt-in because it needs host libraries that are missing on some machines (notably some Windows setups). To use it, run `npx playwright install webkit` first, then set `PW_INCLUDE_WEBKIT=1`.

The only credentials used are the public demo values published by the practice site itself. Tests that need an account create a throwaway user through the Notes API and delete it afterwards.

## Design decisions

- **Ad blocking fixture.** The target serves Google ads that inject iframes and DOM nodes and shift the layout. `tests/e2e/fixtures.ts` blocks those hosts for every browser context, so tests interact only with the application and no fixed waits are needed.
- **Proportional page objects.** Page objects exist only for pages that several tests drive (`/login` and the Notes app) and are injected through fixtures (`loginPage`, `notesLoginPage`, `notesHomePage`). Pages used once stay as direct, readable tests. Assertions live in tests, not in page objects.
- **Authenticate once.** The `setup` project logs in and stores `storageState`; tests that only need an authenticated session load it instead of repeating the UI login. They never log out, because the site's session is server-side and shared by every context using that state.
- **Deterministic time and data.** Timers are fast-forwarded with `page.clock`, randomness is stubbed with `addInitScript`, and slow endpoints are fulfilled with `page.route`. Randomly shuffled tables are read by column header and row key, never by position.
- **Independent tests.** Apart from the read-only stored login session, tests share no state and run fully in parallel. Browser state (sessions, cookies, permissions) is set per test through context options.

## Coverage

| Area | Spec | Playwright capabilities |
|------|------|-------------------------|
| Authentication | `e2e/auth.spec.ts`, `setup/auth.setup.ts` | page objects via fixtures, setup project + stored `storageState`, multiple isolated contexts, OTP flow, protected-route redirect, HTTP Basic auth via `httpCredentials` |
| Forms | `e2e/forms.spec.ts` | client-side validation with `expect.soft`, submission, input types |
| Browser context | `e2e/browser-context.spec.ts` | geolocation and permissions, cookies, extra HTTP headers |
| Form controls | `e2e/controls.spec.ts` | `selectOption`, checkboxes, radio groups, keyboard-driven slider, autocomplete |
| Mouse and keyboard | `e2e/mouse-keyboard.spec.ts` | hover, drag and drop, key presses, right-click |
| Dialogs and windows | `e2e/dialogs-windows.spec.ts` | alert/confirm/prompt handling, popup windows, modals |
| Frames and Shadow DOM | `e2e/frames-shadow.spec.ts` | frame locators, open shadow roots |
| Files | `e2e/files.spec.ts` | upload from an in-memory buffer, client-side size limit, downloads |
| Dynamic content | `e2e/dynamic.spec.ts` | `page.clock`, auto-waiting on async DOM changes |
| Tables | `e2e/tables.spec.ts` | header-driven cell lookup, sorting, pagination, search |
| Network and page events | `e2e/network.spec.ts` | `page.route` fulfilment, `addInitScript`, redirects, status codes, broken resources, console and page errors |
| Notes app (hybrid) | `e2e/notes-app.spec.ts` | API-seeded data verified through the UI, `route.fetch()` response modification, `route.abort()` failure behaviour, `test.step` |
| Notes REST API | `api/notes-api.spec.ts` | `APIRequestContext`, auth token lifecycle, CRUD, error contracts, `test.step` |
| Accessibility | `e2e/accessibility.spec.ts` | axe-core WCAG 2 A/AA scans (scoped, and a full-page scan excluding two triaged contrast failures), `toMatchAriaSnapshot` |
| Mobile | `e2e/responsive.mobile.spec.ts` | device emulation, collapsed navigation, `tap()` |
| Visual regression | `e2e/visual.spec.ts` | `toHaveScreenshot` on a stable component (Chromium on Linux; see CI) |

## Artifacts

Everything is written inside this directory and git-ignored:

- `playwright-report/` holds the HTML report (never opened automatically; use `npm run report`).
- `playwright/.auth/` holds the stored login session created by the `setup` project.
- `blob-report/` is written instead of the HTML report in CI mode (merged by the workflow).
- `test-results/` holds per-test output. Failed tests keep a trace, a screenshot and a video. Open a trace with `npx playwright show-trace test-results/<test>/trace.zip`.

## Continuous integration

`.github/workflows/web-e2e.yml` runs on pushes to `main` and on pull requests that touch this project:

- type-check, then the full suite in Chromium, Firefox, **WebKit** and mobile Chromium on Ubuntu, sharded across 2 machines,
- each shard uploads a blob report; a follow-up job merges them into one HTML report (`playwright-report` artifact),
- CI mode (`CI=1`) enables `forbidOnly`, 2 retries and a single worker per shard. Retries are a safety net, not a fix for flaky tests.

Visual baselines are Linux-only and are skipped on other platforms. In CI a missing or changed baseline fails the run and the actual image is uploaded in the `test-results-*` artifact. To regenerate baselines, run the workflow manually with **update_snapshots** enabled and commit the `visual-baselines-*` artifact contents into `tests/e2e/visual.spec.ts-snapshots/`.

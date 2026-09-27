# web-e2e

Playwright + TypeScript tests for the public QA practice application **[practice.expandtesting.com](https://practice.expandtesting.com/)**.

The suite is a showcase of Playwright capabilities rather than a high test count. Each spec covers a distinct capability: browser UI interaction, browser-context features, network control, and API testing with Playwright's built-in `APIRequestContext`.

## Layout

```text
web-e2e/
├── playwright.config.ts   # base URL, projects, reporters, artifacts
├── merge.config.ts        # reporters for merging CI blob reports
├── tsconfig.json          # strict TypeScript, type-check only
├── .env.example           # optional environment variables
├── reporter/              # Business QA Dashboard reporter (see below)
└── tests/
    ├── api/               # API tests (no browser)
    ├── setup/             # auth setup project: logs in once and saves storageState
    ├── e2e/               # browser tests; fixtures.ts provides the shared `test` and page-object fixtures
    │                      # *.mobile.spec.ts run only in the mobile project
    ├── pages/             # page objects for pages used by several tests
    └── support/           # Notes API helper, stored auth-state path, reporting metadata vocabulary
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
| `npm run lint` | Lint with oxlint: type-aware promise rules (missing `await`) and `eslint-plugin-playwright` rules (no sleeps, no `test.only`, web-first assertions) |
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

## Business QA Dashboard

Local runs also produce `business-report/`, a custom report for two audiences: stakeholders who need to know whether the tested business capabilities are healthy, and engineers who need to drill into a failure. The standard Playwright HTML report is organised by spec file and is still generated for step-level debugging and its embedded trace viewer. The dashboard is organised by business metadata instead:

- executive summary: overall status with the rules that triggered it, scenario counts, pass rate, critical-path pass rate, run metadata (target URL, branch, commit, versions, OS, projects),
- critical-path panel, status distribution, business capability and feature health, a feature × browser compatibility matrix,
- reliability (stable, flaky, failed after retries), duration analysis (average, median, p95, slowest scenarios, time per feature),
- failure analysis with error summary, category, and technical details (message, stack, snippet, artifacts),
- a filterable scenario explorer (status, feature, capability, severity, project, layer, tag, text).

### Generating and opening it

`npm test` (or any local `npx playwright test ...`) writes:

```text
business-report/
├── index.html    # self-contained dashboard (inline CSS/JS/SVG, no network access needed)
├── run.json      # the normalized run model the dashboard is rendered from
└── artifacts/    # copies of screenshots, traces and videos of failed attempts
```

Open `business-report/index.html` directly in a browser; no server is needed. Each run replaces the folder. Traces open offline with `npx playwright show-trace business-report/artifacts/<...>/trace.zip`.

`run.json` carries `schemaVersion`, a `runId`, run metadata, every aggregate shown in the dashboard, and one record per scenario keyed by Playwright's stable test id.

### In CI

The workflow's `merge reports` job builds the dashboard from all shards with `npx playwright merge-reports --config merge.config.ts ./all-blob-reports` and uploads it as the **`business-report`** artifact (next to `playwright-report`). Download it and open `index.html`. Because blob reports do not carry `use` options, `playwright.config.ts` also puts the base URL and each project's browser into `metadata`, which the merged report keeps.

### History and trends

Each recorded run adds a compact snapshot (`<runId>.json`: totals, rates, durations, feature pass rates and one outcome per scenario id; no errors or artifacts) to **`business-report-history/`**, keeping the latest 50. The dashboard's **Trends** section is built from those snapshots plus the current run:

- pass rate, critical pass rate, flaky rate and duration (wall clock, p95) per run, with the status and scenario count of each run,
- feature health per run,
- regression tracking: every scenario failing now is marked *new failure* (it passed the last time it ran), *ongoing* (it also failed before; the dashboard shows since which run and commit, and the last run and commit where it passed), or *new scenario* (never executed in an earlier run in the window),
- scenarios *fixed* since they last ran.

Runs where a scenario was absent or skipped are ignored for that scenario, so a partial run never looks like a regression or a fix.

Which runs are recorded:

| Where | Recorded | Not recorded |
|-------|----------|--------------|
| Local | full-suite runs: `npm test` / `npx playwright test`, optionally with output-only options such as `--workers`, `--headed`, `--reporter`, `--trace`, `--timeout` | any filter or modifier (file paths, `--grep`, `--project`, `--repeat-each`, `--retries`, `--update-snapshots`, `--last-failed`, `npm run test:smoke`, ...), and runs with fewer than 90% of the scenarios of the last recorded run (e.g. a leftover `test.only`) |
| CI | pushes to `main` with every shard's report present | pull requests and manual dispatches (they show `main`'s trends with their own run as an unrecorded last point), and runs where a shard report is missing or the history could not be looked up |

Unrecorded runs still show the trends and say why they were not recorded; when their scope differs from the previous run, the "vs previous" change is not shown. Trends only compare runs against the same base URL, interrupted runs are never recorded, and a renamed or moved test starts a new history (its Playwright id changes).

In CI the history folder travels between runs as the **`business-report-history`** artifact (kept 90 days): the merge job downloads the newest unexpired one uploaded on `main`, and a recording run uploads the updated folder. If there is none (first run, or 90 days without a push to `main`), history starts again; if the lookup or download fails, the run is simply not recorded. For merged reports, the run duration spans the earliest shard start to the latest shard end, so it includes runner start-up differences. The local and CI histories are separate. Neither needs a database or a server.

### Metadata conventions

Tags are for **selecting** tests to run; annotations are for **reporting**.

| Tag | Meaning |
|-----|---------|
| `@smoke` | Fast check of the core journeys (`npm run test:smoke`) |
| `@api` | Notes API tests (`--grep @api`) |
| `@visual` | Screenshot comparisons, Linux baselines only (used by the CI baseline update) |

Every test carries four annotations, set with `meta()` and the constants from `tests/support/report-metadata.ts`. Never type the values by hand: the dashboard groups by exact strings.

| Annotation | Meaning | Values |
|------------|---------|--------|
| `feature` | Product area under test | `Feature.*`, e.g. `Login`, `File Upload`, `Data Tables` |
| `businessCapability` | Business capability the feature serves (coarser) | `Capability.*`, e.g. `User Access`, `Note Management`, `Data Entry` |
| `severity` | Business impact if the scenario fails | `critical`, `high`, `medium`, `low` |
| `layer` | How the scenario exercises the product | `E2E` (user journey with a server round-trip), `UI` (client-side behaviour of one page), `API` (HTTP only) |

```ts
test.describe('File upload', {
  annotation: meta({ feature: Feature.fileUpload, capability: Capability.fileOperations, severity: Severity.critical, layer: Layer.e2e }),
}, () => {
  test('a user can upload a small file and see it confirmed', async ({ page }) => { /* ... */ });

  // Override only what differs; test-level values win over the describe block.
  test('a file over 500KB is rejected before submitting', { annotation: meta({ severity: Severity.high, layer: Layer.ui }) }, async ({ page }) => { /* ... */ });
});
```

Severity definitions:

- **critical**: a core user journey is blocked (sign-in, note management, submitting data, file transfer).
- **high**: an important feature is broken, but core journeys still work.
- **medium**: secondary behaviour is broken or degraded; a workaround exists.
- **low**: cosmetic, diagnostic, or edge-case behaviour.

A test without a value (or with an unknown severity) is reported as `Unclassified` rather than dropped.

### How the numbers are calculated

- **Scenario**: one test in one project. The same test in Chromium and Firefox is two scenarios, which is what makes the browser matrix possible. Its columns are Playwright projects, so the browser-less `api` project and the `setup` project (whose login test counts toward the Login feature) appear next to the browsers.
- **Outcome**: Playwright's final outcome. *Flaky* means the scenario failed and then passed on a retry within the same run; it can only occur when retries are enabled (locally they are off, so local runs cannot detect flakiness). Tests that never started, for example because the `setup` project failed, count as *skipped* and are additionally flagged *did not run*, using the same rule as Playwright's own summary.
- **Pass rate** = passed / executed, where executed = passed + failed + flaky. Skipped scenarios are left out of the denominator, and flaky scenarios are not counted as passed. The critical pass rate applies the same formula to `critical` scenarios.
- **Durations**: a scenario's duration is the sum of all its attempts. Average, median and p95 (nearest rank) are over executed scenarios. Wall clock is the elapsed time of the run; cumulative time is the sum of scenario durations and exceeds the wall clock when workers run in parallel.
- **Failure category** is assigned by fixed rules, in order: *Setup / teardown* (the failing step was a hook or fixture), *Timeout* (test timeout), *Navigation / network* (network error codes such as `net::ERR_`), *Assertion* (an `expect()` failed), *Timeout* (an action timeout), *Other*. It is a triage aid, not root-cause analysis.

### Overall status

Derived only from these rules (`reporter/aggregate.ts`, `deriveStatus`):

1. **Critical**: at least one `critical` scenario failed.
2. **Attention Required**: otherwise, if any scenario failed or was flaky; any scenario did not run although it was not intentionally skipped (its dependency or `beforeAll` hook failed, or the run was interrupted; critical ones are named); the run was interrupted or timed out; an error occurred outside any test (for example a spec that failed to load); or no scenario executed.
3. **Healthy**: otherwise. Intentionally skipped scenarios (`test.skip`) do not change the status.

The dashboard lists the rules that fired. There is no composite quality score.

### Reporter source

| File | Responsibility |
|------|----------------|
| `reporter/business-reporter.ts` | Playwright reporter: collects scenarios from the suite tree, copies artifacts, writes the output |
| `reporter/model.ts` | The `RunReport` data model shared by all parts (and by `run.json`) |
| `reporter/aggregate.ts` | Statistics, failure classification and the overall-status rules (pure functions) |
| `reporter/history.ts` | History snapshots (load, save, prune), which runs are recorded, and the trends |
| `reporter/render-html.ts` | Renders the dashboard HTML from a `RunReport` |

## Artifacts

Everything is written inside this directory and git-ignored:

- `playwright-report/` holds the HTML report (never opened automatically; use `npm run report`).
- `business-report/` holds the Business QA Dashboard (see above), including copies of failure artifacts.
- `business-report-history/` holds the recorded run snapshots behind the dashboard's trends. Delete it to reset local history.
- `playwright/.auth/` holds the stored login session created by the `setup` project.
- `blob-report/` is written instead of the HTML report in CI mode (merged by the workflow).
- `test-results/` holds per-test output. Failed tests keep a trace, a screenshot and a video. Open a trace with `npx playwright show-trace test-results/<test>/trace.zip`.

## Continuous integration

`.github/workflows/web-e2e.yml` runs on pushes to `main` and on pull requests that touch this project:

- a quick `static` job (type-check and lint, no browsers) gates the full suite in Chromium, Firefox, **WebKit** and mobile Chromium on Ubuntu, sharded across 2 machines,
- each shard uploads a blob report; a follow-up job merges them into one HTML report (`playwright-report` artifact) and the Business QA Dashboard (`business-report` artifact), and on pushes to `main` updates the dashboard history (`business-report-history` artifact),
- CI mode (`CI=1`) enables `forbidOnly`, 2 retries and a single worker per shard. Retries are a safety net, not a fix for flaky tests.

Actions are pinned to commit SHAs. `.github/workflows/workflow-lint.yml` checks workflow changes with actionlint and zizmor, and Dependabot (`.github/dependabot.yml`) proposes monthly updates for the actions and this project's npm dependencies.

Visual baselines are Linux-only and are skipped on other platforms. In CI a missing or changed baseline fails the run; for a changed one the actual and diff images are uploaded in the `test-results-*` artifact. To regenerate baselines, run the workflow manually with **update_snapshots** enabled and commit the `visual-baselines-*` artifact contents into `tests/e2e/visual.spec.ts-snapshots/`.

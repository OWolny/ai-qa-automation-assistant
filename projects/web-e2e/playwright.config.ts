import { defineConfig, devices, type Project } from '@playwright/test';

const isCI = !!process.env['CI'];
const baseURL = process.env['BASE_URL'] || 'https://practice.expandtesting.com';
// WebKit needs host libraries that are not available on every machine (e.g. some Windows setups).
const includeWebkit = process.env['PW_INCLUDE_WEBKIT'] === '1';

const MOBILE_SPECS = /.*\.mobile\.spec\.ts/;

const desktopProjects: Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ...(includeWebkit ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
].map((project) => ({
  ...project,
  metadata: { browser: project.use?.defaultBrowserType },
  testDir: './tests/e2e',
  testIgnore: MOBILE_SPECS,
  dependencies: ['setup'],
}));

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',

  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // In CI a missing visual baseline must fail (not be silently written); baselines come from the
  // workflow's update_snapshots dispatch.
  updateSnapshots: isCI ? 'none' : 'missing',
  ...(isCI ? { workers: 1 } : {}),

  // CI shards emit blob reports that the workflow merges (merge.config.ts) into the HTML report and
  // the Business QA Dashboard. Locally, the dashboard (business-report/) sits beside the technical
  // HTML report, which keeps the embedded trace viewer and step-level detail; full-suite local runs
  // are recorded in business-report-history/ for the dashboard's trends.
  reporter: isCI
    ? [['list'], ['blob']]
    : [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['./reporter/business-reporter.ts', { outputFolder: 'business-report', history: { folder: 'business-report-history' } }],
      ],

  // Blob reports keep metadata but not `use`, so the merged dashboard reads the target URL and each
  // project's browser from metadata.
  metadata: { baseURL },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'api', testDir: './tests/api' },
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts/,
      metadata: { browser: devices['Desktop Chrome'].defaultBrowserType },
      use: { ...devices['Desktop Chrome'] },
    },
    ...desktopProjects,
    {
      name: 'mobile-chromium',
      testDir: './tests/e2e',
      testMatch: MOBILE_SPECS,
      metadata: { browser: devices['Pixel 7'].defaultBrowserType },
      use: { ...devices['Pixel 7'] },
    },
  ],
});

import { defineConfig } from '@playwright/test';

// Used only by the CI merge job: `npx playwright merge-reports --config merge.config.ts ./all-blob-reports`.
// Turns the shards' blob reports into the HTML report and the Business QA Dashboard.
// BUSINESS_REPORT_RECORD_HISTORY=1 adds this run to business-report-history/ (pushes to main only);
// otherwise the dashboard shows the restored history's trends without recording itself.
export default defineConfig({
  // Merged test locations are resolved against this folder; it must match playwright.config.ts.
  testDir: './tests',
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    [
      './reporter/business-reporter.ts',
      {
        outputFolder: 'business-report',
        history: {
          folder: 'business-report-history',
          record: process.env['BUSINESS_REPORT_RECORD_HISTORY'] === '1',
        },
      },
    ],
  ],
});

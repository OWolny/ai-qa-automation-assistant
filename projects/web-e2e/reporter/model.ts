// Normalized run model of the Business QA Dashboard.
// The reporter collects Playwright events into ScenarioRecords, aggregation derives every
// statistic from them, and the HTML renderer and run.json both consume the same RunReport.

export const SCHEMA_VERSION = 1;

/** Annotation types the reporter reads. Tests set them through tests/support/report-metadata.ts. */
export const METADATA_KEYS = {
  feature: 'feature',
  capability: 'businessCapability',
  severity: 'severity',
  layer: 'layer',
} as const;

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Placeholder for missing or unrecognised metadata, so aggregation never drops a scenario. */
export const UNCLASSIFIED = 'Unclassified';

/**
 * Final outcome of one scenario (one test in one project), from Playwright's `test.outcome()`:
 * expected -> passed, unexpected -> failed, flaky -> flaky (failed, then passed on a retry), skipped -> skipped.
 */
export type Outcome = 'passed' | 'failed' | 'flaky' | 'skipped';
export const OUTCOMES: readonly Outcome[] = ['passed', 'failed', 'flaky', 'skipped'];

export type FailureCategory = 'Setup / teardown' | 'Timeout' | 'Navigation / network' | 'Assertion' | 'Other';

export type StatusLevel = 'healthy' | 'attention' | 'critical';

export interface Attachment {
  name: string;
  contentType: string;
  kind: 'screenshot' | 'trace' | 'video' | 'other';
  /** Path relative to the report folder (always forward slashes). */
  path: string;
  /** Attempt index the attachment belongs to (0 = first run). */
  retry: number;
}

export interface Attempt {
  retry: number;
  /** Playwright TestResult.status: passed | failed | timedOut | skipped | interrupted. */
  status: string;
  startTime: string;
  durationMs: number;
}

export interface ScenarioError {
  /** First line of the error message, ANSI-stripped. Safe for summaries. */
  summary: string;
  /** Full ANSI-stripped message. */
  message: string;
  stack?: string;
  snippet?: string;
  /** "file:line:column" relative to the project root, when Playwright knows it. */
  location?: string;
}

export interface ScenarioRecord {
  /** Playwright TestCase.id: stable across runs for the same test and project. */
  id: string;
  title: string;
  /** describe titles above the test, outermost first (file and project excluded). */
  describePath: string[];
  /** Spec path relative to the project root, forward slashes. */
  file: string;
  line: number;
  column: number;
  project: string;
  /** Browser name from the project's `use.browserName`, or undefined for non-browser (API) projects. */
  browser?: string;
  tags: string[];
  feature: string;
  capability: string;
  severity: Severity | typeof UNCLASSIFIED;
  layer: string;
  /** Every annotation, including non-reporting ones like `skip` with its reason. */
  annotations: { type: string; description?: string }[];
  outcome: Outcome;
  /**
   * Skipped without being asked to: never started (dependency or beforeAll failed), or interrupted.
   * Same rule as Playwright's "did not run" summary. Always false for an intentional test.skip().
   */
  didNotRun: boolean;
  /** Playwright expectedStatus (e.g. "failed" for test.fail()). */
  expectedStatus: string;
  /** Status of the last attempt, or "notRun" when the test never started (e.g. its dependency failed). */
  finalStatus: string;
  /** Number of attempts executed (0 when the test never started). */
  attemptCount: number;
  retriesAllowed: number;
  /** Sum of all attempt durations: the real time this scenario cost, retries included. */
  durationMs: number;
  attempts: Attempt[];
  /** Errors of the last failing attempt (the one that decided the outcome, or the first failure of a flaky test). */
  errors: ScenarioError[];
  failureCategory?: FailureCategory;
  attachments: Attachment[];
}

export interface OutcomeCounts {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  /** The part of `skipped` that did not run although it was not intentionally skipped. */
  didNotRun: number;
  /** passed + failed + flaky. Skipped scenarios are excluded. */
  executed: number;
  /** passed / executed (flaky is NOT counted as passed); null when executed is 0. */
  passRate: number | null;
}

export interface GroupStats extends OutcomeCounts {
  name: string;
  durationMs: number;
}

export interface MatrixCell extends OutcomeCounts {
  feature: string;
  project: string;
}

export interface DurationStats {
  /** Wall-clock time of the whole run (FullResult.duration). */
  wallClockMs: number;
  /** Sum of executed scenario durations; exceeds wall clock when workers run in parallel. */
  cumulativeMs: number;
  /** Over executed scenarios (skipped excluded); null when none executed. */
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  slowest: { id: string; title: string; project: string; feature: string; durationMs: number }[];
  byFeature: { name: string; totalMs: number; averageMs: number; count: number }[];
}

export interface ReliabilityStats {
  /** Max retries configured across projects in this run. 0 means flakiness cannot be detected. */
  retriesConfigured: number;
  /** Passed on the first attempt. */
  stable: number;
  /** Failed at least once, then passed on a retry (Playwright outcome "flaky"). */
  flaky: number;
  /** Failed on every attempt despite at least one retry. */
  failedAfterRetries: number;
  /** flaky / executed; null when executed is 0. */
  flakyRate: number | null;
}

export interface BusinessStatus {
  level: StatusLevel;
  label: 'Healthy' | 'Attention Required' | 'Critical';
  /** Every rule that fired, in plain language. Empty only for Healthy with nothing to note. */
  reasons: string[];
}

export interface RunMetadata {
  /** Stable run identifier derived from the start time (ISO basic format). */
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** Playwright FullResult.status: passed | failed | timedout | interrupted. */
  runStatus: string;
  /** Target base URL from the config; the report does not guess environment names. */
  baseURL?: string;
  ci: boolean;
  git?: { branch?: string; commit?: string; dirty?: boolean };
  playwrightVersion: string;
  nodeVersion: string;
  os: string;
  projects: string[];
  /** Report folder relative to the project root (forward slashes), for copy-paste commands. */
  reportDir: string;
  workers: number;
  shard?: { current: number; total: number };
}

export interface RunReport {
  schemaVersion: typeof SCHEMA_VERSION;
  run: RunMetadata;
  status: BusinessStatus;
  summary: OutcomeCounts & { criticalTotal: number };
  /** Scenarios with severity "critical". */
  critical: OutcomeCounts;
  bySeverity: GroupStats[];
  features: GroupStats[];
  capabilities: GroupStats[];
  projects: GroupStats[];
  layers: GroupStats[];
  /** Feature x project; only combinations that have at least one scenario. */
  matrix: MatrixCell[];
  durations: DurationStats;
  reliability: ReliabilityStats;
  failureCategories: { category: FailureCategory; count: number }[];
  /** Errors raised outside any test (e.g. a spec file that failed to load, global setup). */
  runErrors: ScenarioError[];
  scenarios: ScenarioRecord[];
  /** Present when history is configured; derived from earlier recorded runs plus this one. */
  trends?: Trends;
}

// ---------------------------------------------------------------------------------------------
// History and trends

export const HISTORY_SCHEMA_VERSION = 1;

/** Compact per-scenario outcome kept in history: passed, failed, flaky (k), skipped. */
export type OutcomeCode = 'p' | 'f' | 'k' | 's';

type TrendCounts = Omit<OutcomeCounts, 'didNotRun'>;

/** One recorded run, stored as `<historyFolder>/<runId>.json`. Small on purpose (no errors, no artifacts). */
export interface HistoryEntry {
  historySchemaVersion: typeof HISTORY_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  runStatus: string;
  ci: boolean;
  /** Target environment; trends only compare runs against the same base URL. */
  baseURL?: string;
  git?: { branch?: string; commit?: string; dirty?: boolean };
  projects: string[];
  status: StatusLevel;
  summary: TrendCounts;
  critical: TrendCounts;
  flakyRate: number | null;
  retriesConfigured: number;
  wallClockMs: number;
  medianMs: number | null;
  p95Ms: number | null;
  features: ({ name: string } & TrendCounts)[];
  /** Playwright test id -> outcome. Ids are stable across runs while the file, title and project are unchanged. */
  scenarios: Record<string, OutcomeCode>;
}

export interface TrendPoint {
  runId: string;
  startedAt: string;
  commit?: string;
  branch?: string;
  /** This run. */
  current: boolean;
  /** Whether this run is (or, for the current run, will be) stored in history. */
  recorded: boolean;
  status: StatusLevel;
  total: number;
  executed: number;
  passRate: number | null;
  flakyRate: number | null;
  criticalPassRate: number | null;
  retriesConfigured: number;
  wallClockMs: number;
  medianMs: number | null;
  p95Ms: number | null;
}

/** A scenario that failed in this run, placed on the history timeline. */
export interface Regression {
  id: string;
  title: string;
  project: string;
  feature: string;
  severity: ScenarioRecord['severity'];
  /**
   * new-failure: it passed the last time it ran. ongoing: it also failed in the previous run(s).
   * new-scenario: no earlier run in the window executed it (absent or only skipped).
   */
  kind: 'new-failure' | 'ongoing' | 'new-scenario';
  /** Consecutive runs (including this one) in which it failed; skipped or absent runs are ignored. */
  failingRuns: number;
  /** Earliest run of the current failing streak. */
  failingSince: { runId: string; startedAt: string; commit?: string };
  /** Most recent earlier run in which it passed (passed or flaky); undefined if none in the window. */
  lastPassed?: { runId: string; startedAt: string; commit?: string };
}

export interface Trends {
  /** History folder relative to the project root. */
  historyDir: string;
  maxRuns: number;
  /** Why the current run is not recorded, when it is not (e.g. filtered local run, pull request). */
  notRecordedReason?: string;
  /** Oldest first; the last point is the current run. */
  points: TrendPoint[];
  /** Pass rate per feature per point (same order as `points`); null = feature absent or nothing executed. */
  featureHealth: { feature: string; passRates: (number | null)[] }[];
  regressions: Regression[];
  /** Passed (or flaky) now, failed the last time they ran. */
  fixed: { id: string; title: string; project: string; feature: string }[];
}

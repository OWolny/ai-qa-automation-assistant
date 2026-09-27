// Business QA Dashboard: a Playwright reporter that writes run.json (the normalized RunReport)
// and a self-contained index.html, and copies failure artifacts next to them.
//
// Collection happens once in onEnd from the full suite tree, so tests that never started
// (e.g. their dependency project failed) are still reported, as skipped.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import { buildReport, classifyFailure } from './aggregate';
import { DEFAULT_MAX_RUNS, buildTrends, isFullSuiteInvocation, loadHistory, saveHistory, toHistoryEntry } from './history';
import {
  METADATA_KEYS,
  SEVERITIES,
  UNCLASSIFIED,
  type Attachment,
  type Outcome,
  type RunMetadata,
  type RunReport,
  type ScenarioError,
  type ScenarioRecord,
  type Severity,
} from './model';
import { renderHtml } from './render-html';

export type BusinessReporterOptions = {
  /** Output folder, relative to the config file's directory. Default: "business-report". */
  outputFolder?: string;
  /** Enables trends. Without it the dashboard has no Trends section and nothing is recorded. */
  history?: {
    /** History folder, relative to the config file's directory. */
    folder: string;
    /**
     * Whether this run is added to history. 'auto' (local default) records only full-suite
     * `playwright test` invocations; merged CI reports pass an explicit boolean.
     */
    record?: boolean | 'auto';
    /** Runs kept in history (oldest are deleted). Default 50. */
    maxRuns?: number;
  };
};

const OUTCOME_BY_PLAYWRIGHT: Record<ReturnType<TestCase['outcome']>, Outcome> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
};

/** A local run with fewer scenarios than this share of the last recorded run is not recorded. */
const MIN_SCOPE_RATIO = 0.9;

// Matches ANSI colour/style escape sequences that Playwright puts into error messages.
const ANSI = /\u001b\[[0-9;]*m/g;

export default class BusinessReporter implements Reporter {
  private readonly options: BusinessReporterOptions;
  private config!: FullConfig;
  private rootSuite!: Suite;
  private projectDir = process.cwd();
  private outputDir = '';
  private readonly runErrors: ScenarioError[] = [];

  constructor(options: BusinessReporterOptions = {}) {
    this.options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.rootSuite = suite;
    this.projectDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.outputDir = path.resolve(this.projectDir, this.options.outputFolder ?? 'business-report');
  }

  onError(error: TestError): void {
    this.runErrors.push(this.toScenarioError(error));
  }

  async onEnd(result: FullResult): Promise<void> {
    // `playwright test --list` also runs reporters; do not replace the last real report with an empty one.
    if (process.argv.includes('--list')) return;
    fs.rmSync(this.outputDir, { recursive: true, force: true });
    fs.mkdirSync(this.outputDir, { recursive: true });

    const scenarios = this.rootSuite.allTests().map((test) => this.collect(test));
    const report = buildReport({
      run: this.runMetadata(result),
      scenarios,
      // Per-test retries (test.describe.configure) are already reflected in each scenario's retriesAllowed.
      retriesConfigured: Math.max(0, ...scenarios.map((s) => s.retriesAllowed)),
      wallClockMs: result.duration,
      runErrors: this.runErrors,
    });

    if (this.options.history) {
      // History must never cost us the report itself.
      try {
        this.applyHistory(report, result);
      } catch (error) {
        delete report.trends;
        console.warn(`Business QA Dashboard: trends skipped, history could not be processed: ${String(error)}`);
      }
    }

    fs.writeFileSync(path.join(this.outputDir, 'run.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(this.outputDir, 'index.html'), renderHtml(report));
    console.log(`\nBusiness QA Dashboard: ${path.relative(process.cwd(), path.join(this.outputDir, 'index.html'))}`);
  }

  /** Adds trends from earlier runs and, when this run qualifies, records it. */
  private applyHistory(report: RunReport, result: FullResult): void {
    const options = this.options.history!;
    const folder = path.resolve(this.projectDir, options.folder);
    const maxRuns = Math.max(2, options.maxRuns ?? DEFAULT_MAX_RUNS);
    const record = options.record ?? 'auto';

    // Only runs against the same target environment are comparable.
    const earlier = loadHistory(folder).filter((e) => (e.baseURL ?? '') === (report.run.baseURL ?? ''));
    const latest = earlier.at(-1);

    let notRecordedReason: string | undefined;
    if (record === false) notRecordedReason = 'history recording is turned off for this run';
    else if (record === 'auto' && !isFullSuiteInvocation(process.argv)) notRecordedReason = 'filtered or modified run (only full-suite runs are recorded)';
    else if (result.status === 'interrupted' || result.status === 'timedout') notRecordedReason = `the run did not finish (${result.status})`;
    else if (report.summary.total === 0) notRecordedReason = 'no scenarios were collected';
    else if (latest && latest.startedAt > report.run.startedAt) notRecordedReason = 'a newer run is already recorded';
    // A leftover test.only or a narrowed environment looks like a full run on the command line.
    else if (record === 'auto' && latest && report.summary.total < latest.summary.total * MIN_SCOPE_RATIO) {
      notRecordedReason = `scope is much smaller than the last recorded run (${report.summary.total} vs ${latest.summary.total} scenarios)`;
    }

    report.trends = buildTrends({
      report,
      earlier,
      historyDir: this.relative(folder),
      maxRuns,
      recorded: notRecordedReason === undefined,
      ...(notRecordedReason ? { notRecordedReason } : {}),
    });
    if (notRecordedReason === undefined) saveHistory(folder, toHistoryEntry(report), maxRuns);
  }

  private collect(test: TestCase): ScenarioRecord {
    const project = test.parent.project();
    const results = test.results;
    const lastResult = results.at(-1);
    const outcome = OUTCOME_BY_PLAYWRIGHT[test.outcome()];
    // The attempt whose errors explain the outcome: the last failing one (for flaky, the failure before the pass).
    const failingResult = [...results].reverse().find((r) => r.errors.length > 0);
    const errors = failingResult?.errors.map((e) => this.toScenarioError(e)) ?? [];
    if (outcome === 'failed' && errors.length === 0 && test.expectedStatus === 'failed') {
      const message = 'Expected to fail (test.fail()) but passed.';
      errors.push({ summary: message, message });
    }
    // Merged (blob) reports keep project metadata but not `use`, so the config mirrors the browser there.
    const browser: unknown = project?.use.browserName ?? project?.use.defaultBrowserType ?? project?.metadata['browser'];

    const record: ScenarioRecord = {
      id: test.id,
      title: test.title,
      describePath: this.describePath(test),
      file: this.relative(test.location.file),
      line: test.location.line,
      column: test.location.column,
      project: project?.name || UNCLASSIFIED,
      ...(typeof browser === 'string' ? { browser } : {}),
      tags: test.tags,
      feature: this.annotation(test, METADATA_KEYS.feature) ?? UNCLASSIFIED,
      capability: this.annotation(test, METADATA_KEYS.capability) ?? UNCLASSIFIED,
      severity: toSeverity(this.annotation(test, METADATA_KEYS.severity)),
      layer: this.annotation(test, METADATA_KEYS.layer) ?? UNCLASSIFIED,
      annotations: test.annotations.map(({ type, description }) =>
        description === undefined ? { type } : { type, description },
      ),
      outcome,
      didNotRun:
        outcome === 'skipped' &&
        (results.length === 0 ||
          test.expectedStatus !== 'skipped' ||
          results.some((r) => r.status === 'interrupted')),
      expectedStatus: test.expectedStatus,
      finalStatus: lastResult?.status ?? 'notRun',
      attemptCount: results.length,
      retriesAllowed: test.retries,
      durationMs: results.reduce((total, r) => total + r.duration, 0),
      attempts: results.map((r) => ({
        retry: r.retry,
        status: r.status,
        startTime: r.startTime.toISOString(),
        durationMs: r.duration,
      })),
      errors,
      attachments: results.flatMap((r) => this.copyAttachments(test, r)),
    };

    if (failingResult && (outcome === 'failed' || outcome === 'flaky')) {
      record.failureCategory = classifyFailure({
        attemptStatus: failingResult.status,
        failedInHookOrFixture: failedInHookOrFixture(failingResult.steps),
        messages: errors.map((e) => e.message),
      });
    }
    return record;
  }

  /** Last value wins: test-level annotations follow the inherited describe-level ones. */
  private annotation(test: TestCase, type: string): string | undefined {
    const value = test.annotations.filter((a) => a.type === type).at(-1)?.description?.trim();
    return value || undefined;
  }

  private describePath(test: TestCase): string[] {
    const titles: string[] = [];
    for (let suite: Suite | undefined = test.parent; suite; suite = suite.parent) {
      if (suite.type === 'describe') titles.unshift(suite.title);
    }
    return titles;
  }

  private copyAttachments(test: TestCase, result: TestResult): Attachment[] {
    const targetDir = path.join(this.outputDir, 'artifacts', test.id.replace(/[^\w-]/g, '_'), `retry-${result.retry}`);
    const copied: Attachment[] = [];
    result.attachments.forEach((attachment, index) => {
      const fileName = `${index}-${attachment.path ? path.basename(attachment.path) : fileNameFor(attachment)}`;
      const target = path.join(targetDir, fileName);
      try {
        fs.mkdirSync(targetDir, { recursive: true });
        if (attachment.path) fs.copyFileSync(attachment.path, target);
        else if (attachment.body) fs.writeFileSync(target, attachment.body);
        else return;
      } catch (error) {
        console.warn(`Business QA Dashboard: could not copy attachment "${attachment.name}": ${String(error)}`);
        return;
      }
      copied.push({
        name: attachment.name,
        contentType: attachment.contentType,
        kind: attachmentKind(attachment.name, attachment.contentType),
        path: path.relative(this.outputDir, target).split(path.sep).join('/'),
        retry: result.retry,
      });
    });
    return copied;
  }

  private toScenarioError(error: TestError): ScenarioError {
    // Absolute paths would leak the local machine layout into a report that may be shared.
    const clean = (text: string): string => stripAnsi(text).split(this.projectDir + path.sep).join('');
    const message = clean(error.message ?? error.value ?? 'Unknown error');
    const stack = error.stack ? clean(error.stack).replace(/\\/g, '/') : undefined;
    const snippet = error.snippet ? clean(error.snippet) : undefined;
    return {
      summary: message.split('\n').find((line) => line.trim() !== '')?.trim() ?? 'Unknown error',
      message,
      ...(stack ? { stack } : {}),
      ...(snippet ? { snippet } : {}),
      ...(error.location
        ? { location: `${this.relative(error.location.file)}:${error.location.line}:${error.location.column}` }
        : {}),
    };
  }

  private runMetadata(result: FullResult): RunMetadata {
    const metadataBaseURL: unknown = this.config.metadata['baseURL'];
    const actualWorkers: unknown = this.config.metadata['actualWorkers'];
    const baseURL =
      this.config.projects.map((p) => p.use.baseURL).find((url) => url) ??
      (typeof metadataBaseURL === 'string' ? metadataBaseURL : undefined);
    const git = gitInfo(this.projectDir);
    const shard = this.config.shard;
    return {
      // Millisecond resolution, so two quick local runs never share a history file.
      runId: result.startTime.toISOString().replace(/[-:.]/g, ''),
      startedAt: result.startTime.toISOString(),
      finishedAt: new Date(result.startTime.getTime() + result.duration).toISOString(),
      runStatus: result.status,
      ...(baseURL ? { baseURL } : {}),
      ci: !!process.env['CI'],
      ...(git ? { git } : {}),
      playwrightVersion: this.config.version,
      nodeVersion: process.version,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      // A merged sharded report has one project suite per shard.
      projects: [...new Set(this.rootSuite.suites.map((s) => s.title))],
      reportDir: this.relative(this.outputDir),
      // actualWorkers survives blob merges; config.workers would be the merge process's default.
      workers: typeof actualWorkers === 'number' ? actualWorkers : this.config.workers,
      ...(shard ? { shard: { current: shard.current, total: shard.total } } : {}),
    };
  }

  private relative(file: string): string {
    return path.relative(this.projectDir, file).split(path.sep).join('/');
  }
}

function toSeverity(value: string | undefined): Severity | typeof UNCLASSIFIED {
  return SEVERITIES.find((s) => s === value?.toLowerCase()) ?? UNCLASSIFIED;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function failedInHookOrFixture(steps: readonly TestStep[]): boolean {
  const failedStep = steps.find((step) => step.error);
  return failedStep?.category === 'hook' || failedStep?.category === 'fixture';
}

function attachmentKind(name: string, contentType: string): Attachment['kind'] {
  if (name === 'trace' && contentType === 'application/zip') return 'trace';
  if (contentType.startsWith('image/')) return 'screenshot';
  if (contentType.startsWith('video/')) return 'video';
  return 'other';
}

// Body-only attachments get an extension so browsers open them correctly from file://.
const EXTENSIONS: Record<string, string> = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/html': '.html',
  'application/json': '.json',
  'application/zip': '.zip',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'video/webm': '.webm',
};

function fileNameFor(attachment: TestResult['attachments'][number]): string {
  const base = attachment.name.replace(/[^\w.-]/g, '_') || 'attachment';
  const extension = EXTENSIONS[attachment.contentType.split(';')[0]!.trim()] ?? '';
  return path.extname(base) ? base : base + extension;
}

function gitInfo(cwd: string): RunMetadata['git'] | undefined {
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    } catch {
      return undefined;
    }
  };
  // CI checkouts are often detached; prefer the CI-provided branch and commit when present.
  const branch = process.env['GITHUB_HEAD_REF'] || process.env['GITHUB_REF_NAME'] || git('rev-parse', '--abbrev-ref', 'HEAD');
  // On pull requests GITHUB_SHA is a temporary merge commit; the workflow passes the PR head instead.
  const commit = (process.env['PR_HEAD_SHA'] || process.env['GITHUB_SHA'])?.slice(0, 7) || git('rev-parse', '--short', 'HEAD');
  const status = git('status', '--porcelain');
  if (!branch && !commit) return undefined;
  return {
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
    ...(status !== undefined ? { dirty: status.length > 0 } : {}),
  };
}

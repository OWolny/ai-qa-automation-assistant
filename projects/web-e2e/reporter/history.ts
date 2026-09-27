// Run history for the Business QA Dashboard: a folder of compact per-run snapshots
// (<folder>/<runId>.json) and the trends derived from them. No database: the folder is the store,
// and in CI it travels between workflow runs as an artifact.

import fs from 'node:fs';
import path from 'node:path';
import {
  HISTORY_SCHEMA_VERSION,
  type HistoryEntry,
  type Outcome,
  type OutcomeCode,
  type OutcomeCounts,
  type Regression,
  type RunReport,
  type TrendPoint,
  type Trends,
} from './model';

export const DEFAULT_MAX_RUNS = 50;

const CODE: Record<Outcome, OutcomeCode> = { passed: 'p', failed: 'f', flaky: 'k', skipped: 's' };

function counts({ didNotRun: _, ...rest }: OutcomeCounts): Omit<OutcomeCounts, 'didNotRun'> {
  return rest;
}

export function toHistoryEntry(report: RunReport): HistoryEntry {
  const { run } = report;
  return {
    historySchemaVersion: HISTORY_SCHEMA_VERSION,
    runId: run.runId,
    startedAt: run.startedAt,
    runStatus: run.runStatus,
    ci: run.ci,
    ...(run.baseURL ? { baseURL: run.baseURL } : {}),
    ...(run.git ? { git: run.git } : {}),
    projects: run.projects,
    status: report.status.level,
    summary: counts(report.summary),
    critical: counts(report.critical),
    flakyRate: report.reliability.flakyRate,
    retriesConfigured: report.reliability.retriesConfigured,
    wallClockMs: report.durations.wallClockMs,
    medianMs: report.durations.medianMs,
    p95Ms: report.durations.p95Ms,
    features: report.features.map(({ name, durationMs: _, didNotRun: __, ...rest }) => ({ name, ...rest })),
    scenarios: Object.fromEntries(report.scenarios.map((s) => [s.id, CODE[s.outcome]])),
  };
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  const e = value as Partial<HistoryEntry> | null;
  return (
    typeof e === 'object' && e !== null &&
    e.historySchemaVersion === HISTORY_SCHEMA_VERSION &&
    typeof e.runId === 'string' && typeof e.startedAt === 'string' &&
    typeof e.summary === 'object' && e.summary !== null &&
    typeof e.critical === 'object' && e.critical !== null &&
    Array.isArray(e.features) &&
    typeof e.scenarios === 'object' && e.scenarios !== null
  );
}

/** Valid entries with their file names, oldest first, one per runId. Anything else is skipped with a warning. */
function readEntries(folder: string): { file: string; entry: HistoryEntry }[] {
  if (!fs.existsSync(folder)) return [];
  const byRunId = new Map<string, { file: string; entry: HistoryEntry }>();
  const skipped: string[] = [];
  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.json'))) {
    try {
      const entry: unknown = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
      if (isHistoryEntry(entry)) byRunId.set(entry.runId, { file, entry });
      else skipped.push(file);
    } catch {
      skipped.push(file);
    }
  }
  if (skipped.length > 0) {
    console.warn(
      `Business QA Dashboard: ignored ${skipped.length} history file(s) that are unreadable or not schema v${HISTORY_SCHEMA_VERSION}: ${skipped.slice(0, 5).join(', ')}`,
    );
  }
  return [...byRunId.values()].sort((a, b) => a.entry.startedAt.localeCompare(b.entry.startedAt));
}

export function loadHistory(folder: string): HistoryEntry[] {
  return readEntries(folder).map((x) => x.entry);
}

/** Writes the entry and deletes the oldest valid entries beyond maxRuns. */
export function saveHistory(folder: string, entry: HistoryEntry, maxRuns: number): void {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${entry.runId}.json`), JSON.stringify(entry));
  const kept = readEntries(folder);
  for (const old of kept.slice(0, Math.max(0, kept.length - maxRuns))) {
    fs.rmSync(path.join(folder, old.file), { force: true });
  }
}

// Local runs are recorded only when started as the whole suite. Playwright does not tell reporters
// which filters were used, so this is an allow-list: any other argument (file paths, --grep,
// --project, --repeat-each, --retries, --last-failed, ...) makes the run "filtered".
const NEUTRAL_FLAGS = new Set(['--headed', '--quiet', '--fully-parallel', '--forbid-only', '--pass-with-no-tests']);
const NEUTRAL_FLAGS_WITH_VALUE = new Set(['--workers', '-j', '--trace', '--reporter', '--output', '--config', '-c', '--timeout', '--global-timeout']);

export function isFullSuiteInvocation(argv: readonly string[]): boolean {
  const start = argv.indexOf('test');
  if (start < 0) return false;
  for (let i = start + 1; i < argv.length; i++) {
    const arg = argv[i]!;
    const flag = arg.split('=')[0]!;
    if (NEUTRAL_FLAGS.has(flag)) continue;
    if (NEUTRAL_FLAGS_WITH_VALUE.has(flag)) {
      if (!arg.includes('=')) i++;
      continue;
    }
    return false;
  }
  return true;
}

function pointFrom(entry: HistoryEntry, current: boolean, recorded: boolean): TrendPoint {
  return {
    runId: entry.runId,
    startedAt: entry.startedAt,
    ...(entry.git?.commit ? { commit: entry.git.commit } : {}),
    ...(entry.git?.branch ? { branch: entry.git.branch } : {}),
    current,
    recorded,
    status: entry.status,
    total: entry.summary.total,
    executed: entry.summary.executed,
    passRate: entry.summary.passRate,
    flakyRate: entry.flakyRate,
    criticalPassRate: entry.critical.passRate,
    retriesConfigured: entry.retriesConfigured,
    wallClockMs: entry.wallClockMs,
    medianMs: entry.medianMs,
    p95Ms: entry.p95Ms,
  };
}

function runRef(entry: HistoryEntry): { runId: string; startedAt: string; commit?: string } {
  return { runId: entry.runId, startedAt: entry.startedAt, ...(entry.git?.commit ? { commit: entry.git.commit } : {}) };
}

/**
 * Trends over the earlier entries plus the current run (always the last point).
 * Per-scenario comparisons skip runs in which the scenario was absent or skipped, so partial scope
 * never reads as a regression or a fix.
 */
export function buildTrends(input: {
  report: RunReport;
  earlier: HistoryEntry[];
  historyDir: string;
  maxRuns: number;
  recorded: boolean;
  notRecordedReason?: string;
}): Trends {
  const { report, recorded } = input;
  const currentEntry = toHistoryEntry(report);
  // Only runs that started before this one count as "earlier" (a re-run of an old CI job must not
  // treat newer runs as its past).
  const earlier = input.earlier
    .filter((e) => e.runId !== currentEntry.runId && e.startedAt < currentEntry.startedAt)
    .slice(-(input.maxRuns - 1));
  const timeline = [...earlier, currentEntry];

  const featureNames = [...new Set(timeline.flatMap((e) => e.features.map((f) => f.name)))].sort();
  const featureHealth = featureNames.map((feature) => ({
    feature,
    passRates: timeline.map((e) => e.features.find((f) => f.name === feature)?.passRate ?? null),
  }));

  /** Earlier executed outcomes of a scenario, newest first. */
  const pastOutcomes = (id: string): { entry: HistoryEntry; code: OutcomeCode }[] =>
    earlier
      .map((entry) => ({ entry, code: entry.scenarios[id] }))
      .filter((x): x is { entry: HistoryEntry; code: OutcomeCode } => x.code !== undefined && x.code !== 's')
      .reverse();

  const regressions: Regression[] = report.scenarios
    .filter((s) => s.outcome === 'failed')
    .map((s) => {
      const past = pastOutcomes(s.id);
      let failingSince = runRef(currentEntry);
      let failingRuns = 1;
      let lastPassed: HistoryEntry | undefined;
      for (const { entry, code } of past) {
        if (code !== 'f') {
          lastPassed = entry;
          break;
        }
        failingSince = runRef(entry);
        failingRuns++;
      }
      const kind: Regression['kind'] = past.length === 0 ? 'new-scenario' : failingRuns === 1 ? 'new-failure' : 'ongoing';
      return {
        id: s.id,
        title: s.title,
        project: s.project,
        feature: s.feature,
        severity: s.severity,
        kind,
        failingRuns,
        failingSince,
        ...(lastPassed ? { lastPassed: runRef(lastPassed) } : {}),
      };
    });

  const fixed = report.scenarios
    .filter((s) => (s.outcome === 'passed' || s.outcome === 'flaky') && pastOutcomes(s.id)[0]?.code === 'f')
    .map(({ id, title, project, feature }) => ({ id, title, project, feature }));

  return {
    historyDir: input.historyDir,
    maxRuns: input.maxRuns,
    ...(input.notRecordedReason ? { notRecordedReason: input.notRecordedReason } : {}),
    points: [...earlier.map((e) => pointFrom(e, false, true)), pointFrom(currentEntry, true, recorded)],
    featureHealth,
    regressions,
    fixed,
  };
}

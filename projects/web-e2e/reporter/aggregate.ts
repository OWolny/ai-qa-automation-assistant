// Pure aggregation: turns collected ScenarioRecords into the RunReport statistics.
// No Playwright imports, so every rule here can be checked in isolation.

import {
  SCHEMA_VERSION,
  SEVERITIES,
  UNCLASSIFIED,
  type BusinessStatus,
  type DurationStats,
  type FailureCategory,
  type GroupStats,
  type MatrixCell,
  type OutcomeCounts,
  type ReliabilityStats,
  type RunMetadata,
  type RunReport,
  type ScenarioError,
  type ScenarioRecord,
} from './model';

const SLOWEST_COUNT = 10;
const REASON_EXAMPLES = 3;

export function countOutcomes(scenarios: readonly ScenarioRecord[]): OutcomeCounts {
  const counts = { total: scenarios.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const scenario of scenarios) counts[scenario.outcome]++;
  const executed = counts.passed + counts.failed + counts.flaky;
  const didNotRun = scenarios.filter((s) => s.didNotRun).length;
  return { ...counts, didNotRun, executed, passRate: ratio(counts.passed, executed) };
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Median of the values; the mean of the two middle values for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Nearest-rank percentile: the smallest value with at least p% of values at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(rank, 1) - 1]!;
}

function groupStats(
  scenarios: readonly ScenarioRecord[],
  key: (scenario: ScenarioRecord) => string,
  order?: readonly string[],
): GroupStats[] {
  const groups = new Map<string, ScenarioRecord[]>();
  for (const name of order ?? []) groups.set(name, []);
  for (const scenario of scenarios) {
    const name = key(scenario);
    const group = groups.get(name);
    if (group) group.push(scenario);
    else groups.set(name, [scenario]);
  }
  const stats = [...groups]
    .filter(([, members]) => members.length > 0)
    .map(([name, members]) => ({
      name,
      ...countOutcomes(members),
      durationMs: sum(executedOnly(members).map((s) => s.durationMs)),
    }));
  // Explicit order (e.g. severity, config project order) wins; otherwise alphabetical, Unclassified last.
  if (order) return stats;
  return stats.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
}

function sortKey(name: string): string {
  return name === UNCLASSIFIED ? '￿' : name;
}

function executedOnly(scenarios: readonly ScenarioRecord[]): ScenarioRecord[] {
  return scenarios.filter((s) => s.outcome !== 'skipped');
}

function buildMatrix(scenarios: readonly ScenarioRecord[]): MatrixCell[] {
  const cells = new Map<string, { feature: string; project: string; members: ScenarioRecord[] }>();
  for (const scenario of scenarios) {
    const id = JSON.stringify([scenario.feature, scenario.project]);
    const cell = cells.get(id) ?? { feature: scenario.feature, project: scenario.project, members: [] };
    cell.members.push(scenario);
    cells.set(id, cell);
  }
  return [...cells.values()].map(({ feature, project, members }) => ({
    feature,
    project,
    ...countOutcomes(members),
  }));
}

function buildDurations(scenarios: readonly ScenarioRecord[], wallClockMs: number): DurationStats {
  const executed = executedOnly(scenarios);
  const durations = executed.map((s) => s.durationMs);
  const byFeature = groupStats(executed, (s) => s.feature).map((group) => ({
    name: group.name,
    totalMs: group.durationMs,
    averageMs: group.durationMs / group.executed,
    count: group.executed,
  }));
  return {
    wallClockMs,
    cumulativeMs: sum(durations),
    averageMs: durations.length === 0 ? null : sum(durations) / durations.length,
    medianMs: median(durations),
    p95Ms: percentile(durations, 95),
    slowest: [...executed]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, SLOWEST_COUNT)
      .map(({ id, title, project, feature, durationMs }) => ({ id, title, project, feature, durationMs })),
    byFeature: byFeature.sort((a, b) => b.totalMs - a.totalMs),
  };
}

function buildReliability(scenarios: readonly ScenarioRecord[], retriesConfigured: number): ReliabilityStats {
  const counts = countOutcomes(scenarios);
  return {
    retriesConfigured,
    stable: counts.passed,
    flaky: counts.flaky,
    failedAfterRetries: scenarios.filter((s) => s.outcome === 'failed' && s.attemptCount > 1).length,
    flakyRate: ratio(counts.flaky, counts.executed),
  };
}

const NETWORK_ERROR = /net::ERR_|NS_ERROR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|getaddrinfo/;
const EXPECT_FAILURE = /^\s*(Error:\s*)?expect(\.soft|\.poll)?\(/m;
const ACTION_TIMEOUT = /Timeout \d+ms exceeded/;

/**
 * Deterministic failure category, checked in this order:
 * 1. Setup / teardown: the failing step was a hook or fixture (before/after the test body).
 * 2. Timeout: the attempt hit the test timeout.
 * 3. Navigation / network: the error text carries a browser or Node network error code.
 * 4. Assertion: an expect() failed (including expect timeouts, which are still assertion failures).
 * 5. Timeout: an action timed out (e.g. "locator.click: Timeout 5000ms exceeded").
 * 6. Other.
 */
export function classifyFailure(input: {
  attemptStatus: string;
  failedInHookOrFixture: boolean;
  messages: readonly string[];
}): FailureCategory {
  if (input.failedInHookOrFixture) return 'Setup / teardown';
  if (input.attemptStatus === 'timedOut') return 'Timeout';
  const text = input.messages.join('\n');
  if (NETWORK_ERROR.test(text)) return 'Navigation / network';
  if (EXPECT_FAILURE.test(text)) return 'Assertion';
  if (ACTION_TIMEOUT.test(text)) return 'Timeout';
  return 'Other';
}

function describeScenarios(scenarios: readonly ScenarioRecord[]): string {
  const names = scenarios.slice(0, REASON_EXAMPLES).map((s) => `"${s.title}" (${s.project})`);
  const more = scenarios.length - names.length;
  return names.join(', ') + (more > 0 ? ` and ${more} more` : '');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Overall business status, from observable rules only:
 * - Critical: at least one critical-severity scenario failed.
 * - Attention Required: otherwise, if any scenario failed, was flaky, or did not run although it was not
 *   intentionally skipped; the run did not finish normally (interrupted, timed out, or errors outside
 *   tests); or no scenario executed.
 * - Healthy: otherwise. Intentionally skipped scenarios (test.skip) do not change the status.
 */
export function deriveStatus(
  scenarios: readonly ScenarioRecord[],
  runStatus: string,
  runErrorCount: number,
): BusinessStatus {
  const failed = scenarios.filter((s) => s.outcome === 'failed');
  const criticalFailed = failed.filter((s) => s.severity === 'critical');
  const otherFailed = failed.filter((s) => s.severity !== 'critical');
  const flaky = scenarios.filter((s) => s.outcome === 'flaky');
  const notRun = scenarios.filter((s) => s.didNotRun);
  const criticalNotRun = notRun.filter((s) => s.severity === 'critical');
  const executed = executedOnly(scenarios).length;

  const reasons: string[] = [];
  if (criticalFailed.length > 0) {
    reasons.push(`${plural(criticalFailed.length, 'critical scenario')} failed: ${describeScenarios(criticalFailed)}.`);
  }
  if (otherFailed.length > 0) {
    reasons.push(`${plural(otherFailed.length, 'non-critical scenario')} failed: ${describeScenarios(otherFailed)}.`);
  }
  if (flaky.length > 0) {
    reasons.push(`${plural(flaky.length, 'scenario')} passed only after a retry (flaky): ${describeScenarios(flaky)}.`);
  }
  if (criticalNotRun.length > 0) {
    reasons.push(
      `${plural(criticalNotRun.length, 'critical scenario')} did not run, so ${criticalNotRun.length === 1 ? 'its journey is' : 'their journeys are'} unverified: ${describeScenarios(criticalNotRun)}.`,
    );
  }
  if (notRun.length > criticalNotRun.length) {
    reasons.push(
      `${plural(notRun.length - criticalNotRun.length, 'other scenario')} did not run (for example a dependency or beforeAll hook failed).`,
    );
  }
  if (runStatus === 'interrupted' || runStatus === 'timedout') {
    reasons.push(`The run did not finish normally (status: ${runStatus}); results may be incomplete.`);
  }
  if (runErrorCount > 0) {
    reasons.push(
      scenarios.length === 0
        ? `${plural(runErrorCount, 'error')} occurred outside any test and no scenarios were collected.`
        : `${plural(runErrorCount, 'error')} occurred outside any test; some scenarios may be missing.`,
    );
  }
  if (executed === 0) {
    reasons.push('No scenario was executed, so this run verified nothing.');
  }

  if (criticalFailed.length > 0) return { level: 'critical', label: 'Critical', reasons };
  if (reasons.length > 0) return { level: 'attention', label: 'Attention Required', reasons };
  return {
    level: 'healthy',
    label: 'Healthy',
    reasons: [`All ${plural(executed, 'executed scenario')} passed on the first attempt.`],
  };
}

export function buildReport(input: {
  run: RunMetadata;
  scenarios: ScenarioRecord[];
  retriesConfigured: number;
  wallClockMs: number;
  runErrors: ScenarioError[];
}): RunReport {
  const { scenarios } = input;
  const summary = countOutcomes(scenarios);
  const critical = scenarios.filter((s) => s.severity === 'critical');
  const categoryCounts = new Map<FailureCategory, number>();
  for (const scenario of scenarios) {
    if (scenario.outcome === 'failed' && scenario.failureCategory) {
      categoryCounts.set(scenario.failureCategory, (categoryCounts.get(scenario.failureCategory) ?? 0) + 1);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    run: input.run,
    status: deriveStatus(scenarios, input.run.runStatus, input.runErrors.length),
    summary: { ...summary, criticalTotal: critical.length },
    critical: countOutcomes(critical),
    bySeverity: groupStats(scenarios, (s) => s.severity, [...SEVERITIES, UNCLASSIFIED]),
    features: groupStats(scenarios, (s) => s.feature),
    capabilities: groupStats(scenarios, (s) => s.capability),
    projects: groupStats(scenarios, (s) => s.project, input.run.projects),
    layers: groupStats(scenarios, (s) => s.layer),
    matrix: buildMatrix(scenarios),
    durations: buildDurations(scenarios, input.wallClockMs),
    reliability: buildReliability(scenarios, input.retriesConfigured),
    failureCategories: [...categoryCounts]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    runErrors: input.runErrors,
    scenarios,
  };
}

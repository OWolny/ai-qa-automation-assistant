// HTML renderer of the Business QA Dashboard.
// Turns a fully aggregated RunReport into one self-contained, offline HTML document.
// It displays what the model provides and never recomputes statistics.
// Every interpolated value goes through the `html` tagged template, which escapes by default.

import fs from 'node:fs';
import path from 'node:path';
import {
  OUTCOMES,
  SEVERITIES,
  UNCLASSIFIED,
  type Attachment,
  type GroupStats,
  type MatrixCell,
  type Outcome,
  type Regression,
  type RunReport,
  type ScenarioError,
  type ScenarioRecord,
  type StatusLevel,
  type TrendPoint,
  type Trends,
} from './model';

// ---------------------------------------------------------------------------------------------
// Safe HTML building

class Raw {
  constructor(readonly value: string) {}
}

type Part = Raw | string | number | boolean | null | undefined | readonly Part[];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function toHtml(part: Part): string {
  if (part === null || part === undefined || typeof part === 'boolean') return '';
  if (typeof part === 'string') return esc(part);
  if (typeof part === 'number') return esc(String(part));
  if (part instanceof Raw) return part.value;
  return (part as readonly Part[]).map(toHtml).join('');
}

/** Tagged template: literal parts are trusted markup, every interpolation is escaped unless it is Raw. */
function html(strings: TemplateStringsArray, ...values: Part[]): Raw {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + (strings[i + 1] ?? '');
  return new Raw(out);
}

/** Relative artifact path -> URL usable in href/src, or null when it is not a plain relative path. */
function artifactUrl(p: string): string | null {
  if (!p || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) || p.startsWith('/') || p.startsWith('\\')) return null;
  return p
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** DOM id of a scenario's explorer row. */
function scenarioDomId(id: string): string {
  return `scenario-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

// ---------------------------------------------------------------------------------------------
// Formatting

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  let pct = Math.round(value * 1000) / 10;
  // Never round a non-perfect rate up to 100% or a non-zero rate down to 0%.
  if (pct >= 100 && value < 1) pct = 99.9;
  if (pct <= 0 && value > 0) pct = 0.1;
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return 'n/a';
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 59.95) return `${seconds.toFixed(1).replace(/\.0$/, '')} s`;
  const total = Math.round(seconds);
  if (total < 3600) return `${Math.floor(total / 60)} m ${pad2(total % 60)} s`;
  const minutes = Math.round(total / 60);
  return `${Math.floor(minutes / 60)} h ${pad2(minutes % 60)} m`;
}

function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** UTC text rendered on the server; the page script swaps it for the viewer's local time. */
function timestamp(iso: string | undefined, mode: 'datetime' | 'time' = 'datetime'): Raw {
  if (!iso) return html`<span class="muted">unavailable</span>`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return html`${iso}`;
  const text =
    mode === 'time'
      ? `${d.toISOString().slice(11, 19)} UTC`
      : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return html`<time datetime="${d.toISOString()}" data-local="${mode}">${text}</time>`;
}

function plural(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------------------------
// Small visual vocabulary

const ICON_PATHS: Record<string, string> = {
  check: 'M3.5 8.5l3 3 6-7',
  cross: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  wave: 'M2 9.5c1.6-3.2 3.4-3.2 5 0s3.4 3.2 5 0 2-2.2 2-2.2',
  minus: 'M4 8h8',
  alert: 'M8 3.5v5.5M8 12v.5',
  dash: 'M5 8h6',
};

function icon(name: keyof typeof ICON_PATHS & string): Raw {
  const d = ICON_PATHS[name] ?? '';
  return html`<svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

const OUTCOME_LABEL: Record<Outcome, string> = { passed: 'Passed', failed: 'Failed', flaky: 'Flaky', skipped: 'Skipped' };
const OUTCOME_ICON: Record<Outcome, string> = { passed: 'check', failed: 'cross', flaky: 'wave', skipped: 'minus' };
const LEVEL_ICON: Record<StatusLevel, string> = { healthy: 'check', attention: 'alert', critical: 'cross' };

function outcomeChip(outcome: Outcome): Raw {
  return html`<span class="chip o-${outcome}">${icon(OUTCOME_ICON[outcome])}${OUTCOME_LABEL[outcome]}</span>`;
}

function severityBadge(severity: string): Raw {
  const known = (SEVERITIES as readonly string[]).includes(severity);
  const cls = known ? `sev-${severity}` : 'sev-unclassified';
  return html`<span class="sev ${cls}" title="Severity">${severity}</span>`;
}

function emptyState(text: string, tone: 'neutral' | 'good' = 'neutral'): Raw {
  return html`<div class="empty ${tone === 'good' ? 'empty-good' : ''}">${tone === 'good' ? icon('check') : ''}<span>${text}</span></div>`;
}

function scenarioLink(id: string, text: string): Raw {
  return html`<a class="scn-link" href="#${scenarioDomId(id)}">${text}</a>`;
}

function sectionHead(title: string, subtitle?: string): Raw {
  return html`<header class="card-head"><h2>${title}</h2>${subtitle ? html`<p class="card-sub">${subtitle}</p>` : ''}</header>`;
}

// ---------------------------------------------------------------------------------------------
// Sections

const NAV: [string, string][] = [
  ['overview', 'Overview'],
  ['critical', 'Critical path'],
  ['trends', 'Trends'],
  ['health', 'Health'],
  ['matrix', 'Browsers'],
  ['reliability', 'Reliability'],
  ['durations', 'Durations'],
  ['failures', 'Failures'],
  ['explorer', 'Scenarios'],
  ['definitions', 'Definitions'],
];

function renderHeader(report: RunReport): Raw {
  return html`<header class="topbar">
  <div class="wrap topbar-inner">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div><h1>Business QA Dashboard</h1><p class="brand-sub">Run ${timestamp(report.run.startedAt)}</p></div>
    </div>
    <nav class="nav" aria-label="Sections">${NAV.filter(([id]) => id !== 'trends' || report.trends).map(([id, label]) => html`<a href="#${id}">${label}</a>`)}<a class="nav-json" href="run.json" title="Raw run model (JSON)">run.json</a></nav>
  </div>
</header>`;
}

function kpi(label: string, value: string, sub: Part, tone = ''): Raw {
  return html`<div class="kpi ${tone}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

function renderRunErrors(errors: ScenarioError[]): Raw {
  if (errors.length === 0) return html``;
  return html`<section class="card run-errors" aria-labelledby="run-errors-title">
  <div class="run-errors-head">${icon('alert')}<h2 id="run-errors-title">${plural(errors.length, 'error', 'errors')} occurred outside tests — some scenarios may be missing from this report</h2></div>
  <ul class="plain">${errors.map(
    (e) => html`<li><p class="err-summary">${e.summary || 'Unknown error'}</p>${errorDetails(e, 'Technical details')}</li>`,
  )}</ul>
</section>`;
}

function renderExecutive(report: RunReport): Raw {
  const { status, summary, critical, durations, run } = report;
  const criticalSub =
    critical.total === 0
      ? 'no critical scenarios'
      : critical.passRate === null
        ? 'all critical scenarios skipped'
        : `${formatInt(critical.passed)}/${formatInt(critical.executed)} critical passed`;
  const criticalValue = critical.total === 0 ? 'n/a' : formatPercent(critical.passRate);

  const kpis = [
    kpi('Total scenarios', formatInt(summary.total), `${formatInt(summary.executed)} executed`),
    kpi('Passed', formatInt(summary.passed), html`${icon('check')} of ${formatInt(summary.executed)} executed`, 'k-passed'),
    kpi('Failed', formatInt(summary.failed), html`${icon('cross')} ${report.reliability.retriesConfigured > 0 ? 'after all retries' : 'retries disabled'}`, summary.failed > 0 ? 'k-failed k-hot' : 'k-failed'),
    kpi('Flaky', formatInt(summary.flaky), html`${icon('wave')} passed only on retry`, summary.flaky > 0 ? 'k-flaky k-hot' : 'k-flaky'),
    kpi('Skipped', formatInt(summary.skipped), html`${icon('minus')} ${summary.didNotRun > 0 ? `${formatInt(summary.didNotRun)} did not run` : 'not executed'}`, 'k-skipped'),
    kpi('Pass rate', formatPercent(summary.passRate), 'passed / executed', 'k-rate'),
    kpi('Critical pass rate', criticalValue, criticalSub, critical.failed > 0 ? 'k-rate k-crit' : 'k-rate'),
    kpi('Duration', formatDuration(durations.wallClockMs), `wall clock · ${formatDuration(durations.cumulativeMs)} cumulative`),
  ];

  const meta: [string, Part][] = [];
  meta.push(['Environment', run.baseURL ? html`<span class="mono">${run.baseURL}</span>` : html`<span class="muted">unavailable</span>`]);
  if (run.git?.branch) meta.push(['Branch', html`<span class="mono">${run.git.branch}</span>`]);
  if (run.git?.commit) {
    meta.push([
      'Commit',
      html`<span class="mono" title="${run.git.commit}">${run.git.commit.slice(0, 8)}</span>${
        run.git.dirty ? html` <span class="tag tag-warn" title="The working tree had uncommitted changes">dirty</span>` : ''
      }`,
    ]);
  }
  if (!run.git?.branch && !run.git?.commit) meta.push(['Git', html`<span class="muted">unavailable</span>`]);
  meta.push(['Started', timestamp(run.startedAt)]);
  meta.push([
    'Run status',
    run.runStatus === 'passed' || run.runStatus === 'failed'
      ? run.runStatus
      : html`<span class="tag tag-warn">${run.runStatus || 'unknown'}</span>`,
  ]);
  meta.push(['Playwright', run.playwrightVersion || 'unavailable']);
  meta.push(['Node', run.nodeVersion || 'unavailable']);
  meta.push(['OS', run.os || 'unavailable']);
  meta.push(['Projects', run.projects.length ? run.projects.join(', ') : 'unavailable']);
  meta.push(['Workers', formatInt(run.workers)]);
  meta.push(['Mode', run.ci ? 'CI' : 'Local']);
  if (run.shard) meta.push(['Shard', `${run.shard.current} of ${run.shard.total}`]);

  return html`<section id="overview" class="section" aria-label="Executive summary">
  ${renderRunErrors(report.runErrors)}
  <div class="grid exec">
    <div class="card status-card lvl-${status.level}">
      <h2 class="status-eyebrow">Overall status</h2>
      <div class="status-badge">${icon(LEVEL_ICON[status.level])}<span>${status.label}</span></div>
      ${
        status.reasons.length
          ? html`<ul class="reasons">${status.reasons.map((r) => html`<li>${r}</li>`)}</ul>`
          : html`<p class="reasons-none">No issues detected in this run.</p>`
      }${trendHint(report.trends)}
    </div>
    <div class="kpis">${kpis}</div>
  </div>
  <dl class="card meta-strip">${meta.map(([k, v]) => html`<div class="meta-item"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
</section>`;
}

function renderCritical(report: RunReport): Raw {
  const c = report.critical;
  const failedCritical = report.scenarios.filter((s) => s.severity === 'critical' && s.outcome === 'failed');
  let body: Raw;
  if (c.total === 0) {
    body = emptyState('No scenarios are marked with severity "critical" in this run, so there is no critical path to report.');
  } else {
    body = html`<div class="mini-stats">
      ${miniStat('Critical scenarios', formatInt(c.total))}
      ${miniStat('Passed', formatInt(c.passed), 'o-passed', 'check')}
      ${miniStat('Failed', formatInt(c.failed), 'o-failed', 'cross')}
      ${miniStat('Flaky', formatInt(c.flaky), 'o-flaky', 'wave')}
      ${miniStat('Pass rate', formatPercent(c.passRate))}
    </div>
    ${
      c.failed > 0
        ? html`<div class="alert alert-critical">
        <h3 class="alert-title">${icon('cross')}${plural(c.failed, 'critical scenario failed', 'critical scenarios failed')} — a core user journey is blocked</h3>
        <ul class="alert-list">${failedCritical.map(
          (s) => html`<li>${scenarioLink(s.id, s.title)} <span class="muted">· ${s.feature} · ${s.project}</span></li>`,
        )}</ul>
      </div>`
        : html`<div class="alert alert-good">${icon('check')}No critical scenario failed.${
            c.flaky > 0 ? ` ${plural(c.flaky, 'critical scenario was', 'critical scenarios were')} flaky.` : ''
          }</div>`
    }${
      c.didNotRun > 0
        ? html`<div class="alert alert-warn">${icon('minus')}${plural(c.didNotRun, 'critical scenario', 'critical scenarios')} did not run, so ${c.didNotRun === 1 ? 'its journey is' : 'their journeys are'} unverified.
        <ul class="alert-list">${report.scenarios
          .filter((s) => s.severity === 'critical' && s.didNotRun)
          .map((s) => html`<li>${scenarioLink(s.id, s.title)} <span class="muted">· ${s.feature} · ${s.project}</span></li>`)}</ul>
      </div>`
        : ''
    }`;
  }
  return html`<section id="critical" class="card section span-6">
  ${sectionHead('Critical path', 'Scenarios with severity "critical": core user journeys.')}
  ${body}
</section>`;
}

function miniStat(label: string, value: string, tone = '', iconName?: string): Raw {
  return html`<div class="mini ${tone}"><div class="mini-label">${iconName ? icon(iconName) : ''}${label}</div><div class="mini-value">${value}</div></div>`;
}

function renderDistribution(report: RunReport): Raw {
  const s = report.summary;
  const order: Outcome[] = ['passed', 'flaky', 'failed', 'skipped'];
  let body: Raw;
  if (s.total === 0) {
    body = emptyState('No scenarios ran in this report.');
  } else {
    const r = 60;
    const circumference = 2 * Math.PI * r;
    const nonZero = order.filter((o) => s[o] > 0).length;
    const gap = nonZero > 1 ? 2.5 : 0;
    let offset = 0;
    const arcs = order.map((o) => {
      const count = s[o];
      if (count <= 0) return html``;
      const len = (count / s.total) * circumference;
      const drawn = Math.max(len - gap, 0.5);
      const arc = html`<circle class="arc a-${o}" r="${r}" cx="80" cy="80" stroke-dasharray="${drawn.toFixed(2)} ${(circumference - drawn).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${OUTCOME_LABEL[o]}: ${formatInt(count)} (${formatPercent(count / s.total)})</title></circle>`;
      offset += len;
      return arc;
    });
    body = html`<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 160 160" role="img" aria-label="Status distribution: ${order.map((o) => `${OUTCOME_LABEL[o]} ${s[o]}`).join(', ')}">
        <circle class="donut-track" r="${r}" cx="80" cy="80"/>
        <g transform="rotate(-90 80 80)">${arcs}</g>
        <text x="80" y="78" class="donut-total">${formatInt(s.total)}</text>
        <text x="80" y="97" class="donut-caption">scenarios</text>
      </svg>
      <table class="legend">
        <thead><tr><th scope="col">Outcome</th><th scope="col" class="num">Count</th><th scope="col" class="num">Share</th></tr></thead>
        <tbody>${order.map(
          (o) => html`<tr><th scope="row"><span class="swatch sw-${o}"></span>${icon(OUTCOME_ICON[o])}${OUTCOME_LABEL[o]}</th><td class="num">${formatInt(s[o])}</td><td class="num">${formatPercent(s[o] / s.total)}</td></tr>`,
        )}</tbody>
      </table>
    </div>`;
  }
  return html`<section id="distribution" class="card section span-6">
  ${sectionHead('Status distribution', 'Final outcome of every scenario, share of total.')}
  ${body}
</section>`;
}

// ---------------------------------------------------------------------------------------------
// Trends (history across recorded runs). Values come from report.trends; the only arithmetic
// here is display formatting (chart geometry and the difference between two shown values).

const LEVEL_LABEL: Record<StatusLevel, string> = { healthy: 'Healthy', attention: 'Attention Required', critical: 'Critical' };

const KIND_LABEL: Record<Regression['kind'], string> = { 'new-failure': 'New failure', ongoing: 'Ongoing', 'new-scenario': 'New scenario' };
const KIND_ICON: Record<Regression['kind'], string> = { 'new-failure': 'alert', ongoing: 'cross', 'new-scenario': 'dash' };
const KIND_RANK: Record<Regression['kind'], number> = { 'new-failure': 0, ongoing: 1, 'new-scenario': 2 };

function shortCommit(commit: string | undefined): string | undefined {
  return commit ? commit.slice(0, 8) : undefined;
}

function commitText(commit: string | undefined): Raw {
  return commit ? html`<span class="mono" title="${commit}">${shortCommit(commit)}</span>` : html`<span class="muted">no commit</span>`;
}

function isoDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function isoMinute(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** One-line description of a point, for tooltips. */
function pointCaption(p: TrendPoint): string {
  const parts = [isoMinute(p.startedAt), p.commit ? `commit ${shortCommit(p.commit)}` : 'no commit', LEVEL_LABEL[p.status]];
  if (p.current) parts.push(p.recorded ? 'this run' : 'this run (not recorded)');
  return parts.join(' · ');
}

function trendHint(trends: Trends | undefined): Raw {
  if (!trends) return html``;
  const n = trends.regressions.filter((r) => r.kind === 'new-failure').length;
  if (n === 0) return html``;
  return html`<a class="status-trend" href="#trends">${icon('alert')}${plural(n, 'new failure', 'new failures')}: passed the last time ${n === 1 ? 'it' : 'they'} ran</a>`;
}

type ChartKind = 'rate' | 'duration';

interface ChartSeries {
  name: string;
  /** CSS modifier for the stroke/marker colour. */
  cls: 's1' | 's2';
  values: (number | null)[];
}

const CHART = { w: 320, h: 142, left: 46, right: 12, top: 10, bottom: 24 } as const;

/** Round an axis maximum up to 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k (display scale only). */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1000;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function formatValue(kind: ChartKind, v: number | null): string {
  return kind === 'rate' ? formatPercent(v) : formatDuration(v);
}

/**
 * Small-multiple line chart over run order. Null values leave a gap; `na` points (e.g. retries
 * disabled) are gaps with a shaded band. The current run's marker is hollow when it is not recorded.
 */
function lineChart(points: TrendPoint[], kind: ChartKind, series: ChartSeries[], ariaLabel: string, na: boolean[] = []): Raw {
  const n = points.length;
  const pw = CHART.w - CHART.left - CHART.right;
  const ph = CHART.h - CHART.top - CHART.bottom;
  const step = n > 1 ? pw / (n - 1) : pw;
  const x = (i: number): number => CHART.left + (n > 1 ? i * step : pw / 2);
  const all = series.flatMap((s) => s.values.filter((v, i): v is number => v !== null && Number.isFinite(v) && !na[i]));
  const max = kind === 'rate' ? 1 : niceCeil(Math.max(0, ...all));
  const y = (v: number): number => CHART.top + ph - (Math.min(Math.max(v, 0), max) / max) * ph;
  const f1 = (v: number): string => v.toFixed(1);
  const ticks = [0, max / 2, max];
  const tickLabel = (t: number): string => (kind === 'rate' ? `${Math.round(t * 100)}%` : t === 0 ? '0' : formatDuration(t));
  const valueAt = (s: ChartSeries, i: number): number | null => {
    const v = s.values[i];
    return v === null || v === undefined || !Number.isFinite(v) || na[i] ? null : v;
  };
  const showAllMarkers = n <= 24;

  const grid = ticks.map(
    (t) => html`<line class="tr-grid" x1="${CHART.left}" x2="${CHART.left + pw}" y1="${f1(y(t))}" y2="${f1(y(t))}"/><text class="tr-axis" x="${CHART.left - 6}" y="${f1(y(t) + 3.5)}" text-anchor="end">${tickLabel(t)}</text>`,
  );
  const bands = points.map((_, i) =>
    na[i]
      ? html`<rect class="tr-na" x="${f1(Math.max(CHART.left, x(i) - step / 2))}" y="${CHART.top}" width="${f1(Math.min(x(i) + step / 2, CHART.left + pw) - Math.max(CHART.left, x(i) - step / 2))}" height="${ph}"/>`
      : '',
  );
  const lines = series.map((s) => {
    let d = '';
    let open = false;
    points.forEach((_, i) => {
      const v = valueAt(s, i);
      if (v === null) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))}`;
      open = true;
    });
    return d ? html`<path class="tr-line ${s.cls}" d="${d}"/>` : '';
  });
  const markers = series.map((s) =>
    points.map((p, i) => {
      const v = valueAt(s, i);
      if (v === null) return '';
      const isolated = valueAt(s, i - 1) === null && valueAt(s, i + 1) === null;
      if (!showAllMarkers && !p.current && !isolated) return '';
      const hollow = p.current && !p.recorded;
      return html`<circle class="tr-dot ${s.cls} ${hollow ? 'hollow' : ''} ${p.current ? 'cur' : ''}" cx="${f1(x(i))}" cy="${f1(y(v))}" r="${p.current ? 4.5 : 4}"/>`;
    }),
  );
  const hits = points.map((p, i) => {
    const x0 = Math.max(CHART.left, x(i) - step / 2);
    const x1 = Math.min(CHART.left + pw, x(i) + step / 2);
    const values = series.map((s) => `${s.name}: ${na[i] ? 'n/a (retries disabled)' : formatValue(kind, s.values[i] ?? null)}`);
    return html`<rect class="tr-hit" x="${f1(x0)}" y="${CHART.top}" width="${f1(Math.max(x1 - x0, 1))}" height="${ph}"><title>${[pointCaption(p), ...values].join('\n')}</title></rect>`;
  });
  const first = points[0];
  const last = points[n - 1];
  const xLabels =
    first && last
      ? n > 1
        ? html`<text class="tr-axis" x="${CHART.left}" y="${CHART.h - 6}" text-anchor="start">${isoDate(first.startedAt)}</text><text class="tr-axis" x="${CHART.left + pw}" y="${CHART.h - 6}" text-anchor="end">${isoDate(last.startedAt)}</text>`
        : html`<text class="tr-axis" x="${f1(x(0))}" y="${CHART.h - 6}" text-anchor="middle">${isoDate(first.startedAt)}</text>`
      : '';
  return html`<svg class="tr-svg" viewBox="0 0 ${CHART.w} ${CHART.h}" role="img" aria-label="${ariaLabel}">${grid}${bands}<line class="tr-baseline" x1="${CHART.left}" x2="${CHART.left + pw}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>${lines}${markers}${hits}${xLabels}</svg>`;
}

/** "▼ 3.6 pts vs previous": the plain difference between the two displayed values. */
function trendDelta(kind: ChartKind, current: number | null, previous: number | null, upIsGood: boolean): Raw {
  if (current === null || !Number.isFinite(current)) return html`<span class="muted">not available in this run</span>`;
  if (previous === null || !Number.isFinite(previous)) return html`<span class="muted">no previous value to compare</span>`;
  const diff = current - previous;
  if (diff === 0) return html`<span class="tr-delta d-flat">no change</span> <span class="muted">vs previous</span>`;
  const tone = diff > 0 === upIsGood ? 'd-good' : 'd-bad';
  const arrow = diff > 0 ? '▲' : '▼';
  let amount: string;
  if (kind === 'rate') {
    const pts = Math.round(Math.abs(diff) * 1000) / 10;
    amount = pts === 0 ? '<0.1 pts' : `${pts.toFixed(1)} pts`;
  } else {
    amount = formatDuration(Math.abs(diff));
  }
  return html`<span class="tr-delta ${tone}"><span aria-hidden="true">${arrow}</span><span class="sr-only">${diff > 0 ? 'up' : 'down'}</span> ${amount}</span> <span class="muted">vs previous</span>`;
}

function chartFigure(title: string, latest: Part, body: Raw, legend: Part = ''): Raw {
  return html`<figure class="tr-chart">
    <figcaption class="tr-chart-head"><span class="tr-chart-title">${title}</span><span class="tr-latest">${latest}</span></figcaption>
    ${legend}
    ${body}
  </figure>`;
}

function seriesKey(cls: ChartSeries['cls'], label: string): Raw {
  return html`<span><svg class="tr-key" viewBox="0 0 18 10" aria-hidden="true" focusable="false"><line class="tr-line ${cls}" x1="1" x2="17" y1="5" y2="5"/><circle class="tr-dot ${cls}" cx="9" cy="5" r="3"/></svg>${label}</span>`;
}

function renderTrendCharts(t: Trends): Raw {
  const pts = t.points;
  const cur = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (!cur || !prev) return html``;
  const n = pts.length;
  // An unrecorded run with a different scenario count (e.g. a filtered local run) is not comparable.
  const comparable = cur.recorded || cur.total === prev.total;
  const delta = (kind: ChartKind, c: number | null, p: number | null, upIsGood: boolean): Raw =>
    comparable
      ? trendDelta(kind, c, p, upIsGood)
      : html`<span class="muted">not compared: ${formatInt(cur.total)} vs ${formatInt(prev.total)} scenarios</span>`;
  const latestRate = (label: string, c: number | null, p: number | null, upIsGood: boolean, kind: ChartKind = 'rate'): Raw =>
    html`<strong>${formatValue(kind, c)}</strong> ${delta(kind, c, p, upIsGood)}<span class="sr-only"> (${label})</span>`;

  const passChart = chartFigure(
    'Pass rate',
    latestRate('pass rate', cur.passRate, prev.passRate, true),
    lineChart(pts, 'rate', [{ name: 'Pass rate', cls: 's1', values: pts.map((p) => p.passRate) }], `Pass rate over ${n} runs, latest ${formatPercent(cur.passRate)}`),
  );
  const critChart = chartFigure(
    'Critical pass rate',
    latestRate('critical pass rate', cur.criticalPassRate, prev.criticalPassRate, true),
    lineChart(pts, 'rate', [{ name: 'Critical pass rate', cls: 's1', values: pts.map((p) => p.criticalPassRate) }], `Critical pass rate over ${n} runs, latest ${formatPercent(cur.criticalPassRate)}`),
  );

  const na = pts.map((p) => p.retriesConfigured === 0);
  let flakyChart: Raw;
  if (na.every(Boolean)) {
    flakyChart = chartFigure(
      'Flaky rate',
      html`<strong>n/a</strong>`,
      html`<div class="note note-warn tr-note">${icon('alert')}<span>Retries were disabled in these runs; flakiness cannot be detected.</span></div>`,
    );
  } else {
    const flakyVal = (p: TrendPoint): number | null => (p.retriesConfigured === 0 ? null : p.flakyRate);
    flakyChart = chartFigure(
      'Flaky rate',
      cur.retriesConfigured === 0
        ? html`<strong>n/a</strong> <span class="muted">retries disabled in this run</span>`
        : latestRate('flaky rate', flakyVal(cur), flakyVal(prev), false),
      lineChart(pts, 'rate', [{ name: 'Flaky rate', cls: 's1', values: pts.map(flakyVal) }], `Flaky rate over ${n} runs, latest ${cur.retriesConfigured === 0 ? 'n/a' : formatPercent(cur.flakyRate)}`, na),
      na.some(Boolean) ? html`<div class="chart-legend tr-legend"><span><span class="tr-na-key" aria-hidden="true"></span>n/a: retries disabled in that run</span></div>` : '',
    );
  }

  const durChart = chartFigure(
    'Duration',
    html`<strong>${formatDuration(cur.wallClockMs)}</strong> ${delta('duration', cur.wallClockMs, prev.wallClockMs, false)}<span class="sr-only"> (wall clock)</span>`,
    lineChart(
      pts,
      'duration',
      [
        { name: 'Wall clock', cls: 's1', values: pts.map((p) => p.wallClockMs) },
        { name: 'p95 scenario', cls: 's2', values: pts.map((p) => p.p95Ms) },
      ],
      `Duration over ${n} runs, latest wall clock ${formatDuration(cur.wallClockMs)}, p95 scenario ${formatDuration(cur.p95Ms)}`,
    ),
    html`<div class="chart-legend tr-legend">${seriesKey('s1', `Wall clock · ${formatDuration(cur.wallClockMs)}`)}${seriesKey('s2', `p95 scenario · ${formatDuration(cur.p95Ms)}`)}</div>`,
  );

  return html`<div class="tr-charts">${passChart}${critChart}${flakyChart}${durChart}</div>`;
}

function renderStatusStrip(t: Trends): Raw {
  return html`<div class="tr-strip-wrap">
    <h3 class="sub-h">Run status, oldest to newest</h3>
    <ol class="tr-strip" aria-label="Run status per run, oldest first">${t.points.map(
      (p) => html`<li class="tr-cell lvl-${p.status}${p.current ? ' is-current' : ''}${p.recorded ? '' : ' is-unrecorded'}" title="${pointCaption(p)} · ${plural(p.total, 'scenario', 'scenarios')}">
        <span class="tr-cell-box" aria-hidden="true">${icon(LEVEL_ICON[p.status])}</span>
        <span class="tr-cell-n" aria-hidden="true">${formatInt(p.total)}</span>
        <span class="sr-only">${pointCaption(p)}: ${plural(p.total, 'scenario', 'scenarios')}</span>
      </li>`,
    )}</ol>
    <p class="muted small tr-strip-note">Icon = overall status (${icon('check')} Healthy, ${icon('alert')} Attention Required, ${icon('cross')} Critical); number = scenarios in that run, so scope changes stay visible.</p>
  </div>`;
}

function heatClass(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'hm-na';
  if (v >= 1) return 'hm-5';
  if (v >= 0.95) return 'hm-4';
  if (v >= 0.8) return 'hm-3';
  if (v >= 0.5) return 'hm-2';
  return 'hm-1';
}

function renderHeatmap(t: Trends): Raw {
  if (t.featureHealth.length === 0) return html`<h3 class="sub-h">Feature health over time</h3>${emptyState('No feature data in the recorded runs.')}`;
  const last = t.points.length - 1;
  const latest = (f: Trends['featureHealth'][number]): number | null => f.passRates[last] ?? null;
  const rows = [...t.featureHealth].sort((a, b) => {
    const va = latest(a);
    const vb = latest(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return va - vb;
    return a.feature.localeCompare(b.feature);
  });
  return html`<h3 class="sub-h">Feature health over time</h3>
  <div class="chart-legend tr-heat-legend">
    <span class="muted">Pass rate:</span>
    <span class="hm-key hm-1">&lt; 50%</span><span class="hm-key hm-2">50–79.9%</span><span class="hm-key hm-3">80–94.9%</span><span class="hm-key hm-4">95–99.9%</span><span class="hm-key hm-5">100%</span><span class="hm-key hm-na">— not in run or nothing executed</span>
    <span class="muted">Worst feature (lowest pass rate in this run) first.</span>
  </div>
  <div class="table-scroll tr-heat-scroll" tabindex="0" role="region" aria-label="Feature pass rate per run" data-scroll-end>
    <table class="tr-heat">
      <thead><tr><th scope="col" class="tr-heat-corner">Feature</th>${t.points.map(
        (p) => html`<th scope="col" class="${p.current ? 'is-current' : ''}" title="${pointCaption(p)}"><span>${isoDate(p.startedAt).slice(5)}</span>${p.current ? html`<span class="tr-now">now</span>` : ''}</th>`,
      )}</tr></thead>
      <tbody>${rows.map(
        (f) => html`<tr><th scope="row">${f.feature}</th>${t.points.map((p, i) => {
          const v = f.passRates[i] ?? null;
          return html`<td class="hm ${heatClass(v)}${p.current ? ' is-current' : ''}" title="${f.feature} · ${pointCaption(p)} · pass rate ${formatPercent(v)}">${v === null ? '—' : formatPercent(v)}</td>`;
        })}</tr>`,
      )}</tbody>
    </table>
  </div>`;
}

function sortRegressions(list: Regression[]): Regression[] {
  return [...list].sort(
    (a, b) =>
      Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.title.localeCompare(b.title),
  );
}

function runRef(ref: { startedAt: string; commit?: string }): Raw {
  return html`${timestamp(ref.startedAt)} <span class="muted">(</span>${commitText(ref.commit)}<span class="muted">)</span>`;
}

function renderRegressions(t: Trends): Raw {
  const list = sortRegressions(t.regressions);
  if (list.length === 0) return html`<h3 class="sub-h">Regression tracking</h3>${emptyState('No failing scenarios in this run.', 'good')}`;
  const windowRuns = t.points.length;
  return html`<h3 class="sub-h">Regression tracking</h3>
  <p class="muted small tr-reg-note">Every scenario that failed in this run, placed on the history timeline. Critical first, then new failures.</p>
  <div class="table-scroll">
    <table class="tr-reg">
      <thead><tr><th scope="col">Scenario</th><th scope="col">Severity</th><th scope="col">Kind</th><th scope="col">Failing for</th><th scope="col">Failing since</th><th scope="col">Last passed (incl. flaky)</th></tr></thead>
      <tbody>${list.map((r) => {
        const from = r.lastPassed?.commit;
        const to = r.failingSince.commit;
        const introduced =
          r.lastPassed && from && to
            ? from === to
              ? html`<p class="tr-introduced">Last passed and first failed on the same commit ${commitText(from)}.</p>`
              : html`<p class="tr-introduced">Introduced between commit ${commitText(from)} and ${commitText(to)}.</p>`
            : '';
        const lastPassed = r.lastPassed
          ? runRef(r.lastPassed)
          : r.kind === 'new-scenario'
            ? html`<span class="muted">—</span>`
            : html`<span class="muted">not within the last ${plural(windowRuns, 'run', 'runs')}</span>`;
        return html`<tr class="${r.severity === 'critical' ? 'is-critical' : ''}">
          <td data-label="Scenario" class="tr-reg-title">${scenarioLink(r.id, r.title)}<span class="muted tr-reg-meta">${r.feature} · ${r.project}</span>${introduced}</td>
          <td data-label="Severity">${severityBadge(r.severity)}</td>
          <td data-label="Kind"><span class="chip kind kind-${r.kind}">${icon(KIND_ICON[r.kind])}${KIND_LABEL[r.kind]}</span></td>
          <td data-label="Failing for">${plural(r.failingRuns, 'run', 'runs')}</td>
          <td data-label="Failing since">${runRef(r.failingSince)}</td>
          <td data-label="Last passed">${lastPassed}</td>
        </tr>`;
      })}</tbody>
    </table>
  </div>`;
}

function renderFixed(t: Trends): Raw {
  if (t.fixed.length === 0) return html``;
  return html`<h3 class="sub-h">Fixed: failed the last time they ran</h3>
  <ul class="link-list tr-fixed">${t.fixed.map(
    (f) => html`<li>${icon('check')}${scenarioLink(f.id, f.title)}<span class="muted"> · ${f.feature} · ${f.project}</span></li>`,
  )}</ul>`;
}

function renderTrendTable(t: Trends): Raw {
  return html`<details class="tech tr-table"><summary>Trend data as a table</summary>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Trend data per run">
      <table class="attempts tr-data">
        <thead><tr><th scope="col">Run</th><th scope="col">Commit</th><th scope="col">Status</th><th scope="col" class="num">Scenarios</th><th scope="col" class="num">Executed</th><th scope="col" class="num">Pass rate</th><th scope="col" class="num">Critical pass rate</th><th scope="col" class="num">Flaky rate</th><th scope="col" class="num">Wall clock</th><th scope="col" class="num">Median</th><th scope="col" class="num">p95</th></tr></thead>
        <tbody>${t.points.map(
          (p) => html`<tr><td>${timestamp(p.startedAt)}${p.current ? html` <span class="tag">${p.recorded ? 'this run' : 'this run, not recorded'}</span>` : ''}</td><td>${commitText(p.commit)}</td><td>${LEVEL_LABEL[p.status]}</td><td class="num">${formatInt(p.total)}</td><td class="num">${formatInt(p.executed)}</td><td class="num">${formatPercent(p.passRate)}</td><td class="num">${formatPercent(p.criticalPassRate)}</td><td class="num">${p.retriesConfigured === 0 ? 'n/a' : formatPercent(p.flakyRate)}</td><td class="num">${formatDuration(p.wallClockMs)}</td><td class="num">${formatDuration(p.medianMs)}</td><td class="num">${formatDuration(p.p95Ms)}</td></tr>`,
        )}</tbody>
      </table>
    </div>
  </details>`;
}

function renderTrends(report: RunReport): Raw {
  const t = report.trends;
  if (!t) return html``;
  const cur = t.points[t.points.length - 1];
  const notRecorded = cur && !cur.recorded ? `This run is not recorded${t.notRecordedReason ? `: ${t.notRecordedReason}` : ''}.` : '';
  const explain = `Trends use runs recorded in ${t.historyDir} (up to ${t.maxRuns}). Only full-suite runs are recorded; each run keeps a compact summary, not its artifacts.`;
  let body: Raw;
  if (t.points.length <= 1) {
    body = html`<div class="empty tr-empty"><span>Trends appear once at least one earlier run is recorded in history. History lives in <code>${t.historyDir}</code>.${notRecorded ? html`<br>${notRecorded}` : ''}</span></div>
    ${t.regressions.length ? renderRegressions(t) : ''}
    ${renderFixed(t)}`;
  } else {
    body = html`${renderStatusStrip(t)}
    ${
      cur && !cur.recorded
        ? html`<div class="chart-legend tr-legend tr-unrecorded"><span><svg class="tr-key" viewBox="0 0 18 10" aria-hidden="true" focusable="false"><circle class="tr-dot s1 hollow" cx="9" cy="5" r="3.5"/></svg>this run (not recorded${t.notRecordedReason ? `: ${t.notRecordedReason}` : ''})</span><span class="muted">Dashed cell in the status strip, hollow marker in the charts.</span></div>`
        : ''
    }
    ${renderTrendCharts(t)}
    ${renderTrendTable(t)}
    ${renderHeatmap(t)}
    ${renderRegressions(t)}
    ${renderFixed(t)}`;
  }
  return html`<section id="trends" class="card section trends">
  ${sectionHead('Trends', explain)}
  ${body}
</section>`;
}

function sortGroups(groups: GroupStats[]): GroupStats[] {
  return [...groups].sort((a, b) => {
    if (a.passRate === null && b.passRate !== null) return 1;
    if (b.passRate === null && a.passRate !== null) return -1;
    if (a.passRate !== null && b.passRate !== null && a.passRate !== b.passRate) return a.passRate - b.passRate;
    return a.name.localeCompare(b.name);
  });
}

function healthChart(groups: GroupStats[], filterKey: 'feature' | 'capability', noun: string): Raw {
  if (groups.length === 0) return emptyState(`No ${noun} data in this run.`);
  return html`<ul class="hbars">${sortGroups(groups).map((g) => {
    const counts: string[] = [];
    if (g.failed) counts.push(`${formatInt(g.failed)} failed`);
    if (g.flaky) counts.push(`${formatInt(g.flaky)} flaky`);
    if (g.skipped) counts.push(`${formatInt(g.skipped)} skipped`);
    const track =
      g.executed === 0
        ? html`<div class="hbar-track hbar-na" title="All ${formatInt(g.skipped)} scenarios skipped"><span>all skipped</span></div>`
        : html`<div class="hbar-track" role="img" aria-label="${g.name}: ${g.passed} passed, ${g.flaky} flaky, ${g.failed} failed of ${g.executed} executed">${(['passed', 'flaky', 'failed'] as const).map(
            (o) => (g[o] > 0 ? html`<span class="seg seg-${o}" style="flex-grow:${g[o]}" title="${OUTCOME_LABEL[o]}: ${formatInt(g[o])}"></span>` : ''),
          )}</div>`;
    return html`<li class="hbar">
      <a class="hbar-name" href="#explorer" data-filter-key="${filterKey}" data-filter-value="${g.name}" title="Show these scenarios in the explorer">${g.name}</a>
      ${track}
      <div class="hbar-val"><strong>${formatPercent(g.passRate)}</strong>${
        g.executed > 0 ? html`<span class="muted">${formatInt(g.passed)}/${formatInt(g.executed)}</span>` : ''
      }</div>
      ${counts.length ? html`<div class="hbar-note">${counts.join(' · ')}</div>` : ''}
    </li>`;
  })}</ul>`;
}

function healthLegend(): Raw {
  return html`<div class="chart-legend" aria-hidden="true">${(['passed', 'flaky', 'failed'] as const).map(
    (o) => html`<span><span class="swatch sw-${o}"></span>${OUTCOME_LABEL[o]}</span>`,
  )}<span class="muted">Bar = executed scenarios; value = pass rate (passed/executed)</span></div>`;
}

function renderHealth(report: RunReport): Raw {
  return html`<div id="health" class="grid section-grid">
  <section class="card section span-6" aria-labelledby="h-cap">
    <header class="card-head"><h2 id="h-cap">Business capability health</h2><p class="card-sub">Worst pass rate first. Click a name to filter the scenario explorer.</p></header>
    ${report.capabilities.length ? healthLegend() : ''}
    ${healthChart(report.capabilities, 'capability', 'business capability')}
  </section>
  <section class="card section span-6" aria-labelledby="h-feat">
    <header class="card-head"><h2 id="h-feat">Feature health</h2><p class="card-sub">Worst pass rate first. Click a name to filter the scenario explorer.</p></header>
    ${report.features.length ? healthLegend() : ''}
    ${healthChart(report.features, 'feature', 'feature')}
  </section>
</div>`;
}

function matrixCell(cell: MatrixCell | undefined): Raw {
  if (!cell) return html`<td class="mx mx-none" aria-label="No scenarios"><span class="mx-main">—</span></td>`;
  const title = `${cell.total} scenarios: ${cell.passed} passed, ${cell.flaky} flaky, ${cell.failed} failed, ${cell.skipped} skipped`;
  if (cell.failed > 0) {
    return html`<td class="mx mx-failed" title="${title}"><span class="mx-main">${icon('cross')}${formatInt(cell.failed)} failed</span><span class="mx-sub">${formatInt(cell.passed)}/${formatInt(cell.executed)} passed</span></td>`;
  }
  if (cell.flaky > 0) {
    return html`<td class="mx mx-flaky" title="${title}"><span class="mx-main">${icon('wave')}${formatInt(cell.flaky)} flaky</span><span class="mx-sub">${formatInt(cell.passed)}/${formatInt(cell.executed)} passed</span></td>`;
  }
  if (cell.executed > 0) {
    return html`<td class="mx mx-passed" title="${title}"><span class="mx-main">${icon('check')}Passed</span><span class="mx-sub">${formatInt(cell.passed)}/${formatInt(cell.executed)}${cell.skipped ? ` · ${formatInt(cell.skipped)} skipped` : ''}</span></td>`;
  }
  return html`<td class="mx mx-skipped" title="${title}"><span class="mx-main">${icon('minus')}Skipped</span><span class="mx-sub">${formatInt(cell.skipped)} skipped</span></td>`;
}

function renderMatrix(report: RunReport): Raw {
  const projects = [...report.run.projects];
  for (const c of report.matrix) if (!projects.includes(c.project)) projects.push(c.project);
  const features = report.features.map((f) => f.name);
  for (const c of report.matrix) if (!features.includes(c.feature)) features.push(c.feature);
  features.sort((a, b) => (a === UNCLASSIFIED ? 1 : b === UNCLASSIFIED ? -1 : a.localeCompare(b)));
  const byKey = new Map<string, MatrixCell>();
  for (const c of report.matrix) byKey.set(`${c.feature}\u0000${c.project}`, c);

  const body =
    report.matrix.length === 0
      ? emptyState('No scenarios, so there is nothing to compare across browsers.')
      : html`<div class="chart-legend matrix-legend">
      <span class="lg mx-passed">${icon('check')}Passed</span>
      <span class="lg mx-flaky">${icon('wave')}Flaky (no failures)</span>
      <span class="lg mx-failed">${icon('cross')}Failed</span>
      <span class="lg mx-skipped">${icon('minus')}Only skipped</span>
      <span class="lg mx-none">— No scenarios</span>
    </div>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Browser compatibility matrix">
      <table class="matrix">
        <thead><tr><th scope="col" class="mx-corner">Feature \\ Project</th>${projects.map((p) => html`<th scope="col">${p}</th>`)}</tr></thead>
        <tbody>${features.map(
          (f) => html`<tr><th scope="row">${f}</th>${projects.map((p) => matrixCell(byKey.get(`${f}\u0000${p}`)))}</tr>`,
        )}</tbody>
      </table>
    </div>`;
  return html`<section id="matrix" class="card section">
  ${sectionHead('Browser compatibility matrix', 'Features by Playwright project. Each cell shows the worst outcome in that combination.')}
  ${body}
</section>`;
}

function renderReliability(report: RunReport): Raw {
  const r = report.reliability;
  const flaky = report.scenarios.filter((s) => s.outcome === 'flaky');
  return html`<section id="reliability" class="card section span-5">
  ${sectionHead('Reliability', `Retries configured: ${r.retriesConfigured}`)}
  <div class="mini-stats two">
    ${miniStat('Stable', formatInt(r.stable), 'o-passed', 'check')}
    ${miniStat('Flaky', formatInt(r.flaky), 'o-flaky', 'wave')}
    ${miniStat('Failed after retries', formatInt(r.failedAfterRetries), 'o-failed', 'cross')}
    ${miniStat('Flaky rate', formatPercent(r.flakyRate))}
  </div>
  ${
    r.retriesConfigured === 0
      ? html`<div class="note note-warn">${icon('alert')}<span>Retries were disabled for this run, so flakiness could not be detected.</span></div>`
      : ''
  }
  <h3 class="sub-h">Flaky scenarios</h3>
  ${
    flaky.length === 0
      ? html`<p class="muted small">No flaky scenarios.</p>`
      : html`<ul class="link-list">${flaky.map(
          (s) => html`<li>${icon('wave')}${scenarioLink(s.id, s.title)}<span class="muted"> · ${s.project} · ${s.attemptCount} attempts</span></li>`,
        )}</ul>`
  }
</section>`;
}

function renderDurations(report: RunReport): Raw {
  const d = report.durations;
  const maxSlow = Math.max(0, ...d.slowest.map((s) => s.durationMs));
  const maxFeat = Math.max(0, ...d.byFeature.map((f) => f.totalMs));
  const pct = (v: number, max: number): string => (max > 0 ? ((v / max) * 100).toFixed(1) : '0');
  return html`<section id="durations" class="card section span-7">
  ${sectionHead('Duration analysis', 'Scenario duration includes all retry attempts; statistics exclude skipped scenarios.')}
  <div class="mini-stats five">
    ${miniStat('Wall clock', formatDuration(d.wallClockMs))}
    ${miniStat('Cumulative', formatDuration(d.cumulativeMs))}
    ${miniStat('Average', formatDuration(d.averageMs))}
    ${miniStat('Median', formatDuration(d.medianMs))}
    ${miniStat('p95', formatDuration(d.p95Ms))}
  </div>
  <div class="dur-cols">
    <div>
      <h3 class="sub-h">Slowest scenarios</h3>
      ${
        d.slowest.length === 0
          ? html`<p class="muted small">No executed scenarios.</p>`
          : html`<ol class="dbars">${d.slowest.map(
              (s) => html`<li class="dbar">
          <div class="dbar-label">${scenarioLink(s.id, s.title)}<span class="muted"> · ${s.project} · ${s.feature}</span></div>
          <div class="dbar-row"><span class="dbar-track"><span class="dbar-fill" style="width:${pct(s.durationMs, maxSlow)}%"></span></span><span class="dbar-val">${formatDuration(s.durationMs)}</span></div>
        </li>`,
            )}</ol>`
      }
    </div>
    <div>
      <h3 class="sub-h">Duration by feature</h3>
      ${
        d.byFeature.length === 0
          ? html`<p class="muted small">No executed scenarios.</p>`
          : html`<ol class="dbars">${d.byFeature.map(
              (f) => html`<li class="dbar">
          <div class="dbar-label">${f.name}<span class="muted"> · ${plural(f.count, 'scenario', 'scenarios')} · avg ${formatDuration(f.averageMs)}</span></div>
          <div class="dbar-row"><span class="dbar-track"><span class="dbar-fill" style="width:${pct(f.totalMs, maxFeat)}%"></span></span><span class="dbar-val">${formatDuration(f.totalMs)}</span></div>
        </li>`,
            )}</ol>`
      }
    </div>
  </div>
</section>`;
}

function errorDetails(e: ScenarioError, summaryText: string, open = false): Raw {
  return html`<details class="tech"${open ? html` open` : ''}><summary>${summaryText}</summary>${errorBody(e)}</details>`;
}

/** Playwright stacks repeat the message first; show only what the message does not already say. */
function stackFrames(e: ScenarioError): string | undefined {
  if (!e.stack) return undefined;
  const message = e.message.trimEnd();
  if (message && e.stack.startsWith(message)) {
    const rest = e.stack.slice(message.length).replace(/^\s*\n/, '');
    return rest.trim() ? rest : undefined;
  }
  return e.stack;
}

function errorBody(e: ScenarioError): Raw {
  const frames = stackFrames(e);
  return html`<div class="err">
    ${e.location ? html`<div class="err-loc"><span class="muted">at</span> <span class="mono">${e.location}</span></div>` : ''}
    <pre class="pre pre-msg">${e.message || e.summary}</pre>
    ${e.snippet ? html`<div class="pre-label">Code snippet</div><pre class="pre pre-code">${e.snippet}</pre>` : ''}
    ${frames ? html`<div class="pre-label">Stack trace</div><pre class="pre pre-stack">${frames}</pre>` : ''}
  </div>`;
}

function attemptLabel(retry: number): string {
  return retry === 0 ? 'Attempt 1 (initial run)' : `Attempt ${retry + 1} (retry #${retry})`;
}

function renderAttachment(a: Attachment, reportDir: string): Raw {
  const url = artifactUrl(a.path);
  if (url === null) return html`<li class="att att-other"><span>${a.name}</span> <span class="muted">(unavailable: not a relative path)</span></li>`;
  switch (a.kind) {
    case 'screenshot':
      return html`<li class="att att-shot"><a href="${url}" target="_blank" rel="noopener" title="Open full-size screenshot"><img loading="lazy" src="${url}" alt="Screenshot: ${a.name}"></a><span class="att-cap">${a.name}</span></li>`;
    case 'video':
      return html`<li class="att att-video"><video controls preload="none" src="${url}"></video><span class="att-cap">${a.name} · <a href="${url}" target="_blank" rel="noopener">open video</a></span></li>`;
    case 'trace': {
      const p = `${reportDir}/${a.path}`;
      const cmd = `npx playwright show-trace ${/\s/.test(p) ? `"${p}"` : p}`;
      return html`<li class="att att-trace"><div><a href="${url}">${a.name}</a> <span class="muted">(trace .zip)</span></div><div class="cmd"><code>${cmd}</code><button type="button" class="btn btn-sm" data-copy="${cmd}">Copy</button></div></li>`;
    }
    default:
      return html`<li class="att att-other"><a href="${url}" target="_blank" rel="noopener">${a.name}</a> <span class="muted">${a.contentType}</span></li>`;
  }
}

function renderAttachments(atts: ScenarioRecord['attachments'], reportDir: string): Raw {
  if (atts.length === 0) return html`<p class="muted small">No artifacts (artifacts are kept for failed attempts only).</p>`;
  const retries = [...new Set(atts.map((a) => a.retry))].sort((a, b) => a - b);
  const list = (items: Attachment[]): Raw => html`<ul class="atts">${items.map((a) => renderAttachment(a, reportDir))}</ul>`;
  if (retries.length <= 1) return list(atts);
  return html`${retries.map((r) => html`<div class="att-group"><div class="pre-label">${attemptLabel(r)}</div>${list(atts.filter((a) => a.retry === r))}</div>`)}`;
}

function attemptsText(s: ScenarioRecord): string {
  return `${s.attemptCount} / ${s.retriesAllowed + 1}`;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function failureCard(s: ScenarioRecord, variant: 'failed' | 'flaky', reportDir: string): Raw {
  const first = s.errors[0];
  return html`<article class="fcard fcard-${variant} ${s.severity === 'critical' ? 'fcard-crit' : ''}">
    <div class="fcard-tags">${outcomeChip(s.outcome)}${severityBadge(s.severity)}${
      s.failureCategory ? html`<span class="cat">${s.failureCategory}</span>` : ''
    }</div>
    <h3 class="fcard-title">${scenarioLink(s.id, s.title)}</h3>
    <dl class="facts">
      <div><dt>Feature</dt><dd>${s.feature}</dd></div>
      <div><dt>Capability</dt><dd>${s.capability}</dd></div>
      <div><dt>Project</dt><dd>${s.project}</dd></div>
      <div><dt>Duration</dt><dd>${formatDuration(s.durationMs)}</dd></div>
      <div><dt>Attempts</dt><dd>${attemptsText(s)}</dd></div>
    </dl>
    ${
      first
        ? html`<p class="err-summary">${variant === 'flaky' ? 'First failure: ' : ''}${first.summary}</p>`
        : html`<p class="muted small">No error message was recorded.</p>`
    }
    <details class="tech"><summary>Technical details</summary>
      <div class="tech-body">
        <div class="kv"><span class="muted">Test location</span> <span class="mono">${s.file}:${s.line}:${s.column}</span></div>
        ${s.errors.map((e, i) => html`${s.errors.length > 1 ? html`<div class="pre-label">Error ${i + 1} of ${s.errors.length}</div>` : ''}${errorBody(e)}`)}
        <div class="pre-label">Artifacts</div>
        ${renderAttachments(s.attachments, reportDir)}
      </div>
    </details>
  </article>`;
}

function renderFailures(report: RunReport): Raw {
  const bySeverity = (a: ScenarioRecord, b: ScenarioRecord): number =>
    (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.title.localeCompare(b.title);
  const failed = report.scenarios.filter((s) => s.outcome === 'failed').sort(bySeverity);
  const flaky = report.scenarios.filter((s) => s.outcome === 'flaky').sort(bySeverity);
  const cats = report.failureCategories.filter((c) => c.count > 0);
  return html`<section id="failures" class="card section">
  ${sectionHead('Failure analysis', 'Scenarios whose final outcome is failed, most severe first.')}
  ${
    cats.length
      ? html`<div class="cats"><span class="cats-label">Failure categories</span>${cats.map(
          (c) => html`<span class="cat">${c.category} <strong>${formatInt(c.count)}</strong></span>`,
        )}<p class="muted small">Categories come from deterministic rules on the error text and steps; they are not a root-cause analysis.</p></div>`
      : ''
  }
  ${
    failed.length === 0
      ? emptyState('No failures in this run.', 'good')
      : html`<div class="fcards">${failed.map((s) => failureCard(s, 'failed', report.run.reportDir))}</div>`
  }
  ${
    flaky.length
      ? html`<details class="flaky-group"><summary>${icon('wave')}${plural(flaky.length, 'flaky scenario', 'flaky scenarios')} — failed first, then passed on a retry</summary><div class="fcards">${flaky.map((s) => failureCard(s, 'flaky', report.run.reportDir))}</div></details>`
      : ''
  }
</section>`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a === UNCLASSIFIED ? 1 : b === UNCLASSIFIED ? -1 : a.localeCompare(b)));
}

function selectFilter(key: string, label: string, options: [string, string][]): Raw {
  return html`<label class="field"><span>${label}</span><select data-filter="${key}" aria-label="${label}"><option value="">All</option>${options.map(
    ([value, text]) => html`<option value="${value}">${text}</option>`,
  )}</select></label>`;
}

function scenarioRow(s: ScenarioRecord, reportDir: string): Raw {
  const search = [...s.describePath, s.title, s.file].join(' ').toLowerCase();
  return html`<details class="scn" id="${scenarioDomId(s.id)}" data-outcome="${s.outcome}" data-feature="${s.feature}" data-capability="${s.capability}" data-severity="${s.severity}" data-project="${s.project}" data-layer="${s.layer}" data-tags="${JSON.stringify(s.tags)}" data-search="${search}">
  <summary>
    <span class="c-status">${outcomeChip(s.outcome)}</span>
    <span class="c-title">${s.describePath.length ? html`<span class="scn-path">${s.describePath.join(' › ')} ›</span> ` : ''}<span class="scn-title">${s.title}</span><span class="scn-file mono">${s.file}:${s.line}</span></span>
    <span class="c-feat"><span>${s.feature}</span><span class="muted">${s.capability}</span></span>
    <span class="c-sev">${severityBadge(s.severity)}</span>
    <span class="c-proj">${s.project}</span>
    <span class="c-dur num">${s.outcome === 'skipped' && s.attemptCount === 0 ? '—' : formatDuration(s.durationMs)}</span>
  </summary>
  <div class="scn-body">
    <dl class="facts facts-wide">
      <div><dt>Location</dt><dd class="mono">${s.file}:${s.line}:${s.column}</dd></div>
      <div><dt>Layer</dt><dd>${s.layer}</dd></div>
      <div><dt>Browser</dt><dd>${s.browser ?? 'none (non-browser project)'}</dd></div>
      <div><dt>Expected status</dt><dd>${s.expectedStatus}</dd></div>
      <div><dt>Final status</dt><dd>${s.finalStatus}</dd></div>
      <div><dt>Attempts</dt><dd>${attemptsText(s)}</dd></div>
      <div><dt>Duration</dt><dd>${formatDuration(s.durationMs)}</dd></div>
      ${s.failureCategory ? html`<div><dt>Failure category</dt><dd>${s.failureCategory}</dd></div>` : ''}
    </dl>
    <div class="body-block"><div class="pre-label">Tags</div>${
      s.tags.length ? html`<div class="tags">${s.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>` : html`<p class="muted small">No tags.</p>`
    }</div>
    <div class="body-block"><div class="pre-label">Annotations</div>${
      s.annotations.length
        ? html`<ul class="annots">${s.annotations.map(
            (a) => html`<li><span class="mono annot-type">${a.type}</span>${a.description !== undefined ? html` <span>${a.description}</span>` : ''}</li>`,
          )}</ul>`
        : html`<p class="muted small">No annotations.</p>`
    }</div>
    <div class="body-block"><div class="pre-label">Attempts</div>${
      s.attempts.length
        ? html`<div class="table-scroll"><table class="attempts"><thead><tr><th scope="col">Attempt</th><th scope="col">Status</th><th scope="col">Start</th><th scope="col" class="num">Duration</th></tr></thead><tbody>${s.attempts.map(
            (a) => html`<tr><td>${a.retry === 0 ? 'Initial run' : `Retry #${a.retry}`}</td><td><span class="st st-${a.status}">${a.status}</span></td><td>${timestamp(a.startTime, 'time')}</td><td class="num">${formatDuration(a.durationMs)}</td></tr>`,
          )}</tbody></table></div>`
        : html`<p class="muted small">The test never started.</p>`
    }</div>
    ${
      s.errors.length
        ? html`<div class="body-block"><div class="pre-label">${s.outcome === 'flaky' ? 'Errors (first failing attempt)' : 'Errors'}</div>${s.errors.map(errorBody)}</div>`
        : ''
    }
    <div class="body-block"><div class="pre-label">Artifacts</div>${renderAttachments(s.attachments, reportDir)}</div>
  </div>
</details>`;
}

function renderExplorer(report: RunReport): Raw {
  const sc = report.scenarios;
  const outcomes = OUTCOMES.filter((o) => sc.some((s) => s.outcome === o));
  const severities = [...SEVERITIES, UNCLASSIFIED].filter((v) => sc.some((s) => s.severity === v));
  const opt = (values: string[]): [string, string][] => values.map((v) => [v, v]);
  return html`<section id="explorer" class="card section">
  ${sectionHead('Scenario explorer', 'Every scenario in this run. Expand a row for attempts, errors and artifacts.')}
  ${
    sc.length === 0
      ? emptyState('No scenarios in this run.')
      : html`<div class="filters" role="search">
      <label class="field field-search"><span>Search</span><input type="search" data-filter="q" aria-label="Search scenarios" placeholder="Title or file" autocomplete="off"></label>
      ${selectFilter('outcome', 'Status', outcomes.map((o) => [o, OUTCOME_LABEL[o]]))}
      ${selectFilter('feature', 'Feature', opt(uniqueSorted(sc.map((s) => s.feature))))}
      ${selectFilter('capability', 'Business capability', opt(uniqueSorted(sc.map((s) => s.capability))))}
      ${selectFilter('severity', 'Severity', opt(severities))}
      ${selectFilter('project', 'Project', opt(uniqueSorted(sc.map((s) => s.project))))}
      ${selectFilter('layer', 'Layer', opt(uniqueSorted(sc.map((s) => s.layer))))}
      ${selectFilter('tag', 'Tag', opt(uniqueSorted(sc.flatMap((s) => s.tags))))}
      <div class="filter-actions">
        <button type="button" class="btn" data-action="reset">Reset filters</button>
        <button type="button" class="btn" data-action="expand">Expand shown</button>
        <button type="button" class="btn" data-action="collapse">Collapse all</button>
      </div>
    </div>
    <p class="result-count" aria-live="polite"><span data-count>${formatInt(sc.length)}</span> of ${formatInt(sc.length)} scenarios</p>
    <div class="scn-head" aria-hidden="true"><span>Status</span><span>Scenario</span><span>Feature / capability</span><span>Severity</span><span>Project</span><span class="num">Duration</span></div>
    <div class="scn-list">${sc.map((s) => scenarioRow(s, report.run.reportDir))}</div>
    <div class="empty" data-no-results hidden><span>No scenarios match these filters.</span></div>`
  }
</section>`;
}

const DEFINITIONS: [string, string][] = [
  ['Scenario', 'One test in one Playwright project (browser). The same test in Chromium and Firefox counts as two scenarios.'],
  [
    'Passed / Failed / Flaky / Skipped',
    'Playwright final outcome. Flaky = failed at least once, then passed on a retry in the same run. Tests that never ran (e.g. a dependency or beforeAll hook failed) count as skipped and are flagged as "did not run".',
  ],
  [
    'Pass rate',
    'Passed / executed, where executed = passed + failed + flaky. Skipped scenarios are excluded. Flaky scenarios are not counted as passed.',
  ],
  ['Critical pass rate', 'The same, over scenarios with severity "critical".'],
  ['Flaky rate', 'Flaky / executed.'],
  [
    'Duration',
    "A scenario's duration is the sum of all its attempts. Average/median/p95 are over executed scenarios; p95 uses the nearest-rank method. Wall clock is the whole run; cumulative is the sum of scenario durations (larger than wall clock when workers run in parallel).",
  ],
  [
    'Overall status',
    'Critical if any critical-severity scenario failed. Otherwise Attention Required if any scenario failed, was flaky, or did not run without being intentionally skipped; the run did not finish normally; or no scenario executed. Otherwise Healthy. Intentionally skipped scenarios (test.skip) do not change the status.',
  ],
  [
    'Severity',
    'critical = a core user journey is blocked; high = an important feature is broken; medium = secondary behaviour is degraded, a workaround exists; low = cosmetic, diagnostic or edge case.',
  ],
  [
    'Failure category',
    'Assigned by fixed rules in order — Setup / teardown (the error happened in a hook or fixture), Timeout (test timeout, or an action timeout that is not an expect() failure), Navigation / network (network error text such as net::ERR_ / NS_ERROR_), Assertion (an expect() failed), Other. Not a root-cause analysis.',
  ],
  ['Unclassified', 'The test has no (or an unknown) value for that metadata field.'],
];

function trendDefinitions(trends: Trends | undefined): [string, string][] {
  if (!trends) return [];
  return [
    [
      'Trend window',
      `The runs recorded in ${trends.historyDir} (the most recent ${trends.maxRuns} are kept) plus this run, oldest first, spaced by run order rather than time. Only full-suite runs are recorded; a run that is not recorded (e.g. a filtered local run) is still shown as the last point, marked "not recorded".`,
    ],
    [
      'New failure / Ongoing / New scenario',
      'For each scenario that failed in this run. New failure: it passed (or was flaky) the last time it ran. Ongoing: it also failed in the previous run(s) it ran in. New scenario: no earlier run in the window contains it. "Failing for" counts consecutive failing runs including this one; runs in which it was skipped or absent are ignored.',
    ],
    ['Fixed', 'Passed (or flaky) in this run, failed the last time it ran.'],
  ];
}

function renderDefinitions(report: RunReport): Raw {
  return html`<section id="definitions" class="card section">
  ${sectionHead('Definitions')}
  <dl class="defs">${[...DEFINITIONS, ...trendDefinitions(report.trends)].map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}
    <div><dt>Opening a trace offline</dt><dd>From the project folder run <code>npx playwright show-trace ${report.run.reportDir}/&lt;path-to-trace.zip&gt;</code>. Each trace in this report shows its exact command.</dd></div>
  </dl>
  <p class="footer-note muted small">Business QA Dashboard · run ${report.run.runId} · schema v${report.schemaVersion} · raw data: <a href="run.json">run.json</a></p>
</section>`;
}

// ---------------------------------------------------------------------------------------------
// Document

let assetCache: { css: string; js: string } | undefined;

function loadAssets(): { css: string; js: string } {
  if (!assetCache) {
    const dir = path.join(__dirname, 'assets');
    assetCache = {
      css: fs.readFileSync(path.join(dir, 'dashboard.css'), 'utf8'),
      js: fs.readFileSync(path.join(dir, 'dashboard.js'), 'utf8'),
    };
  }
  return assetCache;
}

export function renderHtml(report: RunReport): string {
  const { css, js } = loadAssets();
  // Assets are our own files; still make sure they cannot close their element early.
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const title = `Business QA Dashboard · ${report.status.label}`;
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<script>document.documentElement.classList.add('js');</script>
<style>${new Raw(safeCss)}</style>
</head>
<body>
<a class="skip-link" href="#overview">Skip to summary</a>
${renderHeader(report)}
<main class="wrap">
${renderExecutive(report)}
<div class="grid section-grid">
${renderCritical(report)}
${renderDistribution(report)}
</div>
${renderTrends(report)}
${renderHealth(report)}
${renderMatrix(report)}
<div class="grid section-grid grid-top">
${renderReliability(report)}
${renderDurations(report)}
</div>
${renderFailures(report)}
${renderExplorer(report)}
${renderDefinitions(report)}
</main>
<script>${new Raw(safeJs)}</script>
</body>
</html>
`;
  return doc.value;
}

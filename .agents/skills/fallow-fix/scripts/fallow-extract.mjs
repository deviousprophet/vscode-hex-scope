#!/usr/bin/env node
// Compact, greppable digest of a fallow codebase report for AI agents.
//
//   node <skill>/scripts/fallow-extract.mjs               run `npx fallow --format json --quiet` and digest stdout
//   node <skill>/scripts/fallow-extract.mjs --file r.json digest an existing report file
//   node <skill>/scripts/fallow-extract.mjs --test        self-check against an inline fixture
//
// Exit codes: 0 = green, 1 = findings exist, 2 = scan/parse failed, 3 = failed test.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCAN_TIMEOUT_MS = 600_000;
const MAX_HOTSPOTS = 10;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Identity fields considered, in order, after the generic path/line position.
const LABEL_KEYS = [
  'export_name', 'package_name', 'raw_key', 'entry_name', 'catalog_name',
  'specifier', 'callee', 'rule_id', 'position', 'directive', 'origin',
  'url', 'client_origin', 'server_origin', 'type_name', 'name',
];
// Short scalar extras worth carrying on the line.
const DETAIL_KEYS = ['kind', 'directive', 'source', 'severity', 'is_re_export', 'is_type_only'];

function pos(item) {
  const loc = item.path ?? item.from_path ?? item.file ?? item.files?.join(' -> ') ?? '';
  const line = item.line ?? item.col ?? '';
  return loc + (line ? ':' + line : '');
}

function label(item) {
  if (item.member_name && item.parent_name) {return `parent=${item.parent_name}.${item.member_name}`;}
  for (const k of LABEL_KEYS) {if (item[k] !== undefined) {return `${k}=${JSON.stringify(item[k])}`;}}
  return '';
}

function details(item) {
  const out = [];
  if (item.files) {out.push(`cycle=${item.files.join(' -> ')}`);}
  for (const k of DETAIL_KEYS) {if (item[k] !== undefined) {out.push(`${k}=${item[k]}`);}}
  return out.join(' ');
}

function checkLines(check) {
  const lines = [];
  const counts = [];
  for (const [cat, value] of Object.entries(check)) {
    if (cat === 'total_issues' || cat === 'summary' || cat === 'entry_points' ||
        cat === 'schema_version' || cat === 'version' || cat === 'elapsed_ms') {continue;}
    const items = Array.isArray(value) ? value : [];
    if (items.length) {counts.push(`${cat}: ${items.length}`);}
    for (const it of items) {
      const d = details(it);
      lines.push(`[${cat}] ${pos(it)} ${label(it)} ${d}`.trim());
    }
  }
  return { lines, counts };
}

function heapLines(heap) {
  if (!Array.isArray(heap)) {return [];}
  return heap.slice(0, MAX_HOTSPOTS)
    .map((h) => `[hotspot] ${h.path} score=${h.score} fan_in=${h.fan_in ?? '-'}`);
}

function targetLines(targets) {
  return (targets ?? []).map((t) =>
    `[target] ${t.path} ${t.category}: ${t.recommendation} (effort=${t.effort} confidence=${t.confidence})`);
}

function dupLines(cloneGroups) {
  return (cloneGroups ?? []).map((g) => {
    const inst = (g.instances ?? [])
      .map((i) => `${i.file}:${i.start_line}-${i.end_line}`)
      .join('  ');
    return `[dup] ${g.token_count ?? '?'} tokens, ${inst}`.trim();
  });
}

function digest(j) {
  const check = j.check ?? {};
  const health = j.health ?? {};
  const dupes = j.dupes ?? {};
  const stats = dupes.stats ?? {};

  const { lines: checkLines_, counts } = checkLines(check);
  const findings = health.findings ?? [];
  const targets = health.targets ?? [];
  const cloneGroups = dupes.clone_groups ?? [];
  const cSummary = health.summary ?? {};
  const hSummary = check.summary ?? {};

  const deadCode = check.total_issues ?? 0;
  const complexity = findings.length;
  const dup = cloneGroups.length;
  const green = deadCode === 0 && complexity === 0 && dup === 0;

  const ss = cSummary;
  const sev = [ss.severity_critical_count, ss.severity_high_count, ss.severity_moderate_count]
    .map((n) => n ?? 0);
  const out = [];
  out.push('=== fallow digest ===');
  out.push(`scan: ${ss.files_analyzed ?? '?'} files, ${ss.functions_analyzed ?? '?'} functions | ` +
    `elapsed ${j.elapsed_ms ?? check.elapsed_ms ?? '?'}ms | schema ${j.schema_version ?? check.schema_version ?? '?'} | ` +
    `analysis_run_id ${j._meta?.telemetry?.analysis_run_id ?? '?'}`);
  out.push(`verdict: ${green ? 'GREEN' : 'FINDINGS'}  (dead-code ${deadCode} | complexity ${complexity} | duplication ${dup})`);
  if (health.summary?.functions_above_threshold) {out.push(`  above-threshold functions: ${health.summary.functions_above_threshold}`);}
  out.push('--- findings ---');
  const findingLines = [...checkLines_, ...findings.map((f) =>
    `[complexity] ${pos(f)} name=${f.name} cyclo=${f.cyclomatic} cognitive=${f.cognitive} ` +
    `crap=${f.crap} exceeded=${f.exceeded} severity=${f.severity}`), ...dupLines(cloneGroups)];
  out.push(findingLines.length ? findingLines.join('\n') : '(none)');
  const hs = heapLines(health.hotspots);
  if (hs.length) {
    out.push(`--- hotspots (top ${hs.length} churn/risk) ---`);
    out.push(hs.join('\n'));
    if ((health.hotspots?.length ?? 0) > hs.length) {out.push(`+ ${health.hotspots.length - hs.length} more hotspots omitted (analytic)`);}
  }
  if (targets.length) { out.push('--- targets (informational, never block green) ---'); out.push(targetLines(targets).join('\n')); }
  out.push('--- counts (non-zero only) ---');
  out.push(deadCode ? `dead-code: ${deadCode} (${counts.join(', ')})` : 'dead-code: 0');
  out.push(`complexity: ${complexity} (severity: critical ${sev[0]}, high ${sev[1]}, moderate ${sev[2]})`);
  out.push(`duplication: ${dup} groups (${stats.duplication_percentage ?? 0}% duplicated, ` +
    `${stats.total_tokens ?? '?'} tokens scanned)`);
  out.push(`targets: ${targets.length}`);
  out.push('excluded from digest (analytic, not findings): health.file_scores, health.vital_signs, health.hotspot_summary, health.target_thresholds');
  return { green, text: out.join('\n') };
}

function runFallow() {
  try {
    const stdout = execFileSync('npx', ['fallow', '--format', 'json', '--quiet'], {
      shell: true, cwd: process.cwd(), encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], timeout: SCAN_TIMEOUT_MS,
    });
    return stdout;
  } catch (e) {
    // fallow exits non-zero on findings while still emitting JSON on stdout.
    if (e.stdout) {return e.stdout;}
    if (e.status) {return null;} // no JSON emitted
    throw e;
  }
}

function parseReport(raw) {
  // PowerShell `Out-File -Encoding utf8` (PS5.1) writes a UTF-8 BOM; strip it.
  return JSON.parse(raw.replace(/^\uFEFF/, ''))
}

function selfTest() {
  const fixture = {
    kind: 'fallow-report', schema_version: 1, version: '0.0.0', elapsed_ms: 5,
    _meta: { telemetry: { analysis_run_id: 'self-test' } },
    check: {
      schema_version: 1, version: '0.0.0', elapsed_ms: 5, total_issues: 2,
      summary: { total_issues: 2, unused_files: 0, unused_exports: 1, unused_dependencies: 1 },
      unused_exports: [{ path: 'src/a.ts', export_name: 'bar', line: 12, is_type_only: false, is_re_export: false, actions: [] }],
      unused_dependencies: [{ package_name: 'left-pad', location: 'package.json', actions: [] }],
    },
    dupes: {
      clone_groups: [{ instances: [{ file: 'src/c.ts', start_line: 3, end_line: 7 }, { file: 'src/d.ts', start_line: 11, end_line: 15 }], token_count: 89, actions: [] }],
      clone_families: [], stats: { total_tokens: 500, duplication_percentage: 17.8, clone_groups: 1 },
    },
    health: {
      summary: { files_analyzed: 2, functions_analyzed: 3, functions_above_threshold: 1,
        severity_critical_count: 0, severity_high_count: 1, severity_moderate_count: 0 },
      findings: [{ path: 'src/b.ts', name: 'complex', line: 1, cyclomatic: 8, cognitive: 7, crap: 72, exceeded: 'crap', severity: 'high' }],
      targets: [{ path: 'src/big.ts', category: 'split_high_impact', recommendation: 'Split high-impact file', effort: 'medium', confidence: 'medium' }],
      hotspots: [],
    },
  };
  const { green, text } = digest(fixture);
  const must = [
    'verdict: FINDINGS', '[unused_exports] src/a.ts:12 export_name="bar"',
    '[complexity] src/b.ts:1 name=complex cyclo=8', '[dup] 89 tokens, src/c.ts:3-7  src/d.ts:11-15',
    '[target] src/big.ts split_high_impact: Split high-impact file (effort=medium confidence=medium)',
    'dead-code: 2 (unused_exports: 1, unused_dependencies: 1)',
  ];
  const missing = must.filter((m) => !text.includes(m));
  if (missing.length) { console.error('test failed, missing:\n' + missing.join('\n') + '\n---\n' + text); process.exit(3); }
  // BOM-prefixed raw (PS5.1 `Out-File -Encoding utf8`) must parse identically.
  if (parseReport('\uFEFF' + JSON.stringify(fixture)).kind !== 'fallow-report') { console.error('test failed: BOM strip broken'); process.exit(3); }
  const greenFixture = JSON.parse(JSON.stringify(fixture));
  greenFixture.check.total_issues = 0;
  greenFixture.check.summary = { total_issues: 0 };
  greenFixture.check.unused_exports = [];
  greenFixture.check.unused_dependencies = [];
  greenFixture.dupes.clone_groups = [];
  greenFixture.dupes.stats = structuredClone(greenFixture.dupes.stats) || {};
  greenFixture.dupes.stats.clone_groups = 0;
  greenFixture.health.findings = [];
  if (!digest(greenFixture).green) { console.error('test failed: green fixture not GREEN'); process.exit(3); }
  console.log('fallow-extract.mjs self-test OK');
}

const argv = process.argv.slice(2);
if (argv[0] === '--test') { selfTest(); process.exit(0); }

let raw;
try {
  const fileIdx = argv.indexOf('--file');
  raw = fileIdx !== -1 ? readFileSync(argv[fileIdx + 1], 'utf8') : runFallow();
} catch (e) {
  console.error(`fallow-extract.mjs: could not obtain fallow output: ${e.message}`);
  process.exit(2);
}
if (!raw) { console.error('fallow-extract.mjs: fallow produced no JSON output'); process.exit(2); }

let j;
try { j = parseReport(raw); } catch (e) { console.error(`fallow-extract.mjs: fallow output is not valid JSON: ${e.message}`); process.exit(2); }

const { green, text } = digest(j);
console.log(text);
process.exit(green ? 0 : 1);
import crypto from 'node:crypto';

export const RUN_SCHEMA = 'musitu-delivery-benchmark-run.v1';
const ALLOWED_EVIDENCE = new Set(['internal_controlled', 'live_external']);
const ALLOWED_DIRECTIONS = new Set(['lower', 'higher']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function fingerprintRun(run) {
  return crypto.createHash('sha256').update(canonicalJson(run)).digest('hex');
}

export function validateRun(run) {
  if (!run || typeof run !== 'object') throw new Error('run must be an object');
  if (run.schema !== RUN_SCHEMA) throw new Error(`unsupported run schema: ${run.schema}`);
  if (!run.provider || typeof run.provider !== 'string') throw new Error('provider is required');
  if (!run.scenario || typeof run.scenario !== 'object') throw new Error('scenario is required');
  if (!run.scenario.id || !Number.isInteger(run.scenario.version)) {
    throw new Error('scenario id and integer version are required');
  }
  const definitions = run.scenario.metrics;
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new Error('scenario metrics contract is required');
  }
  for (const [name, direction] of Object.entries(definitions)) {
    if (!name || !ALLOWED_DIRECTIONS.has(direction)) {
      throw new Error(`invalid metric contract for ${name || '<empty>'}`);
    }
  }
  const kind = run.evidence?.kind;
  if (!ALLOWED_EVIDENCE.has(kind)) throw new Error(`unsupported evidence kind: ${kind}`);
  if (!run.evidence?.source || !run.evidence?.captured_at) {
    throw new Error('evidence source and captured_at are required');
  }
  if (!run.metrics || typeof run.metrics !== 'object' || Array.isArray(run.metrics)) {
    throw new Error('metrics are required');
  }
  for (const name of Object.keys(definitions)) {
    const value = run.metrics[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`metric ${name} must be a finite number`);
    }
  }
  const extras = Object.keys(run.metrics).filter((name) => !(name in definitions));
  if (extras.length) throw new Error(`metrics not declared by scenario: ${extras.join(', ')}`);
  return run;
}

function sameScenario(a, b) {
  return a.scenario.id === b.scenario.id
    && a.scenario.version === b.scenario.version
    && canonicalJson(a.scenario.metrics) === canonicalJson(b.scenario.metrics);
}

function metricComparison(musitu, competitor, name, direction) {
  const musituValue = musitu.metrics[name];
  const competitorValue = competitor.metrics[name];
  const delta = musituValue - competitorValue;
  const better = direction === 'lower' ? delta < 0 : delta > 0;
  const tied = delta === 0;
  return {
    direction,
    musitu: musituValue,
    competitor: competitorValue,
    delta,
    outcome: tied ? 'tie' : better ? 'musitu_better' : 'competitor_better',
  };
}

export function buildBenchmarkReport({ musitu, competitors = [] }) {
  validateRun(musitu);
  for (const competitor of competitors) validateRun(competitor);

  const reasons = [];
  if (musitu.provider !== 'musitu') reasons.push('primary run provider must be musitu');
  if (musitu.evidence.kind !== 'live_external') {
    reasons.push('MUSITU run is not live external evidence');
  }
  if (competitors.length === 0) reasons.push('live external competitor evidence is missing');
  if (competitors.some((run) => run.evidence.kind !== 'live_external')) {
    reasons.push('all competitor runs must use live external evidence');
  }
  if (competitors.some((run) => !sameScenario(musitu, run))) {
    reasons.push('scenario contract mismatch between MUSITU and competitor run');
  }

  const comparisonReady = reasons.length === 0;
  const comparisons = comparisonReady
    ? competitors.map((competitor) => ({
        provider: competitor.provider,
        run_fingerprint: fingerprintRun(competitor),
        metrics: Object.fromEntries(
          Object.entries(musitu.scenario.metrics).map(([name, direction]) => [
            name,
            metricComparison(musitu, competitor, name, direction),
          ]),
        ),
      }))
    : [];

  return {
    schema: 'musitu-delivery-benchmark-report.v1',
    scenario: {
      id: musitu.scenario.id,
      version: musitu.scenario.version,
    },
    musitu_run_fingerprint: fingerprintRun(musitu),
    competitor_run_fingerprints: competitors.map((run) => ({
      provider: run.provider,
      sha256: fingerprintRun(run),
    })),
    comparison_ready: comparisonReady,
    claim_status: comparisonReady ? 'EVIDENCE_READY_FOR_REVIEW' : 'NOT_CERTIFIED',
    reasons,
    comparisons,
  };
}

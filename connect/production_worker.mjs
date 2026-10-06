const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const REQUIRED_MINING_FIELDS = [
  'hazard',
  'exposure',
  'severity',
  'likelihood',
  'cost',
  'benefit',
];

const OPTIONAL_MINING_FIELDS = ['record_id', 'asset_id', 'site', 'event_time', 'latitude', 'longitude'];
const AXIOM_BASE = 'https://axiom.mftintelligence.com';
const INTERNAL_TOKEN_LABEL = 'MUSITU-CONNECT-RUNTIME-INTERNAL-V1';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(message)),
  );
}

async function sha256Hex(text) {
  return bytesToHex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = stableValue(value[key]);
        return out;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeMiningRows(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error('rows_required');
  }
  return rawRows.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('invalid_row');
    }
    const missing = REQUIRED_MINING_FIELDS.filter(field => !(field in raw));
    if (missing.length) {
      throw new Error('missing_fields:' + missing.join(','));
    }
    const allowed = new Set([...REQUIRED_MINING_FIELDS, ...OPTIONAL_MINING_FIELDS]);
    const unknown = Object.keys(raw).filter(field => !allowed.has(field)).sort();
    if (unknown.length) throw new Error('unknown_fields:' + unknown.join(','));
    const hazard = String(raw.hazard).trim();
    if (!hazard) throw new Error('hazard_required');
    const exposure = Number(raw.exposure);
    const severity = Number(raw.severity);
    const likelihood = Number(raw.likelihood);
    const cost = Number(raw.cost);
    const benefit = Number(raw.benefit);
    if (![exposure, severity, likelihood, cost, benefit].every(Number.isFinite)) {
      throw new Error('value_not_finite');
    }
    if (
      exposure < 0 ||
      exposure > 1 ||
      likelihood < 0 ||
      likelihood > 1 ||
      severity < 0 ||
      severity > 10 ||
      cost < 0 ||
      benefit < 0 ||
      benefit > 1
    ) {
      throw new Error('value_out_of_range');
    }
    const normalized = { hazard, exposure, severity, likelihood, cost, benefit };
    for (const field of ['record_id', 'asset_id', 'site']) {
      if (field in raw) {
        const value = String(raw[field]).trim();
        if (!value) throw new Error(field + '_required');
        normalized[field] = value;
      }
    }
    if ('event_time' in raw) {
      const eventTime = String(raw.event_time).trim();
      if (!eventTime) throw new Error('event_time_required');
      if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(eventTime) || !Number.isFinite(Date.parse(eventTime))) {
        throw new Error('event_time_timezone_required');
      }
      normalized.event_time = eventTime;
    }
    const hasLatitude = Object.prototype.hasOwnProperty.call(raw, 'latitude');
    const hasLongitude = Object.prototype.hasOwnProperty.call(raw, 'longitude');
    if (hasLatitude !== hasLongitude) throw new Error('coordinate_pair_required');
    if (hasLatitude) {
      const latitude = Number(raw.latitude);
      const longitude = Number(raw.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('value_not_finite');
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new Error('value_out_of_range');
      }
      normalized.latitude = latitude;
      normalized.longitude = longitude;
    }
    return normalized;
  });
}

function optimizeInterventions(rows, budget) {
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error('budget_must_be_nonnegative');
  }
  const epsilon = 1e-12;
  const baselineRisk = rows.reduce(
    (sum, row) => sum + row.exposure * row.severity * row.likelihood,
    0,
  );
  const items = rows
    .map((row, originalIndex) => {
      const risk = row.exposure * row.severity * row.likelihood;
      const riskReduction = risk * row.benefit;
      return {
        originalIndex,
        cost: row.cost,
        riskReduction,
        density: row.cost <= epsilon ? Number.POSITIVE_INFINITY : riskReduction / row.cost,
      };
    })
    .filter(item => item.riskReduction > epsilon)
    .sort((left, right) => {
      if (left.density !== right.density) return right.density - left.density;
      if (left.cost !== right.cost) return left.cost - right.cost;
      return left.originalIndex - right.originalIndex;
    });

  let bestReduction = 0;
  let bestSpend = 0;
  let bestSelected = [];

  function upperBound(index, spend, reduction) {
    let remaining = budget - spend;
    let bound = reduction;
    for (let cursor = index; cursor < items.length; cursor += 1) {
      const item = items[cursor];
      if (item.cost <= epsilon) {
        bound += item.riskReduction;
        continue;
      }
      if (item.cost <= remaining + epsilon) {
        remaining -= item.cost;
        bound += item.riskReduction;
        continue;
      }
      if (remaining > epsilon) {
        bound += item.riskReduction * (remaining / item.cost);
      }
      break;
    }
    return bound;
  }

  function lexicographicallyBefore(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index];
    }
    return left.length < right.length;
  }

  function isBetter(reduction, spend, selected) {
    if (reduction > bestReduction + epsilon) return true;
    if (Math.abs(reduction - bestReduction) > epsilon) return false;
    if (spend < bestSpend - epsilon) return true;
    if (Math.abs(spend - bestSpend) > epsilon) return false;
    return lexicographicallyBefore(selected, bestSelected);
  }

  const stack = [{ index: 0, spend: 0, reduction: 0, selected: [] }];
  while (stack.length) {
    const state = stack.pop();
    const selected = [...state.selected].sort((left, right) => left - right);
    if (isBetter(state.reduction, state.spend, selected)) {
      bestReduction = state.reduction;
      bestSpend = state.spend;
      bestSelected = selected;
    }
    if (state.index >= items.length) continue;
    if (upperBound(state.index, state.spend, state.reduction) < bestReduction - epsilon) {
      continue;
    }

    const item = items[state.index];
    stack.push({
      index: state.index + 1,
      spend: state.spend,
      reduction: state.reduction,
      selected: state.selected,
    });
    const nextSpend = state.spend + item.cost;
    if (nextSpend <= budget + epsilon) {
      stack.push({
        index: state.index + 1,
        spend: nextSpend,
        reduction: state.reduction + item.riskReduction,
        selected: [...state.selected, item.originalIndex],
      });
    }
  }

  const relativeReduction = baselineRisk <= epsilon
    ? 0
    : (bestReduction / baselineRisk) * 100;
  return {
    baselineRisk,
    residualRisk: Math.max(0, baselineRisk - bestReduction),
    riskReduction: bestReduction,
    spend: bestSpend,
    selected: bestSelected.map(index => rows[index].hazard),
    relativeReduction: Number(relativeReduction.toFixed(2)),
    gate: 'LOCKED',
  };
}

async function authorize(request, env) {
  const accountKey = String(env.AXIOM_ACCOUNT_KEY || '');
  if (!accountKey) {
    return { configured: false, authorized: false };
  }
  const expected = await hmacHex(accountKey, INTERNAL_TOKEN_LABEL);
  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  return {
    configured: true,
    authorized: constantTimeEqual(expected, supplied),
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('invalid_json');
  }
}

function extractAxiomResult(payload) {
  const direct = payload?.result;
  if (
    direct &&
    typeof direct === 'object' &&
    !Array.isArray(direct) &&
    Object.prototype.hasOwnProperty.call(direct, 'result')
  ) {
    return direct.result;
  }
  return direct;
}

async function handlePlan(request) {
  const body = await readJson(request);
  const rows = normalizeMiningRows(body?.rows);
  const budget = Number(body?.budget);
  const plan = optimizeInterventions(rows, budget);
  const trace = (await sha256Hex(stableStringify({ rows, budget }))).slice(0, 16);
  return json(200, { ...plan, trace });
}

async function handleRisk(request, env) {
  const body = await readJson(request);
  const rows = normalizeMiningRows(body?.rows);
  const runId = String(body?.run_id || '').trim();
  if (!runId || runId.length > 80 || /[\r\n]/.test(runId)) {
    throw new Error('run_id_required');
  }
  const canonical = {
    contract: 'musitu.connect.canonical.v1',
    domain: 'mining',
    records: rows,
    run_id: runId,
  };
  const canonicalSha256 = await sha256Hex(stableStringify(canonical));
  const requestId =
    'MUSITU-CONNECT-' + runId + '-' + canonicalSha256.slice(0, 16);
  const row = rows[0];
  const payload = {
    operation: 'arithmetic.evaluate',
    args: {
      expression:
        String(row.exposure) +
        '*' +
        String(row.severity) +
        '*' +
        String(row.likelihood),
    },
  };

  let response;
  try {
    response = await fetch(AXIOM_BASE + '/v1/compute', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + String(env.AXIOM_ACCOUNT_KEY),
        accept: 'application/json',
        'content-type': 'application/json',
        'x-musitu-request-id': requestId,
        'user-agent': 'MUSITU-Connect-Production/1.0',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json(502, { ok: false, error: 'AXIOM_TRANSPORT_ERROR' });
  }

  let decoded = {};
  try {
    decoded = await response.json();
  } catch {
    return json(502, { ok: false, error: 'AXIOM_RESPONSE_INVALID' });
  }
  if (!response.ok) {
    return json(502, {
      ok: false,
      error: 'AXIOM_UPSTREAM_ERROR',
      upstream_status: response.status,
    });
  }
  if (
    decoded.request_id !== undefined &&
    String(decoded.request_id) !== requestId
  ) {
    return json(502, { ok: false, error: 'AXIOM_REQUEST_ID_MISMATCH' });
  }
  if (decoded.ok === false) {
    return json(502, { ok: false, error: 'AXIOM_REMOTE_ERROR' });
  }

  return json(200, {
    ok: true,
    gate: 'OPEN',
    operation: 'arithmetic.evaluate',
    result: extractAxiomResult(decoded),
    request_id: requestId,
    canonical_sha256: canonicalSha256,
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(200, {
          ok: true,
          service: 'MUSITU Connect',
          release: String(env.RELEASE || 'unknown'),
          production: String(env.PRODUCTION || 'false') === 'true',
          axiomIntegrationAllowed: Boolean(env.AXIOM_ACCOUNT_KEY),
        });
      }

      if (
        request.method === 'POST' &&
        (url.pathname === '/api/mining/plan' ||
          url.pathname === '/api/mining/risk')
      ) {
        const auth = await authorize(request, env);
        if (!auth.configured) {
          return json(503, {
            ok: false,
            error: 'AXIOM_ACCOUNT_KEY_NOT_CONFIGURED',
          });
        }
        if (!auth.authorized) {
          return json(401, { ok: false, error: 'UNAUTHORIZED' });
        }
        try {
          if (url.pathname === '/api/mining/plan') {
            return await handlePlan(request);
          }
          return await handleRisk(request, env);
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z0-9_:-]{1,120}$/.test(error.message)
              ? error.message
              : 'INVALID_REQUEST';
          return json(400, { ok: false, error: code });
        }
      }

      return json(404, { ok: false, error: 'NOT_FOUND' });
    } catch (error) {
      const errorClass =
        error && typeof error === 'object' && 'name' in error
          ? String(error.name).slice(0, 80)
          : 'UnknownError';
      console.error('MUSITU_CONNECT_WORKER_INTERNAL', errorClass);
      return json(500, {
        ok: false,
        error: 'WORKER_INTERNAL_ERROR',
        error_class: errorClass,
      });
    }
  },
};

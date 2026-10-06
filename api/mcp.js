import { BlobNotFoundError, BlobPreconditionFailedError, get, put } from '@vercel/blob';

const STATE_PATH = 'musitu-axiom-operator/v1/state.json';

function json(status, value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.length < 16) throw new Error(`${name} unavailable`);
  return value;
}

function authorized(request) {
  const configured = requiredEnv('AXIOM_OPERATOR_BEARER_TOKEN');
  const value = request.headers.get('authorization') || '';
  const expected = `Bearer ${configured}`;
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i += 1) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function loadState() {
  try {
    const result = await get(STATE_PATH, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return { state: null, etag: null };
    const text = await new Response(result.stream).text();
    return { state: JSON.parse(text), etag: result.blob.etag };
  } catch (error) {
    if (error instanceof BlobNotFoundError) return { state: null, etag: null };
    throw error;
  }
}

async function commitState(nextState, priorEtag) {
  const body = JSON.stringify(nextState);
  try {
    if (priorEtag) {
      const result = await put(STATE_PATH, body, {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        ifMatch: priorEtag,
      });
      return result.etag;
    }
    const result = await put(STATE_PATH, body, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return result.etag;
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) {
      const conflict = new Error('operator state generation changed');
      conflict.code = 'STATE_CONFLICT';
      throw conflict;
    }
    throw error;
  }
}

async function invokeCore(request, statePack) {
  const internalSecret = requiredEnv('AXIOM_OPERATOR_INTERNAL_SECRET');
  const url = new URL('/api/operator_core', request.url);
  const payload = await request.json();
  const forwarded = {};
  for (const name of ['mcp-protocol-version', 'mcp-method', 'mcp-name']) {
    const value = request.headers.get(name);
    if (value) forwarded[name] = value;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-axiom-operator-internal-secret': internalSecret,
    },
    body: JSON.stringify({
      state_pack: statePack,
      mcp_headers: forwarded,
      mcp_message: payload,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || 'operator core rejected request');
    error.code = body?.error || 'OPERATOR_CORE_REJECTED';
    throw error;
  }
  return body;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/mcp')) {
      return json(200, {
        schema: 'musitu.axiom.operator-remote-health.v1',
        status: 'READY',
        surface: 'PRIVATE_OPERATOR_REMOTE',
        state_backend: 'VERCEL_BLOB_PRIVATE_ETAG_CAS',
        production_authority: false,
        public_submission_mutation_authority: false,
        provider_execution_authority: false,
      });
    }

    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    if (!authorized(request)) return json(401, { error: 'UNAUTHORIZED' });
    if (!String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return json(415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
    }

    let current;
    try {
      current = await loadState();
      const core = await invokeCore(request, current.state);
      const priorHash = current.state?.state_sha256 || null;
      const nextHash = core.next_state?.state_sha256 || null;
      let committedEtag = current.etag;
      if (nextHash && nextHash !== priorHash) committedEtag = await commitState(core.next_state, current.etag);

      return json(core.mcp_status, core.mcp_body, {
        'mcp-protocol-version': core.mcp_headers?.['MCP-Protocol-Version'] || '2026-03-26',
        'x-axiom-state-sha256': nextHash || priorHash || '',
        'x-axiom-state-etag': committedEtag || '',
      });
    } catch (error) {
      if (error?.code === 'STATE_CONFLICT') {
        return json(409, { error: 'STATE_CONFLICT', message: 'operator state changed concurrently; retry from fresh state' });
      }
      return json(500, { error: 'OPERATOR_REMOTE_ERROR', message: String(error?.message || error) });
    }
  },
};

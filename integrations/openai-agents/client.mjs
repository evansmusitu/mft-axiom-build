import OpenAI from 'openai';

const encoder = new TextEncoder();
const turnStatuses = new Set(['queued', 'in_progress', 'waiting', 'completed', 'failed', 'cancelled']);
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
const sessionStatuses = new Set(['idle', 'in_progress', 'requires_action', 'failed']);
const messages = {
  HOSTED_TIMEOUT: 'Hosted agent deadline exceeded; inspect the saved invocation before further work.',
  HOSTED_ABORTED: 'Hosted agent observation aborted; inspect the saved invocation before further work.',
  HOSTED_BODY_LIMIT: 'Hosted agent response exceeded the bounded response budget.',
  HOSTED_OUTPUT_LIMIT: 'Hosted agent output exceeded the bounded output budget.',
  HOSTED_REQUIRES_ACTION: 'Hosted agent requested an unsupported external action.',
  HOSTED_TURN_FAILED: 'The intended hosted agent turn failed.',
  HOSTED_TURN_CANCELLED: 'The intended hosted agent turn was cancelled.',
  HOSTED_TURN_INCOMPLETE: 'The intended hosted agent turn has not completed.',
  HOSTED_MISSING_OUTPUT: 'The completed hosted agent turn has no final assistant text.',
  HOSTED_PROTOCOL_ERROR: 'Hosted agent response did not match the documented session contract.',
  HOSTED_PROVIDER_ERROR: 'Hosted agent request failed; inspect the saved invocation before further work.',
  HOSTED_CHECKPOINT_FAILED: 'Hosted agent identity could not be durably checkpointed.',
  HOSTED_TRANSPORT_POLICY: 'Hosted agent transport refused an unexpected destination or redirect.',
};

/** Deliberately excludes request content, credentials, reasoning, and provider errors. */
export class HostedAgentError extends Error {
  constructor(code, metadata = {}) {
    super(messages[code] ?? messages.HOSTED_PROVIDER_ERROR);
    this.name = 'HostedAgentError';
    this.code = code;
    Object.assign(this, metadata);
  }
}

const fail = code => { throw new HostedAgentError(code); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const bytes = text => encoder.encode(text).byteLength;
function requireId(value) {
  if (!validId(value)) throw new TypeError('A persisted hosted agent identity is required.');
}
function requireSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal.');
  }
}

/** One deadline covers headers, response bodies, callbacks, and every readback page. */
function operationContext({timeoutMs, maxBodyBytes, signal}) {
  const controller = new AbortController();
  let failure, receivedBytes = 0;
  const stop = code => {
    failure ??= new HostedAgentError(code);
    controller.abort(failure);
  };
  const externalAbort = () => stop('HOSTED_ABORTED');
  signal?.addEventListener('abort', externalAbort, {once: true});
  if (signal?.aborted) externalAbort();
  const timer = setTimeout(() => stop('HOSTED_TIMEOUT'), timeoutMs);
  return {
    signal: controller.signal,
    dispatched: false,
    get failure() { return failure; },
    assertOpen() { if (controller.signal.aborted) throw failure ?? new HostedAgentError('HOSTED_ABORTED'); },
    stop,
    account(chunk) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxBodyBytes) stop('HOSTED_BODY_LIMIT');
      this.assertOpen();
    },
    async wait(action) {
      this.assertOpen();
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(failure ?? new HostedAgentError('HOSTED_ABORTED'));
        controller.signal.addEventListener('abort', onAbort, {once: true});
      });
      try {
        const result = await Promise.race([Promise.resolve().then(action), aborted]);
        this.assertOpen();
        return result;
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
      }
    },
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      controller.abort();
    },
  };
}

/** Bound bytes before the SDK's SSE/JSON parsers allocate complete payloads. */
function boundedFetch(fetchImpl, context) {
  return async (url, init) => {
    context.assertOpen();
    const targetURL = new URL(url);
    if (targetURL.origin !== 'https://api.openai.com' || targetURL.username || targetURL.password ||
        !targetURL.pathname.startsWith('/v1/agents/')) {
      context.stop('HOSTED_TRANSPORT_POLICY');
      context.assertOpen();
    }
    context.dispatched = true;
    // Native fetch must reject redirects before forwarding the credential or input.
    const response = await context.wait(() => fetchImpl(targetURL.href, {...init, redirect: 'error'}));
    if (response.redirected || response.status >= 300 && response.status < 400 ||
        response.url && new URL(response.url).origin !== targetURL.origin) {
      void response.body?.cancel().catch(() => {});
      context.stop('HOSTED_TRANSPORT_POLICY');
      context.assertOpen();
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const signal = AbortSignal.any([context.signal, ...(init?.signal ? [init.signal] : [])]);
    let closed = false, destination;
    const detach = () => signal.removeEventListener('abort', abort);
    // Do not await transport cancellation: a broken transport can ignore it.
    const cancelReader = () => { void reader.cancel().catch(() => {}); };
    const abort = () => {
      if (closed) return;
      closed = true;
      detach();
      cancelReader();
      destination.error(context.failure ?? new HostedAgentError('HOSTED_ABORTED'));
    };
    const body = new ReadableStream({
      start(controller) {
        destination = controller;
        signal.addEventListener('abort', abort, {once: true});
        if (signal.aborted) abort();
      },
      async pull(controller) {
        try {
          const next = await context.wait(() => reader.read());
          if (closed) return;
          if (next.done) {
            closed = true;
            detach();
            reader.releaseLock();
            controller.close();
            return;
          }
          context.account(next.value);
          controller.enqueue(next.value);
        } catch (error) {
          if (closed) return;
          closed = true;
          detach();
          cancelReader();
          controller.error(error);
        }
      },
      cancel() {
        closed = true;
        detach();
        cancelReader();
      },
    }, {highWaterMark: 0});
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  };
}

/** Keep only assistant output_text; reasoning and commentary never become output. */
function outputCapture(maxOutputBytes) {
  const items = new Map();
  let totalBytes = 0;
  function itemEntry(id, index) {
    if (!validId(id) || !Number.isInteger(index) || index < 0) fail('HOSTED_PROTOCOL_ERROR');
    if (!items.has(id)) items.set(id, {index, parts: new Map(), complete: false});
    const entry = items.get(id);
    if (entry.index !== index) fail('HOSTED_PROTOCOL_ERROR');
    return entry;
  }
  function setPart(entry, index, text, append = false) {
    if (!Number.isInteger(index) || index < 0 || typeof text !== 'string') fail('HOSTED_PROTOCOL_ERROR');
    const previous = entry.parts.get(index) ?? '';
    const next = append ? previous + text : text;
    totalBytes += bytes(next) - bytes(previous);
    if (totalBytes > maxOutputBytes) fail('HOSTED_OUTPUT_LIMIT');
    entry.parts.set(index, next);
  }
  return {
    item(item, index, done = true) {
      if (item?.type !== 'message' || item.role !== 'assistant') return;
      if (!['in_progress', 'completed', 'incomplete'].includes(item.status) || !Array.isArray(item.content) ||
          ![null, 'commentary', 'final_answer'].includes(item.phase)) fail('HOSTED_PROTOCOL_ERROR');
      if (done && item.status !== 'completed') fail('HOSTED_PROTOCOL_ERROR');
      const entry = itemEntry(item.id, index);
      totalBytes -= [...entry.parts.values()].reduce((sum, text) => sum + bytes(text), 0);
      entry.parts.clear();
      entry.phase = item.phase;
      entry.complete = done;
      item.content.forEach((part, contentIndex) => {
        if (part?.type === 'output_text') setPart(entry, contentIndex, part.text);
      });
    },
    event(event) {
      switch (event.type) {
        case 'agent.session.turn.item.added':
        case 'agent.session.turn.item.done':
          this.item(event.item, event.output_index, event.type.endsWith('.done'));
          break;
        case 'agent.session.turn.output_text.delta':
          setPart(itemEntry(event.item_id, event.output_index), event.content_index, event.delta, true);
          break;
        case 'agent.session.turn.output_text.done':
          setPart(itemEntry(event.item_id, event.output_index), event.content_index, event.text);
          break;
        case 'agent.session.turn.content_part.added':
        case 'agent.session.turn.content_part.done':
          if (event.part?.type === 'output_text') setPart(itemEntry(event.item_id, event.output_index), event.content_index, event.part.text);
          break;
      }
    },
    text() {
      return [...items.values()].filter(item => item.complete && item.phase !== 'commentary')
        .sort((a, b) => a.index - b.index)
        .map(item => [...item.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join(''))
        .join('\n');
    },
  };
}

function inspectTurn(turn, state) {
  if (!turn || turn.object !== 'agent.session.turn' || turn.id !== state.turnId || turn.session_id !== state.sessionId ||
      turn.subagent_id != null || !turnStatuses.has(turn.status)) fail('HOSTED_PROTOCOL_ERROR');
  return turn.status;
}

/**
 * Uses the released openai@7.15.0 managed Agents API. Construction is offline.
 * invocationId is local identity; session creation has no supported idempotency key.
 * Durable callers must claim an invocation before create and never resend uncertain input.
 */
export function createHostedAgentClient({apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 45000, maxOutputBytes = 64000} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('An existing OpenAI API key is required.');
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(model)) throw new TypeError('An explicit OpenAI agent model is required.');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > Number.MAX_SAFE_INTEGER / 16) {
    throw new TypeError('Valid hosted agent transport and positive bounded limits are required.');
  }
  // Covers metadata/repeated SSE representations as well as final text, across all pages.
  const maxBodyBytes = Math.max(256000, maxOutputBytes * 16);
  const sdk = context => new OpenAI({
    apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: timeoutMs,
    logLevel: 'off', fetch: boundedFetch(fetchImpl, context),
  }).beta.agents.sessions;

  async function readCompleted(sessions, context, state) {
    const turn = await context.wait(() => sessions.turns.retrieve(state.turnId, {session_id: state.sessionId}, {signal: context.signal}));
    const status = inspectTurn(turn, state);
    state.terminal = terminalStatuses.has(status);
    if (status === 'failed') fail('HOSTED_TURN_FAILED');
    if (status === 'cancelled') fail('HOSTED_TURN_CANCELLED');
    if (status === 'waiting') fail('HOSTED_REQUIRES_ACTION');
    if (status !== 'completed') fail('HOSTED_TURN_INCOMPLETE');
    const output = outputCapture(maxOutputBytes), cursors = new Set();
    let page = await context.wait(() => sessions.items.list(state.sessionId, {order: 'asc', limit: 100}, {signal: context.signal}));
    let outputIndex = 0;
    for (;;) {
      if (!Array.isArray(page.data) || typeof page.body?.has_more !== 'boolean') fail('HOSTED_PROTOCOL_ERROR');
      for (const item of page.data) {
        if (item?.turn_id === state.turnId) output.item(item, outputIndex++);
      }
      if (!page.body.has_more) break;
      const cursor = page.data.at(-1)?.id;
      if (!validId(cursor) || cursors.has(cursor)) fail('HOSTED_PROTOCOL_ERROR');
      cursors.add(cursor);
      page = await context.wait(() => page.getNextPage());
    }
    const output_text = output.text();
    if (!output_text.trim()) fail('HOSTED_MISSING_OUTPUT');
    if (bytes(output_text) > maxOutputBytes) fail('HOSTED_OUTPUT_LIMIT');
    return {session_id: state.sessionId, turn_id: state.turnId, status: 'completed', output_text};
  }

  async function run({signal, sessionId = null, turnId = null, autoCancel = false}, action) {
    requireSignal(signal);
    const context = operationContext({timeoutMs, maxBodyBytes, signal});
    const state = {sessionId, turnId, terminal: false};
    try {
      context.assertOpen();
      return await action(sdk(context), context, state);
    } catch (error) {
      // The SDK also bounds buffered JSON parsing. Its deadline can win the
      // timer race by a millisecond; preserve the same timeout classification.
      context.stop(context.failure?.code ?? (error instanceof HostedAgentError ? error.code : error instanceof OpenAI.APIConnectionTimeoutError ? 'HOSTED_TIMEOUT' : 'HOSTED_PROVIDER_ERROR'));
      let cancel_attempted = false, cancel_requested = false;
      if (autoCancel && ['HOSTED_TIMEOUT', 'HOSTED_ABORTED'].includes(context.failure.code) && state.sessionId && state.turnId && !state.terminal) {
        cancel_attempted = true;
        const cleanup = operationContext({timeoutMs: Math.min(1000, timeoutMs), maxBodyBytes, signal: undefined});
        try {
          await cleanup.wait(() => sdk(cleanup).events.create(state.sessionId, {events: [{type: 'agent.session.input.cancel'}]}, {signal: cleanup.signal}));
          cancel_requested = true;
        } catch { /* Cancellation is best effort, never proof of a terminal turn. */ }
        finally { cleanup.dispose(); }
      }
      throw new HostedAgentError(context.failure.code, {
        session_id: state.sessionId, turn_id: state.turnId,
        cleanup_needed: context.dispatched && !state.terminal, cancel_attempted, cancel_requested,
      });
    } finally { context.dispose(); }
  }

  return Object.freeze({
    async create({input, instructions, invocationId, onCheckpoint, signal} = {}) {
      if (typeof input !== 'string' || !input.trim() || typeof instructions !== 'string' || !instructions.trim() ||
          !validId(invocationId) || typeof onCheckpoint !== 'function') {
        throw new TypeError('Input, instructions, local invocation identity, and a durable checkpoint callback are required.');
      }
      return run({signal, autoCancel: true}, async (sessions, context, state) => {
        const stream = await context.wait(() => sessions.create({
          agent: {model, instructions, tools: [], multi_agent: {enabled: false}},
          environment: {type: 'openai_hosted', network: {access: 'disabled'}}, input, stream: true,
        }, {signal: context.signal}));
        const iterator = stream[Symbol.asyncIterator]();
        const output = outputCapture(maxOutputBytes), seenEvents = new Set();
        let completed = false;
        try {
          for (;;) {
            const next = await context.wait(() => iterator.next());
            if (next.done) break;
            const event = next.value;
            if (!event || typeof event.type !== 'string') fail('HOSTED_PROTOCOL_ERROR');
            const sessionIds = [event.session_id, event.session?.id, event.turn?.session_id].filter(value => value != null);
            if (sessionIds.some(id => !validId(id) || id !== sessionIds[0]) || state.sessionId && sessionIds.some(id => id !== state.sessionId)) fail('HOSTED_PROTOCOL_ERROR');
            const sessionId = sessionIds[0] ?? state.sessionId;
            const rootTurn = event.type.startsWith('agent.session.turn.') && event.turn?.subagent_id == null;
            const turnIds = rootTurn ? [event.turn_id, event.turn?.id, event.item?.turn_id].filter(value => value != null) : [];
            if (turnIds.some(id => !validId(id) || id !== turnIds[0])) fail('HOSTED_PROTOCOL_ERROR');
            const turnId = state.turnId ?? turnIds[0] ?? null;
            if (turnId && !sessionId) fail('HOSTED_PROTOCOL_ERROR');
            if (sessionId && (sessionId !== state.sessionId || turnId !== state.turnId)) {
              state.sessionId = sessionId;
              state.turnId = turnId;
              try { await context.wait(() => onCheckpoint({session_id: sessionId, turn_id: turnId})); }
              catch { fail(context.failure?.code ?? 'HOSTED_CHECKPOINT_FAILED'); }
            }
            if (event.session) {
              if (!sessionStatuses.has(event.session.status)) fail('HOSTED_PROTOCOL_ERROR');
              if (event.session.status === 'requires_action' || event.session.required_actions?.length) fail('HOSTED_REQUIRES_ACTION');
              if (event.session.status === 'failed') fail('HOSTED_TURN_FAILED');
            }
            if (event.type === 'error' || event.type === 'agent.session.environment.failed') fail('HOSTED_PROVIDER_ERROR');
            if (event.type === 'agent.session.failed') fail('HOSTED_TURN_FAILED');
            if (event.type === 'agent.session.requires_action') fail('HOSTED_REQUIRES_ACTION');
            if (event.event_id && seenEvents.has(event.event_id)) continue;
            if (event.event_id) seenEvents.add(event.event_id);
            if (!rootTurn || !state.turnId || turnIds[0] !== state.turnId) continue;
            if (event.turn) {
              const status = inspectTurn(event.turn, state);
              if (status === 'failed' || status === 'cancelled') {
                state.terminal = true;
                fail(status === 'failed' ? 'HOSTED_TURN_FAILED' : 'HOSTED_TURN_CANCELLED');
              }
              if (status === 'waiting') fail('HOSTED_REQUIRES_ACTION');
            }
            if (event.type === 'agent.session.turn.failed' || event.type === 'agent.session.turn.cancelled') {
              state.terminal = true;
              fail(event.type.endsWith('.failed') ? 'HOSTED_TURN_FAILED' : 'HOSTED_TURN_CANCELLED');
            }
            if (event.type === 'agent.session.turn.completed') {
              if (inspectTurn(event.turn, state) !== 'completed') fail('HOSTED_PROTOCOL_ERROR');
              state.terminal = true;
              completed = true;
              break;
            }
            output.event(event);
          }
        } finally {
          stream.controller.abort();
          void iterator.return?.().catch(() => {});
        }
        context.assertOpen();
        if (!state.sessionId || !state.turnId) fail('HOSTED_TURN_INCOMPLETE');
        const output_text = output.text();
        if (!completed || !output_text.trim()) return readCompleted(sessions, context, state);
        if (bytes(output_text) > maxOutputBytes) fail('HOSTED_OUTPUT_LIMIT');
        return {session_id: state.sessionId, turn_id: state.turnId, status: 'completed', output_text};
      });
    },
    async reconcile({sessionId, turnId, signal} = {}) {
      requireId(sessionId); requireId(turnId);
      return run({signal, sessionId, turnId}, (sessions, context, state) => readCompleted(sessions, context, state));
    },
    async waitForCompletion({sessionId,turnId,signal,pollIntervalMs=1000,maxPolls=120}={}) {
      requireId(sessionId);requireId(turnId);
      if(!Number.isSafeInteger(pollIntervalMs)||pollIntervalMs<1||pollIntervalMs>10000||!Number.isSafeInteger(maxPolls)||maxPolls<1||maxPolls>120)throw new TypeError('bounded read-only polling required');
      return run({signal,sessionId,turnId},async(sessions,context,state)=>{
        for(let poll=0;poll<maxPolls;poll++){
          try{return await readCompleted(sessions,context,state);}
          catch(error){if(!(error instanceof HostedAgentError)||error.code!=='HOSTED_TURN_INCOMPLETE'||poll===maxPolls-1)throw error;}
          let timer;
          try{await context.wait(()=>new Promise(resolve=>{timer=setTimeout(resolve,pollIntervalMs);}));}
          finally{clearTimeout(timer);}
        }
      });
    },
    async cancel({sessionId, turnId, signal} = {}) {
      requireId(sessionId); requireId(turnId);
      return run({signal, sessionId, turnId}, async (sessions, context, state) => {
        const turn = await context.wait(() => sessions.turns.retrieve(turnId, {session_id: sessionId}, {signal: context.signal}));
        const status = inspectTurn(turn, state);
        state.terminal = terminalStatuses.has(status);
        if (state.terminal) return {session_id: sessionId, turn_id: turnId, status, output_text: ''};
        await context.wait(() => sessions.events.create(sessionId, {events: [{type: 'agent.session.input.cancel'}]}, {signal: context.signal}));
        return {session_id: sessionId, turn_id: turnId, status: 'cancel_requested', output_text: ''};
      });
    },
    async delete({sessionId, signal} = {}) {
      requireId(sessionId);
      return run({signal, sessionId}, async (sessions, context, state) => {
        const deleted = await context.wait(() => sessions.delete(sessionId, {signal: context.signal}));
        if (deleted.id !== sessionId || deleted.deleted !== true || deleted.object !== 'agent.session.deleted') fail('HOSTED_PROTOCOL_ERROR');
        state.terminal = true;
        return deleted;
      });
    },
  });
}

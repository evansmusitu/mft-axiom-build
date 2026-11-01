import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedAgentClient, HostedAgentError} from '../client.mjs';
import OpenAI from 'openai';

const sessionId = 'session_fixture', turnId = 'turn_fixture';
const textEncoder = new TextEncoder();
const deferred = () => Promise.withResolvers();
function session(status = 'in_progress', overrides = {}) {
  return {
    id: sessionId, object: 'agent.session', status, created_at: 1, last_active_at: 1,
    agent: {id: 'agent_fixture', model: 'fixture-model', instructions: null, multi_agent: {enabled: false, max_concurrent_subagents: 0},
      name: null, reasoning: {effort: null, summary: null}, service_tier: 'auto', text: {format: {type: 'text'}}, tools: []},
    environment: {id: 'environment_fixture', type: 'openai_hosted', network: {access: 'disabled'}},
    error: null, metadata: {}, required_actions: [], usage: null, vault_ids: [], ...overrides,
  };
}
function turn(status = 'completed', overrides = {}) {
  return {id: turnId, object: 'agent.session.turn', session_id: sessionId, status, agent_id: 'agent_fixture',
    subagent_id: null, created_at: 1, started_at: 1, completed_at: status === 'completed' ? 2 : null,
    error: null, usage: null, ...overrides};
}
function message(text, overrides = {}) {
  return {id: 'message_fixture', type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed',
    turn_id: turnId, content: [{type: 'output_text', text}], ...overrides};
}
let eventSequence = 0;
function event(type, extra = {}) {
  return {event_id: 'event_' + ++eventSequence, type, session_id: sessionId, turn_id: turnId, ...extra};
}
const created = (overrides = {}) => ({type: 'agent.session.created', event_id: 'created_' + ++eventSequence, session: session(), ...overrides});
const started = (overrides = {}) => event('agent.session.turn.created', {turn: turn('queued'), ...overrides});
const completed = (overrides = {}) => event('agent.session.turn.completed', {turn: turn(), usage: null, ...overrides});
const outputItem = (text, overrides = {}) => event('agent.session.turn.item.done', {item: message(text), output_index: 0, ...overrides});
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
}
function pageResponse(data, has_more = false) {
  return jsonResponse({object: 'list', data, has_more, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null});
}
function sseResponse(events, {holdOpen = false, onPull = () => {}, onCancel = () => {}} = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        onPull(index);
        const item = events[index++];
        controller.enqueue(textEncoder.encode(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`));
      } else if (!holdOpen) controller.close();
    },
    cancel: onCancel,
  }, {highWaterMark: 0}), {headers: {'Content-Type': 'text/event-stream'}});
}
function transport(responders) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = {url: new URL(url), method: init.method, redirect: init.redirect, headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body) : null, signal: init.signal};
    calls.push(call);
    const responder = responders[calls.length - 1];
    assert.ok(responder, `Unexpected request ${call.method} ${call.url.pathname}`);
    return typeof responder === 'function' ? responder(call) : responder;
  };
  return {calls, fetchImpl};
}
function client(fetchImpl, options = {}) {
  return createHostedAgentClient({apiKey: 'fixture-local-key', model: 'fixture-model', fetchImpl, ...options});
}
const invocation = overrides => ({input: 'fixture input', instructions: 'Return one JSON object.', invocationId: 'invocation_fixture', onCheckpoint: async () => {}, ...overrides});
function safeError(error, code) {
  assert.ok(error instanceof HostedAgentError);
  assert.equal(error.code, code);
  assert.ok(!JSON.stringify(error).includes('sensitive-provider-text'));
  assert.ok(!error.message.includes('sensitive-provider-text'));
  return true;
}

test('construction is offline and requires explicit credentials, model and bounded options', () => {
  const {calls, fetchImpl} = transport([]);
  const hosted = client(fetchImpl);
  assert.deepEqual(Object.keys(hosted), ['create', 'reconcile', 'waitForCompletion', 'cancel', 'delete']);
  assert.equal(calls.length, 0);
  for (const overrides of [{apiKey: ''}, {model: ''}, {model: 'bad model'}, {timeoutMs: 0}, {maxOutputBytes: 0}, {maxOutputBytes: Infinity}]) {
    assert.throws(() => createHostedAgentClient({apiKey: 'fixture-key', model: 'fixture-model', fetchImpl, ...overrides}), TypeError);
  }
});

test('create uses the real pinned SDK and the documented hosted request; reasoning and commentary are excluded', async () => {
  const checkpoints = [];
  const events = [created(), started(),
    event('agent.session.turn.item.done', {output_index: 0, item: {id: 'reasoning_fixture', type: 'reasoning', turn_id: turnId,
      status: 'completed', summary: [{type: 'summary_text', text: 'sensitive-provider-text reasoning'}]}}),
    outputItem('Working on it.', {output_index: 1, item: message('Working on it.', {id: 'commentary_fixture', phase: 'commentary'})}),
    event('agent.session.turn.item.added', {item: message('', {status: 'in_progress'}), output_index: 2}),
    event('agent.session.turn.output_text.delta', {item_id: 'message_fixture', output_index: 2, content_index: 0, delta: '{"ok":'}),
    event('agent.session.turn.output_text.delta', {item_id: 'message_fixture', output_index: 2, content_index: 0, delta: 'true}'}),
    event('agent.session.turn.output_text.done', {item_id: 'message_fixture', output_index: 2, content_index: 0, text: '{"ok":true}'}),
    outputItem('{"ok":true}', {output_index: 2}), completed()];
  const {calls, fetchImpl} = transport([sseResponse(events)]);
  assert.deepEqual(await client(fetchImpl).create(invocation({onCheckpoint: async checkpoint => checkpoints.push(checkpoint)})), {
    session_id: sessionId, turn_id: turnId, status: 'completed', output_text: '{"ok":true}',
  });
  assert.deepEqual(checkpoints, [{session_id: sessionId, turn_id: null}, {session_id: sessionId, turn_id: turnId}]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, 'https://api.openai.com/v1/agents/sessions');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers.get('OpenAI-Beta'), 'agents=v1');
  assert.equal(calls[0].headers.get('Idempotency-Key'), null);
  assert.equal(calls[0].headers.get('x-stainless-retry-count'), '0');
  assert.deepEqual(calls[0].body, {
    agent: {model: 'fixture-model', instructions: 'Return one JSON object.', tools: [], multi_agent: {enabled: false}},
    environment: {type: 'openai_hosted', network: {access: 'disabled'}}, input: 'fixture input', stream: true,
  });
});

test('ambient base URL configuration cannot redirect credentials or Work input away from OpenAI', async () => {
  const previous = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = 'https://sensitive-provider-text.invalid/v1';
  try {
    const {calls, fetchImpl} = transport([sseResponse([created(), started(), outputItem('final'), completed()])]);
    assert.equal((await client(fetchImpl).create(invocation())).output_text, 'final');
    assert.equal(calls[0].url.origin, 'https://api.openai.com');
    assert.equal(calls[0].redirect, 'error');
  } finally {
    if (previous === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previous;
  }
});

test('redirect and cross-origin response indications are rejected without following a Location header', async t => {
  const redirected = sseResponse([created(), started(), outputItem('never accepted'), completed()]);
  Object.defineProperty(redirected, 'url', {value: 'https://sensitive-provider-text.invalid/v1/agents/sessions'});
  for (const response of [new Response(null, {status: 307, headers: {Location: 'https://sensitive-provider-text.invalid/collect'}}), redirected]) {
    await t.test(String(response.status), async () => {
      const {calls, fetchImpl} = transport([response]);
      await assert.rejects(client(fetchImpl).create(invocation()), error => safeError(error, 'HOSTED_TRANSPORT_POLICY'));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url.origin, 'https://api.openai.com');
      assert.equal(calls[0].redirect, 'error');
    });
  }
});

test('checkpoint persistence is awaited before consuming the next event', async () => {
  const entered = deferred(), release = deferred(), enteredTurn = deferred(), releaseTurn = deferred();
  const checkpoints = [];
  let pulls = 0;
  const {fetchImpl} = transport([sseResponse([created(), started(), outputItem('final'), completed()], {onPull: () => pulls++})]);
  const result = client(fetchImpl).create(invocation({onCheckpoint: async checkpoint => {
    checkpoints.push(checkpoint);
    if (!checkpoint.turn_id) {entered.resolve(); await release.promise;}
    else {enteredTurn.resolve(); await releaseTurn.promise;}
  }}));
  await entered.promise;
  assert.equal(pulls, 1);
  assert.equal(checkpoints.length, 1);
  release.resolve();
  await enteredTurn.promise;
  assert.equal(pulls, 2);
  releaseTurn.resolve();
  assert.equal((await result).output_text, 'final');
});

test('another turn cannot complete or supply text for the intended turn', async () => {
  const other = 'turn_other';
  const {calls, fetchImpl} = transport([sseResponse([created(), started(),
    outputItem('wrong', {turn_id: other, item: message('wrong', {turn_id: other, id: 'message_other'})}),
    completed({turn_id: other, turn: turn('completed', {id: other})}), outputItem('right'), completed()])]);
  assert.equal((await client(fetchImpl).create(invocation())).output_text, 'right');
  assert.equal(calls.length, 1);
});

test('an idle session is not completion proof and disconnected input is never resent', async () => {
  const {calls, fetchImpl} = transport([
    sseResponse([created(), started(), {type: 'agent.session.idle', event_id: 'idle', session: session('idle')}]),
    jsonResponse(turn('in_progress')),
  ]);
  await assert.rejects(client(fetchImpl).create(invocation()), error => safeError(error, 'HOSTED_TURN_INCOMPLETE'));
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
  assert.equal(calls[1].url.pathname, `/v1/agents/sessions/${sessionId}/turns/${turnId}`);
});

test('reconcile retrieves only the persisted target and paginates saved items without submitting events', async () => {
  const user = message('do not return', {id: 'user_fixture', role: 'user', phase: null, content: [{type: 'input_text', text: 'do not return'}]});
  const reasoning = {id: 'reasoning_fixture', type: 'reasoning', status: 'completed', turn_id: turnId,
    summary: [{type: 'summary_text', text: 'sensitive-provider-text reasoning'}]};
  const {calls, fetchImpl} = transport([
    jsonResponse(turn()),
    pageResponse([user, reasoning, message('wrong turn', {id: 'other', turn_id: 'turn_other'})], true),
    pageResponse([message('commentary', {id: 'commentary', phase: 'commentary'}), message('saved final')]),
  ]);
  assert.deepEqual(await client(fetchImpl).reconcile({sessionId, turnId}), {
    session_id: sessionId, turn_id: turnId, status: 'completed', output_text: 'saved final',
  });
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(calls[1].url.pathname, `/v1/agents/sessions/${sessionId}/items`);
  assert.equal(calls[1].url.searchParams.get('order'), 'asc');
  assert.equal(calls[2].url.searchParams.get('after'), 'other');
});

test('completed events without final text and disconnected streams recover through exact persisted turn/items', async t => {
  for (const terminalEvent of [true, false]) await t.test(String(terminalEvent), async () => {
    const {calls, fetchImpl} = transport([
      sseResponse([created(), started(), event('agent.session.turn.output_text.delta', {
        item_id: 'message_fixture', output_index: 0, content_index: 0, delta: 'partial text',
      }), ...(terminalEvent ? [completed()] : [])]),
      jsonResponse(turn()), pageResponse([message('persisted final')]),
    ]);
    assert.equal((await client(fetchImpl).create(invocation())).output_text, 'persisted final');
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET']);
  });
});

test('failed, cancelled, action-required and unknown states fail closed without exposing provider text', async t => {
  const cases = [
    [event('agent.session.turn.failed', {turn: turn('failed', {error: {code: 'sensitive-provider-text', message: 'sensitive-provider-text'}})}), 'HOSTED_TURN_FAILED'],
    [event('agent.session.turn.cancelled', {turn: turn('cancelled')}), 'HOSTED_TURN_CANCELLED'],
    [{type: 'agent.session.requires_action', session: session('requires_action', {required_actions: [{type: 'function_call', call_id: 'call_fixture', turn_id: turnId, name: 'sensitive-provider-text', arguments: {}}]})}, 'HOSTED_REQUIRES_ACTION'],
    [{type: 'agent.session.failed', session: session('failed', {error: 'sensitive-provider-text'})}, 'HOSTED_TURN_FAILED'],
    [{type: 'agent.session.failed', session: session('idle')}, 'HOSTED_TURN_FAILED'],
    [{type: 'agent.session.idle', session: session('unknown')} , 'HOSTED_PROTOCOL_ERROR'],
    [event('agent.session.turn.in_progress', {turn: turn('failed')}), 'HOSTED_TURN_FAILED'],
    [event('agent.session.turn.in_progress', {turn: turn('cancelled')}), 'HOSTED_TURN_CANCELLED'],
    [completed({turn: turn('unknown')}), 'HOSTED_PROTOCOL_ERROR'],
  ];
  for (const [badEvent, code] of cases) await t.test(code, async () => {
    const {calls, fetchImpl} = transport([sseResponse([created(), started(), badEvent])]);
    await assert.rejects(client(fetchImpl).create(invocation()), error => safeError(error, code));
    assert.equal(calls.length, 1);
  });
});

test('reconciliation rejects noncompleted turns, unknown identities, missing final output and malformed pagination', async t => {
  for (const [status, code] of [['queued', 'HOSTED_TURN_INCOMPLETE'], ['in_progress', 'HOSTED_TURN_INCOMPLETE'],
    ['waiting', 'HOSTED_REQUIRES_ACTION'], ['failed', 'HOSTED_TURN_FAILED'], ['cancelled', 'HOSTED_TURN_CANCELLED'], ['unknown', 'HOSTED_PROTOCOL_ERROR']]) {
    await t.test(status, async () => {
      const {calls, fetchImpl} = transport([jsonResponse(turn(status))]);
      await assert.rejects(client(fetchImpl).reconcile({sessionId, turnId}), error => safeError(error, code));
      assert.equal(calls.length, 1);
    });
  }
  for (const malformedTurn of [turn('completed', {id: 'wrong'}), turn('completed', {session_id: 'wrong'}), turn('completed', {subagent_id: 'subagent_fixture'})]) {
    const {fetchImpl} = transport([jsonResponse(malformedTurn)]);
    await assert.rejects(client(fetchImpl).reconcile({sessionId, turnId}), error => safeError(error, 'HOSTED_PROTOCOL_ERROR'));
  }
  for (const savedItems of [pageResponse([message('commentary', {phase: 'commentary'})]), pageResponse([])]) {
    const {fetchImpl} = transport([jsonResponse(turn()), savedItems]);
    await assert.rejects(client(fetchImpl).reconcile({sessionId, turnId}), error => safeError(error, 'HOSTED_MISSING_OUTPUT'));
  }
  const {fetchImpl} = transport([jsonResponse(turn()), pageResponse([], true)]);
  await assert.rejects(client(fetchImpl).reconcile({sessionId, turnId}), error => safeError(error, 'HOSTED_PROTOCOL_ERROR'));
});

test('UTF-8 output limits are exact for streamed and persisted assistant text', async t => {
  const {fetchImpl} = transport([sseResponse([created(), started(), outputItem('éé'), completed()])]);
  assert.equal((await client(fetchImpl, {maxOutputBytes: 4}).create(invocation())).output_text, 'éé');
  for (const representation of ['delta', 'item', 'persisted']) await t.test(representation, async () => {
    const replies = representation === 'persisted' ? [jsonResponse(turn()), pageResponse([message('ééé')])] :
      [sseResponse([created(), started(), representation === 'delta' ? event('agent.session.turn.output_text.delta', {
        item_id: 'message_fixture', output_index: 0, content_index: 0, delta: 'ééé',
      }) : outputItem('ééé')])];
    const {fetchImpl} = transport(replies);
    const hosted = client(fetchImpl, {maxOutputBytes: 4});
    await assert.rejects(representation === 'persisted' ? hosted.reconcile({sessionId, turnId}) : hosted.create(invocation()),
      error => safeError(error, 'HOSTED_OUTPUT_LIMIT'));
  });
});

test('an oversized response is stopped before the SDK can buffer an unterminated SSE event', async () => {
  let cancelled = false;
  const payload = textEncoder.encode('data: sensitive-provider-text' + 'x'.repeat(256001));
  const response = new Response(new ReadableStream({
    start(controller) {controller.enqueue(payload);}, cancel() {cancelled = true;},
  }), {headers: {'Content-Type': 'text/event-stream'}});
  const {calls, fetchImpl} = transport([response]);
  await assert.rejects(client(fetchImpl, {maxOutputBytes: 1}).create(invocation()), error => safeError(error, 'HOSTED_BODY_LIMIT'));
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
});

test('response byte budget applies across persisted pages, including ignored reasoning', async () => {
  const ignored = id => ({id, turn_id: 'turn_other', type: 'reasoning', status: 'completed',
    summary: [{type: 'summary_text', text: 'x'.repeat(140000)}]});
  const {calls, fetchImpl} = transport([jsonResponse(turn()), pageResponse([ignored('reasoning_first')], true), pageResponse([ignored('reasoning_second')])]);
  await assert.rejects(client(fetchImpl, {maxOutputBytes: 1}).reconcile({sessionId, turnId}), error => safeError(error, 'HOSTED_BODY_LIMIT'));
  assert.equal(calls.length, 3);
});

test('timeout aborts the stream and makes at most one bounded cancellation request; acceptance is not completion', async () => {
  let cancelled = false;
  const {calls, fetchImpl} = transport([
    sseResponse([created(), started()], {holdOpen: true, onCancel: () => {cancelled = true;}}),
    new Response(null, {status: 204}),
  ]);
  await assert.rejects(client(fetchImpl, {timeoutMs: 30}).create(invocation()), error => {
    safeError(error, 'HOSTED_TIMEOUT');
    assert.equal(error.session_id, sessionId); assert.equal(error.turn_id, turnId);
    assert.equal(error.cleanup_needed, true); assert.equal(error.cancel_attempted, true); assert.equal(error.cancel_requested, true);
    return true;
  });
  assert.equal(cancelled, true);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls.map(call => call.method), ['POST', 'POST']);
  assert.equal(calls[1].url.pathname, `/v1/agents/sessions/${sessionId}/events`);
  assert.deepEqual(calls[1].body, {events: [{type: 'agent.session.input.cancel'}]});
});

test('cleanup has its own short deadline even when the cancellation transport ignores abort', async () => {
  const {calls, fetchImpl} = transport([sseResponse([created(), started()], {holdOpen: true}), () => new Promise(() => {})]);
  const start = performance.now();
  await assert.rejects(client(fetchImpl, {timeoutMs: 20}).create(invocation()), error => {
    safeError(error, 'HOSTED_TIMEOUT'); assert.equal(error.cancel_attempted, true); assert.equal(error.cancel_requested, false); return true;
  });
  assert.ok(performance.now() - start < 1000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].signal.aborted, true);
});

test('the deadline covers a stalled checkpoint callback and retains discovered IDs for cleanup', async () => {
  let cancelled = false;
  const {calls, fetchImpl} = transport([sseResponse([started(), outputItem('never consumed')], {onCancel: () => {cancelled = true;}}),
    new Response(null, {status: 204})]);
  await assert.rejects(client(fetchImpl, {timeoutMs: 20}).create(invocation({onCheckpoint: () => new Promise(() => {})})), error => {
    safeError(error, 'HOSTED_TIMEOUT'); assert.equal(error.turn_id, turnId); assert.equal(error.cancel_attempted, true); return true;
  });
  assert.equal(cancelled, true);
  assert.equal(calls.length, 2);
});

test('a stalled creation before headers is bounded without guessing a session or retrying input', async () => {
  const {calls, fetchImpl} = transport([() => new Promise(() => {})]);
  await assert.rejects(client(fetchImpl, {timeoutMs: 20}).create(invocation()), error => {
    safeError(error, 'HOSTED_TIMEOUT');
    assert.equal(error.session_id, null); assert.equal(error.turn_id, null);
    assert.equal(error.cleanup_needed, true); assert.equal(error.cancel_attempted, false);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});

test('uncooperative response cancellation cannot extend the operation deadline', async () => {
  let cancelled = false;
  const {calls, fetchImpl} = transport([sseResponse([created(), started()], {holdOpen: true,
    onCancel: () => {cancelled = true; return new Promise(() => {});}}), new Response(null, {status: 204})]);
  const start = performance.now();
  await assert.rejects(client(fetchImpl, {timeoutMs: 20}).create(invocation()), error => safeError(error, 'HOSTED_TIMEOUT'));
  assert.ok(performance.now() - start < 1000);
  assert.equal(cancelled, true); assert.equal(calls.length, 2);
});

test('reconciliation deadline covers stalled JSON bodies and remains read-only', async () => {
  let cancelled = false;
  const {calls, fetchImpl} = transport([new Response(new ReadableStream({cancel() {cancelled = true;}}), {
    headers: {'Content-Type': 'application/json'},
  })]);
  await assert.rejects(client(fetchImpl, {timeoutMs: 20}).reconcile({sessionId, turnId}), error => safeError(error, 'HOSTED_TIMEOUT'));
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('an SDK JSON-body timeout that wins the timer race retains timeout classification and never retries', async () => {
  let calls=0;
  const fetchImpl=async()=>{calls++;throw new OpenAI.APIConnectionTimeoutError();};
  await assert.rejects(client(fetchImpl).reconcile({sessionId,turnId}),error=>safeError(error,'HOSTED_TIMEOUT'));
  assert.equal(calls,1);
});

test('bounded completion waiting observes queued and running status before exact persisted output without submitting input',async()=>{
  const {calls,fetchImpl}=transport([jsonResponse(turn('queued')),jsonResponse(turn('in_progress')),jsonResponse(turn('completed')),pageResponse([message('saved final output')])]);
  const result=await client(fetchImpl).waitForCompletion({sessionId,turnId,pollIntervalMs:1,maxPolls:3});
  assert.equal(result.output_text,'saved final output');assert.equal(result.turn_id,turnId);assert.equal(calls.length,4);assert.ok(calls.every(call=>call.method==='GET'));
});

test('completion waiting has a hard read-count ceiling and never treats idle or pending as completed',async()=>{
  const {calls,fetchImpl}=transport([jsonResponse(turn('queued')),jsonResponse(turn('in_progress'))]);
  await assert.rejects(client(fetchImpl).waitForCompletion({sessionId,turnId,pollIntervalMs:1,maxPolls:2}),error=>safeError(error,'HOSTED_TURN_INCOMPLETE'));
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method==='GET'));
});

test('completion waiting stops on failed, cancelled and unsupported action states without polling again',async t=>{
  for(const [status,code]of[['failed','HOSTED_TURN_FAILED'],['cancelled','HOSTED_TURN_CANCELLED'],['waiting','HOSTED_REQUIRES_ACTION']])await t.test(status,async()=>{
    const {calls,fetchImpl}=transport([jsonResponse(turn(status))]);
    await assert.rejects(client(fetchImpl).waitForCompletion({sessionId,turnId,pollIntervalMs:1}),error=>safeError(error,code));assert.equal(calls.length,1);
  });
});

test('completion-wait poll bounds reject before any provider request',async()=>{
  const {calls,fetchImpl}=transport([]);
  for(const options of[{maxPolls:0},{maxPolls:121},{pollIntervalMs:0},{pollIntervalMs:10001}])await assert.rejects(client(fetchImpl).waitForCompletion({sessionId,turnId,...options}),TypeError);
  assert.equal(calls.length,0);
});

test('failed-turn diagnostics retain only documented machine categories and exclude provider text',async t=>{
  for(const [code,expected]of[['usage_limit_exceeded','usage_limit_exceeded'],['sensitive-provider-text','OTHER_UNDISCLOSED']])await t.test(expected,async()=>{
    const {calls,fetchImpl}=transport([jsonResponse({...turn('failed'),error:{code,message:'sensitive-provider-text'}})]);
    await assert.rejects(client(fetchImpl).reconcile({sessionId,turnId}),error=>{safeError(error,'HOSTED_TURN_FAILED');assert.equal(error.provider_error_code,expected);assert.equal(JSON.stringify(error).includes('sensitive-provider-text'),false);return true;});assert.equal(calls.length,1);
  });
});

test('preaborted signals do not dispatch and external aborts keep caller error text private', async () => {
  const before = new AbortController(); before.abort('sensitive-provider-text');
  const offline = transport([]);
  await assert.rejects(client(offline.fetchImpl).create(invocation({signal: before.signal})), error => {
    safeError(error, 'HOSTED_ABORTED'); assert.equal(error.cleanup_needed, false); return true;
  });
  assert.equal(offline.calls.length, 0);
  const controller = new AbortController(), checkpointed = deferred();
  const {calls, fetchImpl} = transport([sseResponse([created(), started()], {holdOpen: true}), new Response(null, {status: 204})]);
  const result = client(fetchImpl).create(invocation({signal: controller.signal, onCheckpoint: async checkpoint => {
    if (checkpoint.turn_id) checkpointed.resolve();
  }}));
  await checkpointed.promise;
  controller.abort(new Error('sensitive-provider-text'));
  await assert.rejects(result, error => {safeError(error, 'HOSTED_ABORTED'); assert.equal(error.cancel_attempted, true); return true;});
  assert.equal(calls.length, 2);
});

test('checkpoint failure stops event consumption and reports only safe recovery metadata', async () => {
  let pulls = 0, cancelled = false;
  const {calls, fetchImpl} = transport([sseResponse([created(), started(), outputItem('never consumed'), completed()], {
    onPull: () => pulls++, onCancel: () => {cancelled = true;},
  })]);
  await assert.rejects(client(fetchImpl).create(invocation({onCheckpoint: async () => {throw new Error('sensitive-provider-text');}})), error => {
    safeError(error, 'HOSTED_CHECKPOINT_FAILED'); assert.equal(error.session_id, sessionId); assert.equal(error.turn_id, null);
    assert.equal(error.cleanup_needed, true); return true;
  });
  assert.equal(pulls, 1); assert.equal(cancelled, true); assert.equal(calls.length, 1);
});

test('replacement session IDs and contradictory item turn IDs fail closed', async t => {
  for (const bad of [started({session_id: 'session_replacement', turn: turn('queued', {session_id: 'session_replacement'})}),
    outputItem('wrong', {item: message('wrong', {turn_id: 'turn_replacement'})})]) {
    await t.test(bad.type, async () => {
      const checkpoints = [];
      const {calls, fetchImpl} = transport([sseResponse([created(), started(), bad, outputItem('never accepted'), completed()])]);
      await assert.rejects(client(fetchImpl).create(invocation({onCheckpoint: async value => checkpoints.push(value)})),
        error => safeError(error, 'HOSTED_PROTOCOL_ERROR'));
      assert.deepEqual(checkpoints, [{session_id: sessionId, turn_id: null}, {session_id: sessionId, turn_id: turnId}]);
      assert.equal(calls.length, 1);
    });
  }
});

test('duplicate SSE event IDs do not double-count partial text', async () => {
  const delta = event('agent.session.turn.output_text.delta', {item_id: 'message_fixture', output_index: 0, content_index: 0, delta: 'text'});
  const {fetchImpl} = transport([sseResponse([created(), started(), delta, delta, outputItem('text'), completed()])]);
  assert.equal((await client(fetchImpl, {maxOutputBytes: 4}).create(invocation())).output_text, 'text');
});

test('concurrent creates have independent SDK transport budgets and checkpoint identities', async () => {
  const calls = [], checkpoints = new Map();
  const fetchImpl = async (url, init) => {
    const input = JSON.parse(init.body).input, sid = 'session_' + input, tid = 'turn_' + input;
    calls.push({url, input});
    return sseResponse([
      created({session: session('in_progress', {id: sid})}),
      started({session_id: sid, turn_id: tid, turn: turn('queued', {id: tid, session_id: sid})}),
      outputItem(input, {session_id: sid, turn_id: tid, item: message(input, {turn_id: tid})}),
      completed({session_id: sid, turn_id: tid, turn: turn('completed', {id: tid, session_id: sid})}),
    ]);
  };
  const hosted = client(fetchImpl, {maxOutputBytes: 5});
  const results = await Promise.all(['first', 'other'].map(input => hosted.create(invocation({input, invocationId: 'invocation_' + input,
    onCheckpoint: async checkpoint => checkpoints.set(input, checkpoint)}))));
  assert.deepEqual(results.map(result => result.output_text), ['first', 'other']);
  assert.deepEqual(checkpoints.get('first'), {session_id: 'session_first', turn_id: 'turn_first'});
  assert.deepEqual(checkpoints.get('other'), {session_id: 'session_other', turn_id: 'turn_other'});
  assert.equal(calls.length, 2);
});

test('explicit cancellation inspects the target and skips terminal turns', async t => {
  for (const status of ['completed', 'failed', 'cancelled']) await t.test(status, async () => {
    const {calls, fetchImpl} = transport([jsonResponse(turn(status))]);
    assert.equal((await client(fetchImpl).cancel({sessionId, turnId})).status, status);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  });
  for (const status of ['queued', 'in_progress', 'waiting']) await t.test(status, async () => {
    const {calls, fetchImpl} = transport([jsonResponse(turn(status)), new Response(null, {status: 204})]);
    assert.equal((await client(fetchImpl).cancel({sessionId, turnId})).status, 'cancel_requested');
    assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
    assert.deepEqual(calls[1].body, {events: [{type: 'agent.session.input.cancel'}]});
    assert.equal(calls[1].headers.get('Idempotency-Key'), null);
  });
  const {calls, fetchImpl} = transport([jsonResponse(turn('completed', {id: 'wrong'}))]);
  await assert.rejects(client(fetchImpl).cancel({sessionId, turnId}), error => safeError(error, 'HOSTED_PROTOCOL_ERROR'));
  assert.equal(calls.length, 1);
});

test('deletion occurs only on explicit delete and uses the documented confirmation', async () => {
  const deleted = {id: sessionId, object: 'agent.session.deleted', deleted: true};
  const {calls, fetchImpl} = transport([jsonResponse(deleted)]);
  assert.deepEqual(await client(fetchImpl).delete({sessionId}), deleted);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].headers.get('OpenAI-Beta'), 'agents=v1');
});

test('SDK retries are disabled for HTTP errors and safe errors never copy provider payloads', async t => {
  for (const status of [409, 429, 500]) await t.test(String(status), async () => {
    const {calls, fetchImpl} = transport([jsonResponse({error: {message: 'sensitive-provider-text', type: 'fixture_error', code: 'fixture'}}, status)]);
    await assert.rejects(client(fetchImpl).create(invocation()), error => safeError(error, 'HOSTED_PROVIDER_ERROR'));
    assert.equal(calls.length, 1);
  });
});

test('invalid method arguments and missing persisted turn identity fail before network dispatch', async () => {
  const {calls, fetchImpl} = transport([]), hosted = client(fetchImpl);
  await assert.rejects(hosted.create(invocation({onCheckpoint: undefined})), TypeError);
  await assert.rejects(hosted.create(invocation({invocationId: 'invalid/id'})), TypeError);
  await assert.rejects(hosted.reconcile({sessionId}), TypeError);
  await assert.rejects(hosted.reconcile({sessionId, turnId: 'invalid/id'}), TypeError);
  await assert.rejects(hosted.cancel({sessionId}), TypeError);
  await assert.rejects(hosted.delete({sessionId: '../secret'}), TypeError);
  await assert.rejects(hosted.create(invocation({signal: {}})), TypeError);
  assert.equal(calls.length, 0);
});

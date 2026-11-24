/**
 * No-cloud contract tests on real SQLite, using Node's built-in node:sqlite.
 * The production controller accepts the Cloudflare DurableObjectStorage SQL
 * API shape; this harness adapts DatabaseSync without a network or credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { G56DurableQueueController, QueueGateClosed, QueueConflict } from './durable_queue_controller.mjs';

const schema = readFileSync(new URL('./durable_queue_schema.sql', import.meta.url), 'utf8');

function fixture({ budget = false, quote = false, binding = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(schema);
  for (const tenant of ['tenantA', 'tenantB']) {
    db.prepare('INSERT INTO g56_do_tenants VALUES(?,150,450,2,10)')
      .run(tenant);
  }
  const storage = {
    sql: {
      exec(sql, ...args) {
        const statement = db.prepare(sql);
        if (/^\s*(?:SELECT|PRAGMA)\b/i.test(sql)) return statement.all(...args);
        statement.run(...args);
        return [];
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  let now = 1000;
  let remainingCents = 1000;
  const readProviderCap = budget ? () => ({
    provider:'MODAL', workspace:'offline-fixture-workspace',
    controlId:'offline-fake-hard-cap-NOT-AUTHORITATIVE',
    hardEnforced:true, remainingCents, monthlyCapCents:1000,
    checkedUnix:now
  }) : undefined;
  const verifyWorstCaseQuote = quote ? () => true : undefined;
  const authorizeClaim = (proof, workerId) =>
    proof === 'local-private-worker' && workerId === 'workerCPU';
  const authorizeUser = (principal, tenant) =>
    principal?.signed === true && principal.tenant === tenant;
  const authorizeProject = (principal, tenant, project) =>
    principal?.signed === true && principal.tenant === tenant &&
    principal.project === project;
  const authorizeWorker = (proof, job) =>
    proof?.signed === true && proof.job === job;
  const authorizeMaintenance = (proof) => proof === 'approved-private-maintainer';
  const controller = new G56DurableQueueController(storage, {
    authorizeUser, authorizeProject, authorizeWorker, authorizeMaintenance,
    authorizeClaim, readProviderCap, verifyWorstCaseQuote,
    expectedWorkspace:binding ? 'offline-fixture-workspace' : null,
    now: () => now,
  });
  function seed({ jid = 'G56_A', tenant = 'tenantA', key = 'submissionA',
                  project = 'projectA', state = 'QUEUED', attempts = 0, fence = null,
                  lease = null, provider = null, progress = 0 } = {}) {
    db.prepare(`INSERT INTO g56_do_jobs
      (id,tenant,project,submission_key,payload_sha256,state,reserved_cents,
       credit_hold,max_attempts,attempts,current_fence,lease_until,
       provider_call_id,progress,created,updated)
      VALUES(?,?, ?, ?, ?, ?,60,3,2,?,?,?,?,?,900,900)`)
      .run(jid,tenant,project,key,'a'.repeat(64),state,attempts,fence,lease,provider,progress);
  }
  const user = (tenant = 'tenantA', project = 'projectA') => ({ tenant, project, signed: true });
  const worker = (job = 'G56_A') => ({ job, signed: true });
  return {
    db, controller, seed, user, worker, setNow: value => { now = value; },
    setProviderRemaining: value => { remainingCents = value; },
    row: (jid='G56_A') => db.prepare('SELECT * FROM g56_do_jobs WHERE id=?').get(jid),
    events: (jid='G56_A') => db.prepare('SELECT event FROM g56_do_events WHERE job_id=? ORDER BY seq').all(jid),
  };
}

test('unverified principals and foreign tenants cannot read or cancel jobs', () => {
  const f = fixture();
  f.seed();
  assert.throws(() => f.controller.status({ principal:null, tenant:'tenantA', jid:'G56_A' }),
                /IDENTITY_NOT_VERIFIED/);
  assert.throws(() => f.controller.status({ principal:f.user('tenantB'), tenant:'tenantA', jid:'G56_A' }),
                /IDENTITY_NOT_VERIFIED/);
  assert.throws(() => f.controller.cancel({ principal:f.user('tenantB'), tenant:'tenantA', jid:'G56_A' }),
                /IDENTITY_NOT_VERIFIED/);
  const visible = f.controller.status({ principal:f.user(), tenant:'tenantA', jid:'G56_A' });
  assert.equal(visible.state, 'QUEUED');
  assert.equal(visible.progress, 0);
  assert.equal('current_fence' in visible, false);
  assert.equal('provider_call_id' in visible, false);
});

test('same-tenant members cannot read or cancel another private project', () => {
  const f = fixture();
  f.seed({project:'projectB'});
  assert.throws(() => f.controller.status({
    principal:f.user('tenantA','projectA'),tenant:'tenantA',jid:'G56_A'
  }), /PROJECT_ROLE_NOT_VERIFIED/);
  assert.throws(() => f.controller.cancel({
    principal:f.user('tenantA','projectA'),tenant:'tenantA',jid:'G56_A'
  }), /PROJECT_ROLE_NOT_VERIFIED/);
  assert.equal(f.row().state,'QUEUED');
  assert.equal(f.events().length,0);
  const allowed=f.controller.status({
    principal:f.user('tenantA','projectB'),tenant:'tenantA',jid:'G56_A'
  });
  assert.equal(allowed.state,'QUEUED');
});

test('genuinely never-dispatched queued cancellation releases holds only once', () => {
  const f = fixture();
  f.seed();
  const a = f.controller.cancel({ principal:f.user(),tenant:'tenantA',jid:'G56_A' });
  assert.equal(a.state,'CANCELED');
  assert.equal(a.provider_cancel_required,false);
  assert.equal(f.row().credit_charge,0);
  assert.equal(f.row().charged_cents,0);
  const b = f.controller.cancel({ principal:f.user(),tenant:'tenantA',jid:'G56_A' });
  assert.equal(b.state,'CANCELED');
  assert.equal(f.events().length,1);
  assert.equal(f.events()[0].event,'CANCELED_BEFORE_DISPATCH');
});

test('a queued retry is NOT free cancellation when a previous attempt may have charges', () => {
  const f = fixture();
  f.seed({ attempts:1 });
  const a = f.controller.cancel({ principal:f.user(),tenant:'tenantA',jid:'G56_A' });
  assert.equal(a.state,'NEEDS_REVIEW');
  assert.equal(a.provider_cancel_required,false);
  assert.equal(f.row().reserved_cents,60);
  assert.equal(f.row().credit_hold,3);
  assert.equal(f.row().charged_cents,null);
  assert.equal(f.row().credit_charge,null);
  assert.equal(f.row().outcome_code,'PRIOR_ATTEMPT_USAGE_UNRECONCILED');
});

test('running cancellation requests provider stop but never assumes zero spending', () => {
  const f = fixture();
  f.seed({ state:'RUNNING', attempts:1, fence:'fenceA',lease:1020,provider:'fc-real' });
  const a = f.controller.cancel({ principal:f.user(),tenant:'tenantA',jid:'G56_A' });
  assert.equal(a.state,'CANCEL_REQUESTED');
  assert.equal(a.provider_cancel_required,true);
  assert.equal(f.row().charged_cents,null);
  assert.equal(f.row().credit_charge,null);
  f.controller.cancel({ principal:f.user(),tenant:'tenantA',jid:'G56_A' });
  assert.equal(f.events().length,1);
});

test('cancel on quarantined job does not erase NEEDS_REVIEW or release escrow', () => {
  const f = fixture();
  f.seed({ state:'NEEDS_REVIEW', attempts:1, fence:'fenceA',lease:990 });
  const a = f.controller.cancel({ principal:f.user(),tenant:'tenantA',jid:'G56_A' });
  assert.equal(a.state,'NEEDS_REVIEW');
  assert.equal(a.reconciliation_required,true);
  assert.equal(f.row().credit_hold,3);
  assert.equal(f.row().charged_cents,null);
});

test('progress needs trusted worker fence, live lease, and monotonic observed value', () => {
  const f = fixture();
  f.db.exec('UPDATE g56_do_control SET killed=0 WHERE id=1'); // offline simulated approval
  f.seed({ state:'RUNNING',attempts:1,fence:'fenceA',lease:1010,progress:10 });
  assert.throws(() => f.controller.progress({proof:null,tenant:'tenantA',jid:'G56_A',fence:'fenceA',percent:25}), /WORKER_NOT_VERIFIED/);
  assert.throws(() => f.controller.progress({proof:f.worker(),tenant:'tenantA',jid:'G56_A',fence:'wrong',percent:25}), /STALE_FENCE/);
  f.controller.progress({proof:f.worker(),tenant:'tenantA',jid:'G56_A',fence:'fenceA',percent:25});
  assert.equal(f.row().progress,25);
  assert.equal(f.row().lease_until,1030);
  assert.throws(() => f.controller.progress({proof:f.worker(),tenant:'tenantA',jid:'G56_A',fence:'fenceA',percent:20}), /PROGRESS_NOT_MONOTONIC/);
  f.setNow(1031);
  assert.throws(() => f.controller.progress({proof:f.worker(),tenant:'tenantA',jid:'G56_A',fence:'fenceA',percent:50}), /WORKER_LEASE_EXPIRED/);
  assert.equal(f.row().progress,25);
});

test('default emergency kill switch blocks any further worker progress', () => {
  const f = fixture();
  f.seed({ state:'RUNNING',attempts:1,fence:'fenceA',lease:1020,provider:'fc-real' });
  assert.throws(
    () => f.controller.progress({
      proof:f.worker(),tenant:'tenantA',jid:'G56_A',
      fence:'fenceA',percent:50
    }),
    /STUDIO_COMPUTE_KILL_SWITCH_ON/
  );
  assert.equal(f.row().progress,0);
  assert.equal(f.row().charged_cents,null);
});

test('emergencyStop denies outsiders, requests provider cancel and never releases holds', () => {
  const f=fixture();
  f.db.exec('UPDATE g56_do_control SET killed=0 WHERE id=1'); // offline fixture, not an arming API
  f.seed({ state:'RUNNING',attempts:1,fence:'fenceA',lease:1020,provider:'fc-real' });
  f.seed({jid:'G56_B',tenant:'tenantB',key:'submissionB'});
  assert.throws(
    () => f.controller.emergencyStop({proof:null}),
    /MAINTENANCE_AUTHORIZATION_REQUIRED/
  );
  assert.equal(f.db.prepare('SELECT killed FROM g56_do_control WHERE id=1').get().killed,0);
  const result=f.controller.emergencyStop({proof:'approved-private-maintainer'});
  assert.equal(result.killed,true);
  assert.equal(result.cancel_requested,1);
  assert.equal(f.row().state,'CANCEL_REQUESTED');
  assert.equal(f.row().reserved_cents,60);
  assert.equal(f.row().credit_hold,3);
  assert.equal(f.row().charged_cents,null);
  assert.equal(f.row().credit_charge,null);
  assert.equal(f.row('G56_B').state,'QUEUED');
  assert.equal(f.controller.emergencyStop({proof:'approved-private-maintainer'}).cancel_requested,0);
  assert.equal(f.events().filter(x=>x.event==='EMERGENCY_PROVIDER_CANCEL_REQUIRED').length,1);
});

test('quarantine stale attempts without retry or refunds and is idempotent', () => {
  const f = fixture();
  f.seed({ state:'RUNNING',attempts:1,fence:'fenceA',lease:999,provider:'fc-real' });
  assert.throws(() => f.controller.quarantineStale({proof:null}), /MAINTENANCE_AUTHORIZATION_REQUIRED/);
  assert.equal(f.controller.quarantineStale({proof:'approved-private-maintainer'}),1);
  assert.equal(f.row().state,'NEEDS_REVIEW');
  assert.equal(f.row().provider_call_id,'fc-real');
  assert.equal(f.row().reserved_cents,60);
  assert.equal(f.row().charged_cents,null);
  assert.equal(f.row().credit_charge,null);
  assert.equal(f.controller.quarantineStale({proof:'approved-private-maintainer'}),0);
  assert.equal(f.events().length,1);
});

function approveAdmission(db) {
  // Simulates a separate owner ceremony ONLY in disposable SQLite.
  db.exec('UPDATE g56_do_control SET killed=0 WHERE id=1');
}
function submitArgs({ principal = {tenant:'tenantA',project:'projectA',signed:true},
                      tenant='tenantA', key='key1', cost=60, credits=3,
                      hash='a'.repeat(64), attempts=2 } = {}) {
  return {principal,tenant,project:'projectA',submissionKey:key,
          payloadSha256:hash,maxCostCents:cost,creditUnits:credits,maxAttempts:attempts};
}

test('admission fails closed without budget, workspace binding or quote proof', () => {
  const missing=fixture();
  approveAdmission(missing.db);
  assert.throws(() => missing.controller.submit(submitArgs()),
                /PROVIDER_HARD_BUDGET_NOT_VERIFIED/);
  assert.equal(missing.db.prepare('SELECT count(*) n FROM g56_do_jobs').get().n,0);
  const unbound=fixture({budget:true,quote:true});
  approveAdmission(unbound.db);
  assert.throws(() => unbound.controller.submit(submitArgs()),
                /MODAL_WORKSPACE_NOT_BOUND/);
  const noQuote=fixture({budget:true,binding:true});
  approveAdmission(noQuote.db);
  assert.throws(() => noQuote.controller.submit(submitArgs()),
                /WORST_CASE_QUOTE_NOT_VERIFIED/);
  const killed=fixture({budget:true,binding:true,quote:true});
  assert.throws(() => killed.controller.submit(submitArgs()),
                /STUDIO_COMPUTE_KILL_SWITCH_ON/);
});

test('atomically submit once: duplicate request cannot mint reservation or change payload', () => {
  const f=fixture({budget:true,binding:true,quote:true});
  approveAdmission(f.db);
  const a=f.controller.submit(submitArgs());
  const b=f.controller.submit(submitArgs());
  assert.equal(a.job_id,b.job_id);
  assert.equal(a.state,'QUEUED');
  assert.equal(f.db.prepare('SELECT count(*) n FROM g56_do_jobs').get().n,1);
  assert.equal(f.row(a.job_id).reserved_cents,60);
  assert.equal(f.row(a.job_id).credit_hold,3);
  assert.throws(() => f.controller.submit(submitArgs({hash:'b'.repeat(64)})),
                /IDEMPOTENCY_KEY_PAYLOAD_CONFLICT/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM g56_do_jobs').get().n,1);
});

test('global provider remaining headroom cannot be allocated twice across tenants', () => {
  const f=fixture({budget:true,binding:true,quote:true});
  approveAdmission(f.db);
  f.setProviderRemaining(100);
  f.controller.submit(submitArgs({cost:60,key:'one'}));
  assert.throws(() => f.controller.submit(submitArgs({
    tenant:'tenantB',principal:f.user('tenantB'),cost:50,key:'two'
  })), /PROVIDER_GLOBAL_UNSETTLED_CAP/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM g56_do_jobs').get().n,1);
  const second=f.controller.submit(submitArgs({
    tenant:'tenantB',principal:f.user('tenantB'),cost:40,key:'two'
  }));
  assert.equal(second.state,'QUEUED');
  assert.equal(f.db.prepare('SELECT sum(reserved_cents) n FROM g56_do_jobs').get().n,100);
});

test('tenant daily cost, credit units and concurrency all cap reservation', () => {
  const f=fixture({budget:true,binding:true,quote:true});
  approveAdmission(f.db);
  f.controller.submit(submitArgs({key:'first',cost:100,credits:9}));
  assert.throws(() => f.controller.submit(submitArgs({key:'too-much-cost',cost:60,credits:0})),
                /TENANT_COST_CAP/);
  assert.throws(() => f.controller.submit(submitArgs({key:'too-many-credits',cost:10,credits:2})),
                /INSUFFICIENT_VERIFIED_CREDITS/);
  f.controller.submit(submitArgs({key:'second',cost:10,credits:1}));
  assert.throws(() => f.controller.submit(submitArgs({key:'third',cost:10,credits:0})),
                /TENANT_CONCURRENCY_CAP/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM g56_do_jobs').get().n,2);
});

test('fenced claim requires authenticated worker, budget, and denies repeat claim', () => {
  const f=fixture({budget:true,binding:true,quote:true});
  approveAdmission(f.db);
  const job=f.controller.submit(submitArgs());
  assert.throws(() => f.controller.claim({proof:null,workerId:'workerCPU'}),
                /WORKER_CLAIM_NOT_VERIFIED/);
  const first=f.controller.claim({proof:'local-private-worker',workerId:'workerCPU',leaseSeconds:30});
  assert.equal(first.job_id,job.job_id);
  assert.match(first.fence,/^[A-Fa-f0-9-]{30,}$/);
  assert.equal(f.row(job.job_id).state,'RUNNING');
  assert.equal(f.row(job.job_id).attempts,1);
  assert.equal(f.controller.claim({proof:'local-private-worker',workerId:'workerCPU'}),null);
  f.controller.emergencyStop({proof:'approved-private-maintainer'});
  assert.throws(() => f.controller.claim({proof:'local-private-worker',workerId:'workerCPU'}),
                /STUDIO_COMPUTE_KILL_SWITCH_ON/);
  assert.equal(f.row(job.job_id).credit_charge,null);
});

test('potential prior attempt is quarantined; never silently autoreties', () => {
  const f=fixture({budget:true,binding:true,quote:true});
  approveAdmission(f.db);
  f.seed({attempts:1, key:'retry-uncertain'});
  assert.equal(f.controller.claim({proof:'local-private-worker',workerId:'workerCPU'}),null);
  assert.equal(f.row().state,'NEEDS_REVIEW');
  assert.equal(f.row().reserved_cents,60);
  assert.equal(f.row().charged_cents,null);
  assert.equal(f.row().credit_charge,null);
  assert.equal(f.events().filter(x=>x.event==='AUTO_RETRY_QUARANTINED').length,1);
});

test('fail closed without independent identity, worker and maintenance adapters', () => {
  const f = fixture();
  f.seed();
  const untrusted = new G56DurableQueueController({
    sql: {exec: (...args) => f.controller.storage.sql.exec(...args)},
    transactionSync: fn => f.controller.storage.transactionSync(fn)
  },{now:()=>1000});
  assert.throws(() => untrusted.status({principal:f.user(),tenant:'tenantA',jid:'G56_A'}), /IDENTITY_NOT_VERIFIED/);
  assert.throws(() => untrusted.cancel({principal:f.user(),tenant:'tenantA',jid:'G56_A'}), /IDENTITY_NOT_VERIFIED/);
  assert.throws(() => untrusted.quarantineStale({proof:'approved-private-maintainer'}), /MAINTENANCE_AUTHORIZATION_REQUIRED/);
});

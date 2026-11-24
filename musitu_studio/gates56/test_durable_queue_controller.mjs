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

function fixture() {
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
  const authorizeUser = (principal, tenant) =>
    principal?.signed === true && principal.tenant === tenant;
  const authorizeWorker = (proof, job) =>
    proof?.signed === true && proof.job === job;
  const authorizeMaintenance = (proof) => proof === 'approved-private-maintainer';
  const controller = new G56DurableQueueController(storage, {
    authorizeUser, authorizeWorker, authorizeMaintenance,
    now: () => now,
  });
  function seed({ jid = 'G56_A', tenant = 'tenantA', key = 'submissionA',
                  state = 'QUEUED', attempts = 0, fence = null,
                  lease = null, provider = null, progress = 0 } = {}) {
    db.prepare(`INSERT INTO g56_do_jobs
      (id,tenant,project,submission_key,payload_sha256,state,reserved_cents,
       credit_hold,max_attempts,attempts,current_fence,lease_until,
       provider_call_id,progress,created,updated)
      VALUES(?,?, 'projectA', ?, ?, ?,60,3,2,?,?,?,?,?,900,900)`)
      .run(jid,tenant,key,'a'.repeat(64),state,attempts,fence,lease,provider,progress);
  }
  const user = (tenant = 'tenantA') => ({ tenant, signed: true });
  const worker = (job = 'G56_A') => ({ job, signed: true });
  return {
    db, controller, seed, user, worker, setNow: value => { now = value; },
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

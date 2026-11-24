/**
 * MUSITU Studio G5/G6 — UNHOSTED SQLite Durable Object queue controller.
 *
 * This module does not implement chargeable admissions, provider dispatch,
 * trusted Modal budget checks, public routes, payment settlement, or cloud
 * storage. It intentionally cannot start renders. A caller must supply
 * independently verified user/worker/maintenance identity adapters.
 * No endpoints, secrets, or credentials are embedded here.
 */
export class QueueGateClosed extends Error {}
export class QueueConflict extends Error {}

const NAME = /^[A-Za-z0-9_-]{1,128}$/;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED']);

export class G56DurableQueueController {
  constructor(storage, { authorizeUser, authorizeWorker, authorizeMaintenance, now } = {}) {
    if (!storage?.sql?.exec || typeof storage.transactionSync !== 'function')
      throw new QueueGateClosed('SQLITE_DURABLE_STORAGE_REQUIRED');
    this.storage = storage;
    this.authorizeUser = authorizeUser;
    this.authorizeWorker = authorizeWorker;
    this.authorizeMaintenance = authorizeMaintenance;
    this.now = now || (() => Math.floor(Date.now() / 1000));
  }

  _time() {
    const n = this.now();
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new QueueGateClosed('INVALID_TRUSTED_CLOCK');
    return n;
  }

  _selector(tenant, jid) {
    if (typeof tenant !== 'string' || !NAME.test(tenant) ||
        typeof jid !== 'string' || !NAME.test(jid))
      throw new QueueGateClosed('INVALID_QUEUE_SELECTOR');
  }

  _identity(principal, tenant) {
    if (typeof this.authorizeUser !== 'function' ||
        this.authorizeUser(principal, tenant) !== true)
      throw new QueueGateClosed('IDENTITY_NOT_VERIFIED');
  }

  _worker(proof, jid) {
    if (typeof this.authorizeWorker !== 'function' ||
        this.authorizeWorker(proof, jid) !== true)
      throw new QueueGateClosed('WORKER_NOT_VERIFIED');
  }

  _maintenance(proof) {
    if (typeof this.authorizeMaintenance !== 'function' ||
        this.authorizeMaintenance(proof) !== true)
      throw new QueueGateClosed('MAINTENANCE_AUTHORIZATION_REQUIRED');
  }

  _row(query, ...params) {
    return Array.from(this.storage.sql.exec(query, ...params))[0] ?? null;
  }

  _run(query, ...params) {
    this.storage.sql.exec(query, ...params);
  }

  _job(tenant, jid) {
    const row = this._row(
      'SELECT * FROM g56_do_jobs WHERE tenant=? AND id=?', tenant, jid
    );
    if (!row) throw new QueueGateClosed('JOB_NOT_FOUND_OR_NOT_OWNED');
    return row;
  }

  _event(jid, event, at) {
    this._run('INSERT INTO g56_do_events(job_id,at,event,detail) VALUES(?,?,?,?)',
      jid, at, event, '');
  }

  _safe(row) {
    // Never surface the worker fence, provider call identifier, internal
    // reservation, or artifact paths from a status/cancellation read.
    return {
      job_id: row.id,
      state: row.state,
      progress: row.progress,
      reconciliation_required: row.state === 'NEEDS_REVIEW',
      provider_cancel_required: row.state === 'RUNNING' || row.state === 'CANCEL_REQUESTED'
    };
  }

  status({ principal, tenant, jid } = {}) {
    this._selector(tenant, jid);
    this._identity(principal, tenant);
    return this._safe(this._job(tenant, jid));
  }

  cancel({ principal, tenant, jid } = {}) {
    this._selector(tenant, jid);
    this._identity(principal, tenant);
    const at = this._time();
    return this.storage.transactionSync(() => {
      const row = this._job(tenant, jid);
      if (TERMINAL.has(row.state) || row.state === 'CANCEL_REQUESTED' ||
          row.state === 'NEEDS_REVIEW') return this._safe(row);
      if (row.state === 'QUEUED') {
        // A queued retry could have a previously billed provider attempt.
        // Only a job with no attempt, fence or call can be zero-charged.
        const neverDispatched = row.attempts === 0 &&
          row.provider_call_id === null && row.current_fence === null;
        if (neverDispatched) {
          this._run(`UPDATE g56_do_jobs SET
            state='CANCELED',charged_cents=0,credit_charge=0,updated=?
            WHERE id=? AND tenant=? AND state='QUEUED'`,at,jid,tenant);
          this._event(jid, 'CANCELED_BEFORE_DISPATCH', at);
        } else {
          this._run(`UPDATE g56_do_jobs SET
            state='NEEDS_REVIEW',outcome_code='PRIOR_ATTEMPT_USAGE_UNRECONCILED',updated=?
            WHERE id=? AND tenant=? AND state='QUEUED'`,at,jid,tenant);
          this._event(jid, 'QUEUED_CANCEL_PRIOR_USAGE_HELD', at);
        }
      } else if (row.state === 'RUNNING') {
        // This is only a request. An independent provider stop+cost receipt
        // is required before credits or reservations can be released.
        this._run(`UPDATE g56_do_jobs SET state='CANCEL_REQUESTED',updated=?
          WHERE id=? AND tenant=? AND state='RUNNING'`,at,jid,tenant);
        this._event(jid, 'CANCEL_REQUESTED_NO_REFUND', at);
      } else {
        throw new QueueConflict('STATE_REQUIRES_MANUAL_RECONCILIATION');
      }
      return this._safe(this._job(tenant, jid));
    });
  }

  progress({ proof, tenant, jid, fence, percent } = {}) {
    this._selector(tenant, jid);
    this._worker(proof, jid);
    if (typeof fence !== 'string' || !NAME.test(fence))
      throw new QueueConflict('STALE_FENCE');
    if (!Number.isSafeInteger(percent) || percent < 1 || percent > 99)
      throw new QueueGateClosed('INVALID_OBSERVED_PROGRESS');
    const at = this._time();
    return this.storage.transactionSync(() => {
      const row = this._job(tenant, jid);
      if (row.state !== 'RUNNING' || row.current_fence !== fence)
        throw new QueueConflict('STALE_FENCE');
      if (!Number.isSafeInteger(row.lease_until) || row.lease_until <= at)
        throw new QueueConflict('WORKER_LEASE_EXPIRED');
      if (percent < row.progress)
        throw new QueueConflict('PROGRESS_NOT_MONOTONIC');
      this._run(`UPDATE g56_do_jobs SET progress=?,lease_until=?,updated=?
        WHERE id=? AND tenant=? AND state='RUNNING' AND current_fence=?`,
        percent, at+30, at, jid,tenant,fence);
      if (percent > row.progress) this._event(jid, 'OBSERVED_PROGRESS', at);
      return this._safe(this._job(tenant, jid));
    });
  }

  quarantineStale({ proof } = {}) {
    this._maintenance(proof);
    const at = this._time();
    return this.storage.transactionSync(() => {
      const rows = Array.from(this.storage.sql.exec(
        `SELECT id FROM g56_do_jobs WHERE state IN ('RUNNING','CANCEL_REQUESTED')
           AND (lease_until IS NULL OR lease_until<=?) ORDER BY id`, at
      ));
      for (const row of rows) {
        this._run(`UPDATE g56_do_jobs SET state='NEEDS_REVIEW',
          outcome_code='LEASE_EXPIRED_USAGE_UNRECONCILED',updated=?
          WHERE id=? AND state IN ('RUNNING','CANCEL_REQUESTED')`,
          at,row.id);
        this._event(row.id,'STALE_ATTEMPT_QUARANTINED',at);
      }
      return rows.length;
    });
  }
}

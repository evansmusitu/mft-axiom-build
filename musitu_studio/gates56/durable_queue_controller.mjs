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
  constructor(storage, { authorizeUser, authorizeProject, authorizeWorker, authorizeMaintenance, authorizeClaim, readProviderCap, verifyWorstCaseQuote, expectedWorkspace, now } = {}) {
    if (!storage?.sql?.exec || typeof storage.transactionSync !== 'function')
      throw new QueueGateClosed('SQLITE_DURABLE_STORAGE_REQUIRED');
    this.storage = storage;
    this.authorizeUser = authorizeUser;
    this.authorizeProject = authorizeProject;
    this.authorizeWorker = authorizeWorker;
    this.authorizeMaintenance = authorizeMaintenance;
    // These must be independently verified trusted backend adapters. They are
    // unavailable in the hosted app and all default to fail closed.
    this.authorizeClaim = authorizeClaim;
    this.readProviderCap = readProviderCap;
    this.verifyWorstCaseQuote = verifyWorstCaseQuote;
    this.expectedWorkspace = expectedWorkspace;
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

  _project(principal, tenant, project, purpose) {
    // Tenant membership alone does not grant access to another project.
    // This callback must be a trusted, externally verified role check.
    if (typeof this.authorizeProject !== 'function' ||
        this.authorizeProject(principal, tenant, project, purpose) !== true)
      throw new QueueGateClosed('PROJECT_ROLE_NOT_VERIFIED');
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

  _open() {
    const status=this._row('SELECT killed FROM g56_do_control WHERE id=1');
    if (!status || status.killed !== 0)
      throw new QueueGateClosed('STUDIO_COMPUTE_KILL_SWITCH_ON');
  }

  _providerBudget(at) {
    // NEVER source this from the client or a self-asserted billing summary.
    // A real adapter must independently attest the *enforced* provider cap,
    // identity, net available headroom, and freshness BEFORE entering here.
    // Billing readback alone does not qualify; all defaults deny.
    if (typeof this.readProviderCap !== 'function')
      throw new QueueGateClosed('PROVIDER_HARD_BUDGET_NOT_VERIFIED');
    if (typeof this.expectedWorkspace !== 'string' ||
        !NAME.test(this.expectedWorkspace))
      throw new QueueGateClosed('MODAL_WORKSPACE_NOT_BOUND');
    let cap;
    try { cap=this.readProviderCap(); }
    catch { throw new QueueGateClosed('PROVIDER_HARD_BUDGET_UNAVAILABLE'); }
    if (!cap || cap.provider !== 'MODAL' ||
        cap.workspace !== this.expectedWorkspace ||
        typeof cap.controlId !== 'string' || cap.controlId.length < 8 ||
        cap.hardEnforced !== true ||
        !Number.isSafeInteger(cap.monthlyCapCents) ||
        !Number.isSafeInteger(cap.remainingCents) ||
        !Number.isSafeInteger(cap.checkedUnix) ||
        cap.monthlyCapCents <= 0 || cap.remainingCents < 0 ||
        cap.checkedUnix > at || at-cap.checkedUnix > 60)
      throw new QueueGateClosed('PROVIDER_HARD_BUDGET_NOT_VERIFIED');
    return cap;
  }

  _reservedProviderExposure() {
    return this._row(`SELECT COALESCE(SUM(reserved_cents),0) AS exposure
      FROM g56_do_jobs WHERE state IN
      ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')`)?.exposure ?? 0;
  }

  _checkHeadroom(cap, additional=0) {
    const need=this._reservedProviderExposure()+additional;
    if (!Number.isSafeInteger(need) ||
        need > cap.remainingCents || need > cap.monthlyCapCents)
      throw new QueueGateClosed('PROVIDER_GLOBAL_UNSETTLED_CAP');
  }

  _tenantSpend(tenant, since) {
    return this._row(`SELECT COALESCE(SUM(
      CASE WHEN state IN ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')
        THEN reserved_cents ELSE COALESCE(charged_cents,0) END),0) AS spent
      FROM g56_do_jobs WHERE tenant=? AND created>=?`,tenant,since)?.spent ?? 0;
  }

  _tenantCredits(tenant) {
    return this._row(`SELECT COALESCE(SUM(
      CASE WHEN state IN ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')
        THEN credit_hold ELSE COALESCE(credit_charge,0) END),0) AS used
      FROM g56_do_jobs WHERE tenant=?`,tenant)?.used ?? 0;
  }

  submit({ principal, tenant, project, submissionKey, payloadSha256,
           maxCostCents, creditUnits, maxAttempts=1 } = {}) {
    this._selector(tenant, project);
    this._identity(principal,tenant);
    this._project(principal,tenant,project,'write');
    if (typeof submissionKey !== 'string' || !NAME.test(submissionKey) ||
        typeof payloadSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(payloadSha256) ||
        !Number.isSafeInteger(maxCostCents) || maxCostCents <= 0 ||
        maxCostCents > 100000000 ||
        !Number.isSafeInteger(creditUnits) || creditUnits < 0 ||
        !Number.isSafeInteger(maxAttempts) ||
        maxAttempts < 1 || maxAttempts > 2)
      throw new QueueGateClosed('INVALID_BOUNDED_RESERVATION');

    const at=this._time();
    return this.storage.transactionSync(() => {
      const old=this._row(
        'SELECT * FROM g56_do_jobs WHERE tenant=? AND submission_key=?',
        tenant,submissionKey);
      if (old) {
        if (old.project!==project || old.payload_sha256!==payloadSha256 ||
            old.reserved_cents!==maxCostCents ||
            old.credit_hold!==creditUnits || old.max_attempts!==maxAttempts)
          throw new QueueConflict('IDEMPOTENCY_KEY_PAYLOAD_CONFLICT');
        return this._safe(old);
      }
      this._open();
      // Budget authority is a prerequisite even to evaluate an admissible
      // quote; absent authority takes precedence over simulated quote checks.
      const cap=this._providerBudget(at);
      if (typeof this.verifyWorstCaseQuote !== 'function' ||
          this.verifyWorstCaseQuote({
            tenant,project,payloadSha256,maxCostCents,maxAttempts
          }) !== true)
        throw new QueueGateClosed('WORST_CASE_QUOTE_NOT_VERIFIED');
      this._checkHeadroom(cap,maxCostCents);
      const settings=this._row(
        'SELECT * FROM g56_do_tenants WHERE tenant=?',tenant);
      if (!settings)throw new QueueGateClosed('TENANT_NOT_APPROVED');
      const count=this._row(`SELECT COUNT(*) AS active
        FROM g56_do_jobs WHERE tenant=? AND state IN
        ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')`,tenant)?.active ?? 0;
      if (count >= settings.max_active)
        throw new QueueGateClosed('TENANT_CONCURRENCY_CAP');
      const day=Math.floor(at/86400)*86400;
      const date=new Date(at*1000);
      const month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)/1000;
      if (this._tenantSpend(tenant,day)+maxCostCents > settings.daily_cents ||
          this._tenantSpend(tenant,month)+maxCostCents > settings.monthly_cents)
        throw new QueueGateClosed('TENANT_COST_CAP');
      if (this._tenantCredits(tenant)+creditUnits > settings.total_credit_units)
        throw new QueueGateClosed('INSUFFICIENT_VERIFIED_CREDITS');
      const jid='G56_'+crypto.randomUUID().replaceAll('-','');
      this._run(`INSERT INTO g56_do_jobs(
        id,tenant,project,submission_key,payload_sha256,state,
        reserved_cents,credit_hold,max_attempts,created,updated)
        VALUES(?,?,?,?,?,'QUEUED',?,?,?,?,?)`,
        jid,tenant,project,submissionKey,payloadSha256,maxCostCents,
        creditUnits,maxAttempts,at,at);
      this._event(jid,'RESERVED_PROVIDER_QUOTE_REQUIRED',at);
      return this._safe(this._job(tenant,jid));
    });
  }

  claim({ proof,workerId,leaseSeconds=60 } = {}) {
    if (typeof workerId !== 'string' || !NAME.test(workerId) ||
        !Number.isSafeInteger(leaseSeconds) ||
        leaseSeconds < 10 || leaseSeconds > 600)
      throw new QueueGateClosed('INVALID_WORKER_LEASE');
    if (typeof this.authorizeClaim !== 'function' ||
        this.authorizeClaim(proof,workerId)!==true)
      throw new QueueGateClosed('WORKER_CLAIM_NOT_VERIFIED');
    const at=this._time();
    return this.storage.transactionSync(() => {
      this._open();
      const cap=this._providerBudget(at);
      this._checkHeadroom(cap);
      // One globally serialized CPU lane, not one lane per tenant. A running,
      // cancellation-pending or quarantined provider call could still bill
      // after a worker lease expires. Until authoritative reconciliation,
      // refuse further claims rather than letting another tenant spend.
      const uncertain=this._row(`SELECT COUNT(*) AS unsettled
        FROM g56_do_jobs WHERE state IN
        ('RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')`);
      if (!uncertain || uncertain.unsettled > 0)
        return null;
      const job=this._row(`SELECT * FROM g56_do_jobs WHERE state='QUEUED'
        ORDER BY created,id LIMIT 1`);
      if (!job)return null;
      // Previous external attempts cannot be retried automatically, even
      // after a worker crash. Hold worst-case cost and require review.
      if (job.attempts !== 0 || job.provider_call_id !== null ||
          job.current_fence !== null) {
        this._run(`UPDATE g56_do_jobs SET state='NEEDS_REVIEW',
          outcome_code='AUTO_RETRY_FORBIDDEN',updated=? WHERE id=? AND state='QUEUED'`,
          at,job.id);
        this._event(job.id,'AUTO_RETRY_QUARANTINED',at);
        return null;
      }
      const fence=crypto.randomUUID();
      this._run(`UPDATE g56_do_jobs SET state='RUNNING',attempts=1,
        current_fence=?,lease_until=?,progress=1,updated=?
        WHERE id=? AND state='QUEUED'`,fence,at+leaseSeconds,at,job.id);
      this._run(`INSERT INTO g56_do_attempts
        (job_id,attempt_no,fence,worker_id,started)
        VALUES(?,1,?,?,?)`,job.id,fence,workerId,at);
      this._event(job.id,'ATTEMPT_CLAIMED_NO_PROVIDER_SPAWN',at);
      return {job_id:job.id,tenant:job.tenant,project:job.project,
        payload_sha256:job.payload_sha256,
        fence,lease_until:at+leaseSeconds,attempts:1};
    });
  }

  status({ principal, tenant, jid } = {}) {
    this._selector(tenant, jid);
    this._identity(principal, tenant);
    const row = this._job(tenant, jid);
    this._project(principal, tenant, row.project, 'read');
    return this._safe(row);
  }

  cancel({ principal, tenant, jid } = {}) {
    this._selector(tenant, jid);
    this._identity(principal, tenant);
    const at = this._time();
    return this.storage.transactionSync(() => {
      const row = this._job(tenant, jid);
      this._project(principal, tenant, row.project, 'write');
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
      const control = this._row('SELECT killed FROM g56_do_control WHERE id=1');
      if (!control || control.killed !== 0)
        throw new QueueGateClosed('STUDIO_COMPUTE_KILL_SWITCH_ON');
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

  emergencyStop({ proof } = {}) {
    this._maintenance(proof);
    const at = this._time();
    return this.storage.transactionSync(() => {
      // A stop can always be asserted. There is deliberately no arming method
      // here: G5 provider hard-cap evidence and explicit owner ceremony
      // would be needed to create one.
      this._run('UPDATE g56_do_control SET killed=1,updated_at=? WHERE id=1',at);
      const active = Array.from(this.storage.sql.exec(
        "SELECT id FROM g56_do_jobs WHERE state='RUNNING' ORDER BY id"
      ));
      for (const row of active) {
        // Request termination; never infer the external call was stopped and
        // NEVER release reserved credits or write a zero provider cost.
        this._run(`UPDATE g56_do_jobs SET state='CANCEL_REQUESTED',updated=?
          WHERE id=? AND state='RUNNING'`,at,row.id);
        this._event(row.id,'EMERGENCY_PROVIDER_CANCEL_REQUIRED',at);
      }
      return { killed:true, cancel_requested:active.length };
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

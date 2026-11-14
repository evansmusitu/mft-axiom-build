/** Transient preview-only D1 batch qualification. No user SQL or customer routes. */
const MAIN = 'axiom_gate2_native_main_20261114';
const LATE = 'axiom_gate2_native_late_20261114';
const CLAIM = 'axiom_gate2_native_claim_20261114';
const AUDIT = 'axiom_gate2_native_audit_20261114';
const names = [MAIN, LATE, CLAIM, AUDIT];
const must = (ok, code) => { if (!ok) throw new Error(code); };
const scalar = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).first());
const knownError = (error, phrase) => typeof error?.message === 'string' && error.message.includes(phrase);

export async function qualifyNativeBatch(db) {
  const r = { schema: 'musitu.axiom.native-d1-batch-checks.v1', tests: [], writes_attempted: false,
    real_customer_login_qualified: false, production_oauth_migrated: false, release_status: 'NOT_RELEASE' };
  const pass = name => r.tests.push({ name, result: 'PASS' });
  try {
    must(db?.prepare && db?.batch, 'D1_BINDING_MISSING');
    const existing = await scalar(db, 'SELECT count(*) AS n FROM sqlite_schema WHERE name IN (?,?,?,?)', ...names);
    must(existing?.n === 0, 'NATIVE_FIXTURE_NAME_COLLISION');
    const foreign = await scalar(db, 'SELECT foreign_keys AS n FROM pragma_foreign_keys');
    const checks = await scalar(db, 'SELECT ignore_check_constraints AS n FROM pragma_ignore_check_constraints');
    must(foreign?.n === 1 && checks?.n === 0, 'NATIVE_CONSTRAINT_ENFORCEMENT_UNQUALIFIED');
    pass('reviewed_migration_pragma_guards_supported');
    r.writes_attempted = true;
    await db.batch([
      db.prepare(`CREATE TABLE ${MAIN}(id INTEGER PRIMARY KEY, value TEXT NOT NULL)`),
      db.prepare(`INSERT INTO ${MAIN}(id,value) VALUES(1,'before_failure')`),
    ]);
    must((await scalar(db, `SELECT count(*) AS n FROM ${MAIN} WHERE id=1 AND value='before_failure'`))?.n === 1,
      'NATIVE_BATCH_CREATE_INSERT_FAILED');
    pass('native_batch_sequential_ddl_and_insert');
    let denied;
    try {
      await db.batch([
        db.prepare(`UPDATE ${MAIN} SET value='must_rollback' WHERE id=1`),
        db.prepare(`CREATE TABLE ${LATE}(id INTEGER PRIMARY KEY, value TEXT NOT NULL)`),
        db.prepare(`DROP TABLE ${MAIN}`),
        db.prepare(`INSERT INTO ${LATE}(id,value) VALUES(1,NULL)`),
      ]);
    } catch (error) { denied = knownError(error, 'NOT NULL constraint failed'); }
    must(denied, 'EXPECTED_LATE_BATCH_FAILURE_NOT_OBSERVED');
    must((await scalar(db, `SELECT count(*) AS n FROM ${MAIN} WHERE id=1 AND value='before_failure'`))?.n === 1,
      'NATIVE_BATCH_DATA_ROLLBACK_FAILED');
    must((await scalar(db, 'SELECT count(*) AS n FROM sqlite_schema WHERE name=?', LATE))?.n === 0,
      'NATIVE_BATCH_DDL_ROLLBACK_FAILED');
    pass('late_batch_constraint_failure_restores_prior_data');
    pass('late_batch_constraint_failure_restores_create_and_drop_ddl');
    await db.batch([
      db.prepare(`CREATE TABLE ${CLAIM}(id INTEGER PRIMARY KEY, owner TEXT NOT NULL)`),
      db.prepare(`CREATE TABLE ${AUDIT}(owner TEXT PRIMARY KEY)`),
    ]);
    const contender = async owner => {
      try {
        await db.batch([
          db.prepare(`INSERT INTO ${CLAIM}(id,owner) VALUES(1,?)`).bind(owner),
          db.prepare(`INSERT INTO ${AUDIT}(owner) VALUES(?)`).bind(owner),
        ]);
        return 'committed';
      } catch (error) { if (knownError(error, 'UNIQUE constraint failed')) return 'constraint_denied'; throw error; }
    };
    const outcomes = await Promise.all([contender('synthetic-a'), contender('synthetic-b')]);
    must(outcomes.filter(value => value === 'committed').length === 1 &&
      outcomes.filter(value => value === 'constraint_denied').length === 1, 'COMPETING_BATCH_ADMISSION_FAILED');
    const joined = await scalar(db, `SELECT count(*) AS n FROM ${CLAIM} c JOIN ${AUDIT} a ON a.owner=c.owner WHERE c.id=1`);
    must(joined?.n === 1 && (await scalar(db, `SELECT count(*) AS n FROM ${AUDIT}`))?.n === 1,
      'COMPETING_BATCH_PARTIAL_COMMIT');
    pass('competing_batches_admit_exactly_one_writer');
    pass('rejected_competing_batch_has_no_partial_audit_write');
    r.status = 'NATIVE_D1_BATCH_BEHAVIOR_VERIFIED';
  } catch {
    r.status = 'NATIVE_D1_BATCH_BEHAVIOR_NOT_QUALIFIED';
    r.failure_stage = r.writes_attempted ? 'NATIVE_BATCH_OR_ROLLBACK' : 'NATIVE_ADMISSION_OR_PRAGMAS';
  }
  return r;
}

export async function readNativePersistence(db) {
  const r = { schema: 'musitu.axiom.native-d1-fresh-preview-readback.v1', release_status: 'NOT_RELEASE' };
  try {
    const main = await scalar(db, `SELECT count(*) AS n FROM ${MAIN} WHERE id=1 AND value='before_failure'`);
    const joined = await scalar(db, `SELECT count(*) AS n FROM ${CLAIM} c JOIN ${AUDIT} a ON a.owner=c.owner WHERE c.id=1`);
    const late = await scalar(db, 'SELECT count(*) AS n FROM sqlite_schema WHERE name=?', LATE);
    must(main?.n === 1 && joined?.n === 1 && late?.n === 0, 'FRESH_PREVIEW_STATE_MISMATCH');
    r.status = 'NATIVE_D1_STATE_SURVIVES_FRESH_PREVIEW_SESSION';
  } catch { r.status = 'NATIVE_D1_FRESH_PREVIEW_READBACK_NOT_QUALIFIED'; }
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/gate2/native-batch' ||
      typeof env.GATE2_PROBE_KEY !== 'string' || env.GATE2_PROBE_KEY.length !== 64 ||
      request.headers.get('authorization') !== 'Bearer ' + env.GATE2_PROBE_KEY)
      return new Response(null, { status: 404 });
    let body;
    try { const raw = await request.text(); if (raw.length > 200) throw new Error(); body = JSON.parse(raw); }
    catch { return new Response(null, { status: 400 }); }
    if (!body || Object.keys(body).join('|') !== 'operation') return new Response(null, { status: 400 });
    let result;
    if (body?.operation === 'qualify-native-batch') result = await qualifyNativeBatch(env.RECOVERY_DB);
    else if (body?.operation === 'fresh-preview-readback') result = await readNativePersistence(env.RECOVERY_DB);
    else return new Response(null, { status: 400 });
    return Response.json({ ...result, preview_instance_tag: env.GATE2_INSTANCE_TAG }, {
      status: result.status.includes('NOT_QUALIFIED') ? 409 : 200,
      headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  },
};

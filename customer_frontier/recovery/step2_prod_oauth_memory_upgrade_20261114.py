"""Rehearse the unchanged 89-statement plan on a memory-only recovered SQL copy.

Input and SQL values never enter output, disk files, logs, or error messages.
This is a local preflight, not native D1 migration acceptance.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PLAN_SHA = '6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fingerprinter = load('axiom_typed_fingerprint', HERE / 'step2_sql_memory_fingerprint_20261114.py')
upgrade = load('axiom_reviewed_upgrade', ROOT / 'auth/oauth_identity_upgrade_v2.py')


def probe(sql):
    r = {'schema': 'musitu.axiom.production-oauth-memory-upgrade.v1', 'hosted_migration_qualified': False,
         'plaintext_written': False, 'release_status': 'NOT_RELEASE', 'status': 'LOCAL_PREFLIGHT_PENDING'}
    db = None
    phase = 'SOURCE_VALIDATION'
    statement_index = None
    plan = None
    try:
        baseline = fingerprinter.fingerprint(sql)
        r['baseline'] = baseline
        plan = upgrade.build_plan()
        if plan['plan_sha256'] != PLAN_SHA or len(plan['statements']) != 89:
            raise ValueError('REVIEWED_PLAN_DRIFT')
        r['plan_sha256'] = PLAN_SHA
        r['statement_count'] = 89
        phase = 'PRIVATE_MEMORY_LOAD'
        db = sqlite3.connect(':memory:', isolation_level=None)
        db.enable_load_extension(False)
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('PRAGMA temp_store=MEMORY')
        db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 8_000_000)
        db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 8_000_000)
        deadline = time.monotonic() + 20

        def authorize(action, arg1, arg2, *_):
            if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() in ('load_extension', 'readfile', 'writefile'):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_PRAGMA and str(arg1).lower() not in (
                'foreign_keys', 'defer_foreign_keys', 'integrity_check', 'foreign_key_check', 'foreign_key_list',
                'table_info', 'ignore_check_constraints'):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        db.set_authorizer(authorize)
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        db.executescript(sql.decode('utf-8'))
        if db.in_transaction:
            db.commit()
        db.execute('PRAGMA foreign_keys=ON')
        if db.execute('PRAGMA foreign_keys').fetchone()[0] != 1 or db.execute('PRAGMA ignore_check_constraints').fetchone()[0] != 0:
            raise ValueError('MEMORY_ENFORCEMENT_INVALID')
        phase = 'REVIEWED_PLAN'
        db.execute('BEGIN IMMEDIATE')
        # The exact reviewed plan, one local transaction. Hosted use still
        # requires one native D1Database.batch and separate hosted evidence.
        for statement_index, statement in enumerate(plan['statements'], start=1):
            db.execute(statement)
        db.execute('COMMIT')
        phase = 'EXPECTED_STATE_FINGERPRINT'
        expected_sql = '\n'.join(db.iterdump()).encode('utf-8')
        r['expected_after_upgrade'] = fingerprinter.fingerprint(expected_sql)
        r['status'] = 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_PASSED'
    except BaseException as exc:
        if db is not None and db.in_transaction:
            db.execute('ROLLBACK')
        r['status'] = 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_REJECTED'
        r['failure_phase'] = phase
        if phase == 'REVIEWED_PLAN' and statement_index is not None:
            r['failed_statement_index'] = statement_index
            r['failed_statement_sha256'] = hashlib.sha256(plan['statements'][statement_index - 1].encode()).hexdigest()
        code = getattr(exc, 'sqlite_errorname', None)
        r['error_kind'] = code if code in ('SQLITE_CONSTRAINT_NOTNULL', 'SQLITE_CONSTRAINT_CHECK',
            'SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_ERROR', 'SQLITE_AUTH', 'SQLITE_INTERRUPT') else 'SANITIZED_LOCAL_REJECTION'
        if db is not None and phase == 'REVIEWED_PLAN':
            after = fingerprinter.fingerprint('\n'.join(db.iterdump()).encode('utf-8'))
            r['local_rollback_matches_baseline'] = after == r['baseline']
    finally:
        if db is not None:
            db.close()
    return r


if __name__ == '__main__':
    try:
        result = probe(sys.stdin.buffer.read(8_000_001))
    except BaseException:
        result = {'schema': 'musitu.axiom.production-oauth-memory-upgrade.v1',
            'status': 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_REJECTED',
            'failure_phase': 'SANITIZED_DIAGNOSTIC_FAILURE', 'plaintext_written': False,
            'hosted_migration_qualified': False, 'release_status': 'NOT_RELEASE'}
    print(json.dumps(result, separators=(',', ':')))
    raise SystemExit(0 if result['status'] == 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_PASSED' else 2)

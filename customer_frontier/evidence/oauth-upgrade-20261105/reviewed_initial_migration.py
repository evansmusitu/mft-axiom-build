"""Offline existing-schema upgrade and deterministic D1 review-plan builder.

No network, credential handling, public route or hosted application. A hosted
operator must qualify and execute the complete plan in ONE D1Database.batch;
never db.exec, per-statement commits or a REST atomicity assumption.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parent
VERSION = 2
GUARD = 'oauth_identity_upgrade_v2_guard'
VERSIONS = 'oauth_identity_schema_versions'


def statements(text: str) -> list[str]:
    """Split trusted repository SQL, preserving trigger BEGIN/END bodies."""
    text = re.sub(r'--[^\n]*', '', text)
    result, pending = [], ''
    for char in text:
        pending += char
        if char == ';' and sqlite3.complete_statement(pending):
            result.append(pending.strip())
            pending = ''
    if pending.strip():
        raise ValueError('incomplete_upgrade_sql')
    return result


def _quoted(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _assert(condition: str) -> str:
    return f'INSERT INTO {GUARD}(ok) SELECT CASE WHEN ({condition}) THEN 1 ELSE 0 END;'


def _schema_check(name: str, definitions: list[str]) -> str:
    # Admit only the known table layouts. The v1 child PK was nullable;
    # replacement INSERT triggers enforce non-null without rebuilding data.
    normalized = []
    for sql in definitions:
        sql = re.sub(r'\bIF NOT EXISTS\s+', '', sql, flags=re.I)
        normalized.append(_quoted(re.sub(r'\s+', '', sql.rstrip(';')).lower()))
    expr = "lower(replace(replace(replace(replace(sql,' ',''),char(10),''),char(13),''),char(9),''))"
    return _assert(f"EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name={_quoted(name)} AND {expr} IN ({','.join(normalized)}))")


def build_plan() -> dict:
    source = []
    for filename in ['keyless_customer_link_candidate.sql', 'keyless_token_revocation_candidate.sql']:
        source.extend(statements((ROOT / filename).read_text()))
    tables = [s for s in source if s.startswith('CREATE TABLE')]
    indexes = [s for s in source if s.startswith('CREATE INDEX')]
    triggers = [s for s in source if s.startswith('CREATE TRIGGER')]
    if len(tables) != 3 or len(triggers) != 21 or len(indexes) != 1:
        raise ValueError('upgrade_source_inventory_changed_requires_review')
    version_table = f'''CREATE TABLE IF NOT EXISTS {VERSIONS} (
        version INTEGER PRIMARY KEY NOT NULL,
        plan_sha256 TEXT NOT NULL CHECK(length(plan_sha256)=64),
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );'''
    plan = [*tables, version_table,
            f'CREATE TABLE {GUARD}(ok INTEGER NOT NULL CONSTRAINT oauth_identity_upgrade_inconsistent CHECK(ok=1));']
    for table in tables:
        name = re.search(r'CREATE TABLE IF NOT EXISTS (\w+)', table).group(1)
        allowed = [table]
        if name in ('oauth_identity_code_links', 'oauth_identity_token_links'):
            allowed.append(table.replace('PRIMARY KEY NOT NULL REFERENCES', 'PRIMARY KEY REFERENCES'))
        plan.append(_schema_check(name, allowed))
    plan.append(_schema_check(VERSIONS, [version_table]))
    checks = [
        'NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)',
        "NOT EXISTS(SELECT 1 FROM customers WHERE id IS NULL OR id='' OR status IS NULL)",
        "NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id IS NULL OR k.id='' OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=k.customer_id) OR (k.status='active' AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=k.customer_id AND c.status='active')))",
        "NOT EXISTS(SELECT 1 FROM oauth_authorization_codes a WHERE a.code_hash IS NULL OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id))",
        "NOT EXISTS(SELECT 1 FROM oauth_identity_links l WHERE l.issuer='' OR l.tenant_id='' OR l.subject_sha256 GLOB '*[^0-9a-f]*' OR l.witness_sha256 GLOB '*[^0-9a-f]*' OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=l.customer_id))",
    ]
    for table, parent, key, parent_key in [
        ('oauth_identity_code_links', 'oauth_authorization_codes', 'code_hash', 'code_hash'),
        ('oauth_identity_token_links', 'api_keys', 'api_key_id', 'id'),
    ]:
        checks.append(f'''NOT EXISTS(SELECT 1 FROM {table} t WHERE t.{key} IS NULL OR NOT EXISTS(
            SELECT 1 FROM oauth_identity_links l JOIN {parent} p ON p.{parent_key}=t.{key}
            WHERE l.issuer=t.issuer AND l.subject_sha256=t.subject_sha256
            AND l.customer_id=t.customer_id AND l.tenant_id=t.tenant_id AND p.customer_id=t.customer_id))''')
    # History may be revoked/expired; no active credential may survive a revoked
    # identity or disabled customer. Reject; never silently repair live rows.
    checks.append('''NOT EXISTS(SELECT 1 FROM oauth_identity_token_links t
        JOIN oauth_identity_links l ON l.issuer=t.issuer AND l.subject_sha256=t.subject_sha256
        JOIN api_keys k ON k.id=t.api_key_id WHERE l.state='revoked' AND k.status='active')''')
    for table in ['oauth_access_tokens', 'oauth_refresh_tokens']:
        checks.append(f'''NOT EXISTS(SELECT 1 FROM {table} a WHERE
            NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=a.api_key_id AND k.customer_id=a.customer_id)
            OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id)
            OR (a.revoked_at IS NULL AND (
                NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id AND c.status='active')
                OR NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=a.api_key_id AND k.status='active')
                OR EXISTS(SELECT 1 FROM oauth_identity_token_links t JOIN oauth_identity_links l
                    ON l.issuer=t.issuer AND l.subject_sha256=t.subject_sha256
                    WHERE t.api_key_id=a.api_key_id AND l.state='revoked'))))''')
    plan.extend(_assert(check) for check in checks)
    plan.extend(indexes)
    for trigger in triggers:
        name = re.search(r'CREATE TRIGGER IF NOT EXISTS (\w+)', trigger).group(1)
        plan.extend([f'DROP TRIGGER IF EXISTS {name};', trigger.replace('IF NOT EXISTS ', '', 1)])
    # Version is committed only after all validations and replacement DDL.
    digest = hashlib.sha256(json.dumps(plan, separators=(',', ':')).encode()).hexdigest()
    plan.extend([
        _assert(f'NOT EXISTS(SELECT 1 FROM {VERSIONS} WHERE version>{VERSION} OR (version={VERSION} AND plan_sha256!={_quoted(digest)}))'),
        f'INSERT INTO {VERSIONS}(version,plan_sha256) SELECT {VERSION},{_quoted(digest)} WHERE NOT EXISTS(SELECT 1 FROM {VERSIONS} WHERE version={VERSION});',
        f'DROP TABLE {GUARD};',
    ])
    return {'version': VERSION, 'plan_sha256': digest, 'statements': plan,
            'status': 'OFFLINE_CANDIDATE_NOT_HOSTED_QUALIFIED'}


def upgrade(db: sqlite3.Connection) -> dict:
    """Atomic local rehearsal on an explicitly supplied SQLite connection.

    Never commits a caller's transaction. Foreign keys must already be enabled.
    No executescript: Python's legacy executescript commits pending work.
    """
    if db.in_transaction:
        raise ValueError('upgrade_requires_own_transaction')
    if db.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
        raise ValueError('upgrade_requires_foreign_keys')
    plan = build_plan()
    db.execute('BEGIN IMMEDIATE')
    try:
        for sql in plan['statements']:
            db.execute(sql)
        db.execute('COMMIT')
    except BaseException:
        if db.in_transaction:
            db.execute('ROLLBACK')
        raise
    return {k: v for k, v in plan.items() if k != 'statements'}


if __name__ == '__main__':
    # Emits SQL only; there is deliberately no database-apply CLI or network.
    print(json.dumps(build_plan(), indent=2))

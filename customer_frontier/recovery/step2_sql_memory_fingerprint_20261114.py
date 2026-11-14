"""Bounded SQL replay and typed fingerprints. Plaintext exists only in memory."""
import base64
import hashlib
import json
import math
import sqlite3
import sys
import time

MAX_SQL = 8_000_000
CATALOG = "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY type,name"


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def typed(value):
    if value is None:
        return ['null']
    if isinstance(value, bytes):
        return ['blob', base64.b64encode(value).decode('ascii')]
    if isinstance(value, str):
        return ['text', value]
    if isinstance(value, int):
        return ['integer', str(value)]
    if isinstance(value, float) and math.isfinite(value):
        return ['real', value.hex()]
    raise ValueError('UNSUPPORTED_SQL_VALUE')


def fingerprint(sql):
    if not isinstance(sql, bytes) or not 0 < len(sql) <= MAX_SQL:
        raise ValueError('SQL_SIZE_UNQUALIFIED')
    db = sqlite3.connect(':memory:')
    try:
        db.enable_load_extension(False)
        # D1 exports may insert a child before emitting its parent CREATE TABLE.
        # Load into this fresh memory-only database, then enforce and exhaustively
        # validate every FK and parent definition before reporting any success.
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('PRAGMA temp_store=MEMORY')
        db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_SQL)
        db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, MAX_SQL)
        db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 256)
        deadline = time.monotonic() + 12

        def authorize(action, arg1, arg2, *_):
            if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() in ('load_extension', 'readfile', 'writefile'):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_PRAGMA and str(arg1).lower() not in (
                    'foreign_keys', 'defer_foreign_keys', 'integrity_check', 'foreign_key_check', 'foreign_key_list', 'table_info'):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        db.set_authorizer(authorize)
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        db.executescript(sql.decode('utf-8'))
        if db.in_transaction:
            db.commit()
        db.execute('PRAGMA foreign_keys=ON')
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('SQL_INTEGRITY_FAILED')
        objects = db.execute(CATALOG).fetchall()
        if len(objects) > 500:
            raise ValueError('CATALOG_OVER_BUDGET')
        catalog = [[kind, sha(name.encode()), sha(ddl.encode())] for kind, name, ddl in objects]
        tables = []
        total = 0
        names = [name for kind, name, _ in objects if kind == 'table']
        for name in names:
            for fk in db.execute('PRAGMA foreign_key_list("' + name.replace('"', '""') + '")'):
                if fk[2] not in names:
                    raise ValueError('FOREIGN_KEY_PARENT_TABLE_MISSING')
        # Sequence state affects future IDs and must also survive the restore.
        if db.execute("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").fetchone():
            names.append('sqlite_sequence')
        for name in names:
            cursor = db.execute('SELECT * FROM "' + name.replace('"', '""') + '"')
            columns = [item[0] for item in cursor.description]
            rows = []
            for row in cursor:
                total += 1
                if total > 100_000 or time.monotonic() > deadline:
                    raise ValueError('DATA_OVER_BUDGET')
                rows.append(sha(canonical([typed(value) for value in row])))
            # A sorted multiset retains duplicate counts without exposing values.
            tables.append({'table_name_sha256': sha(name.encode()), 'rows': len(rows),
                           'data_sha256': sha(canonical([columns, sorted(rows)]))})
        tables.sort(key=lambda item: item['table_name_sha256'])
        return {'schema': 'musitu.axiom.sql-typed-memory-fingerprint.v1',
                'catalog_sha256': sha(canonical(catalog)), 'user_objects': len(objects),
                'tables': tables, 'total_rows': total, 'user_data_sha256': sha(canonical(tables)),
                'integrity_check': True, 'foreign_key_check': True, 'foreign_key_parent_definitions': True}
    finally:
        db.close()


if __name__ == '__main__':
    try:
        output = fingerprint(sys.stdin.buffer.read(MAX_SQL + 1))
        print(json.dumps(output, separators=(',', ':')))
    except Exception as exc:
        # SQLite exceptions can contain SQL or values. Never propagate them.
        patterns = [('not authorized', 'AUTHORIZER_DENIAL'), ('no such function', 'MISSING_FUNCTION'),
                    ('no such table', 'MISSING_TABLE'), ('foreign key', 'FOREIGN_KEY'),
                    ('syntax error', 'SYNTAX'), ('already exists', 'DUPLICATE_OBJECT'),
                    ('cannot commit', 'TRANSACTION'), ('constraint failed', 'CONSTRAINT'),
                    ('SQL_INTEGRITY_FAILED', 'INTEGRITY'), ('interrupted', 'DEADLINE')]
        reason = next((code for pattern, code in patterns if pattern.lower() in str(exc).lower()), 'OTHER')
        print(json.dumps({'error': 'SQL_MEMORY_REPLAY_FAILED_' + reason}))
        raise SystemExit(2)

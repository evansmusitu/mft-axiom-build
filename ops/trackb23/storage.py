"""Credentialless read-only extraction of *actual persisted* local Workerd SQLite tables.

Refuses to certify B22 state if runtime storage cannot be located exactly,
if more than one matching table is found or if state is incomplete. This is
only an S0 local runtime snapshot, not independent/cloud authenticated evidence.
"""
import os
from pathlib import Path
import sqlite3
from evidence import JoinDenied,require,EXPECTED,JOURNAL_FIELDS,QUOTA_FIELDS

MAX_FILES=1000
MAX_SIZE=50*1024*1024

def _rows(db,table,fields):
    query='SELECT '+','.join(fields)+' FROM '+table
    cursor=db.execute(query)
    return [dict(zip(fields,row)) for row in cursor.fetchall()]

def capture(directory):
    root=Path(directory).resolve()
    require(root.is_dir(),'WORKERD_STATE_DIRECTORY_ABSENT')
    journal=[];quota=[];found=[]
    count=0
    for p in root.rglob('*'):
        if not p.is_file() or p.is_symlink():continue
        count+=1
        require(count<=MAX_FILES,'WORKERD_STATE_FILE_QUOTA')
        if p.stat().st_size>MAX_SIZE:continue
        with p.open('rb') as f:
            if f.read(16)!=b'SQLite format 3\0':continue
        # Read-only SQL connection; no mutation of evidence during extraction.
        try:
            uri=f'file:{p}?mode=ro'
            with sqlite3.connect(uri,uri=True,timeout=2) as db:
                tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if 'b22_dispatch' in tables:
                    journal.append(_rows(db,'b22_dispatch',sorted(JOURNAL_FIELDS)))
                    found.append(str(p.relative_to(root)))
                if 'reservations' in tables:
                    quota.append(_rows(db,'reservations',sorted(QUOTA_FIELDS)))
                    found.append(str(p.relative_to(root)))
        except sqlite3.Error as e:
            raise JoinDenied('WORKERD_SQLITE_READ_FAILED') from e
    require(len(journal)==1 and len(quota)==1,'WORKERD_JOURNAL_OR_QUOTA_NOT_UNIQUE')
    require(len(journal[0])==len(quota[0])==6,'WORKERD_DURABLE_ROWS_INCOMPLETE')
    require({r['request_id'] for r in journal[0]}=={r['request_id'] for r in quota[0]}==EXPECTED,'WORKERD_CROSS_STORE_OPERATION_SET_MISMATCH')
    return sorted(journal[0],key=lambda r:r['request_id']),sorted(quota[0],key=lambda r:r['request_id']),found

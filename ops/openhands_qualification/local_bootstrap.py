"""Explicit operator-invoked LOCAL S0 provisioning. Never expose as agent tool.

This is not an independent recovery witness or production admission control.
"""
import os
from pathlib import Path
import secrets
import sqlite3
import stat
from .mission_ledger import LedgerDenied, MissionLedger, RecoveryHold


def bootstrap_local_s0(path: str, *, acknowledged_local_only: bool) -> dict:
    if acknowledged_local_only is not True:
        raise LedgerDenied('explicit local-only acknowledgement required')
    ledger=MissionLedger(path)
    parent=ledger.path.parent
    st=parent.stat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:
        raise LedgerDenied('bootstrap parent must be owned and private')
    if list(parent.iterdir()):
        raise LedgerDenied('bootstrap requires a new, empty, owner-private directory')
    # An incomplete attempt is intentionally left as a recovery hold.
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
    fd=os.open(ledger.lock,flags,0o600)
    os.fsync(fd);os.close(fd)
    generation=secrets.token_hex(16)
    con=sqlite3.connect(ledger.path,isolation_level=None,timeout=15)
    os.chmod(ledger.path,0o600)
    try:
        con.execute('PRAGMA journal_mode=DELETE')
        con.execute('PRAGMA synchronous=FULL')
        con.execute('BEGIN IMMEDIATE')
        con.execute('CREATE TABLE missions (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, work TEXT NOT NULL, workload TEXT NOT NULL, request_sha TEXT UNIQUE NOT NULL, binding_sha TEXT NOT NULL, state TEXT NOT NULL, expires REAL NOT NULL, output_sha TEXT)')
        con.execute('CREATE UNIQUE INDEX unique_work ON missions(tenant,work)')
        con.execute('CREATE TABLE ledger_meta (id INTEGER PRIMARY KEY CHECK(id=1),generation_id TEXT NOT NULL,sequence INTEGER NOT NULL)')
        con.execute('INSERT INTO ledger_meta VALUES(1,?,0)',(generation,))
        anchor_bytes=ledger._anchor_bytes(generation,0,ledger._state_hash(con))
        con.commit()
    finally:
        con.close()
    fd=os.open(ledger.anchor,flags,0o600)
    try:
        os.write(fd,anchor_bytes)
        os.fsync(fd)
    finally:os.close(fd)
    parent_fd=os.open(parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
    try:os.fsync(parent_fd)
    finally:os.close(parent_fd)
    return {'schema':'musitu.axiom.ecc.local-bootstrap.s0.v1',
            'local_only':True,'generation_id':generation,
            'production_authority':False,'provider_dispatch_allowed':False}

"""Local durable model-call reservations; no auth grant and no provider access.

Only approved for one-node isolated qualification. A multi-host public broker
needs a transactional distributed ledger with independent audit and recovery.
"""
import os
from pathlib import Path
import re
import sqlite3
import stat


class BudgetExhausted(ValueError):
    pass


class BudgetLedgerUnavailable(RuntimeError):
    pass


_NONCE=re.compile(r'^[0-9a-f]{32,64}$')
_DIGEST=re.compile(r'^[0-9a-f]{64}$')


class SqliteBudgetLedger:
    def __init__(self, path):
        self._path=Path(path)
        if not self._path.is_absolute():
            raise ValueError('model budget ledger requires an absolute path')

    def _ensure_private_file(self):
        path=self._path
        try:
            if path.is_symlink():
                raise BudgetLedgerUnavailable('budget ledger path must not be a symlink')
            parent=path.parent
            st=parent.stat()
            if not stat.S_ISDIR(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode & 0o022:
                raise BudgetLedgerUnavailable('budget ledger parent directory is not trusted')
            if not path.exists():
                try:
                    fd=os.open(str(path),
                               os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os,'O_NOFOLLOW',0),
                               0o600)
                    os.close(fd)
                except FileExistsError:
                    pass
            if path.is_symlink():
                raise BudgetLedgerUnavailable('budget ledger path was replaced')
            st=path.stat()
            if (not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or
                    stat.S_IMODE(st.st_mode)!=0o600):
                raise BudgetLedgerUnavailable('budget ledger file permissions invalid')
        except BudgetLedgerUnavailable:
            raise
        except (OSError, ValueError):
            raise BudgetLedgerUnavailable('budget ledger file inaccessible') from None

    def reserve(self, *, nonce, binding, max_calls):
        # Reject untrusted inputs before any filesystem effects.
        if (type(nonce) is not str or not _NONCE.fullmatch(nonce) or
                type(binding) is not str or not _DIGEST.fullmatch(binding) or
                type(max_calls) is not int or not 1<=max_calls<=10):
            raise BudgetExhausted('model budget reservation inputs invalid')
        self._ensure_private_file()
        con=None
        try:
            con=sqlite3.connect(self._path, timeout=15, isolation_level=None)
            con.execute('PRAGMA busy_timeout=15000')
            con.execute('PRAGMA synchronous=FULL')
            con.execute('BEGIN IMMEDIATE')
            con.execute('CREATE TABLE IF NOT EXISTS reservations ('
                        'nonce TEXT PRIMARY KEY NOT NULL,'
                        'binding TEXT NOT NULL,'
                        'max_calls INTEGER NOT NULL,'
                        'used INTEGER NOT NULL)')
            row=con.execute('SELECT binding,max_calls,used FROM reservations WHERE nonce=?',(nonce,)).fetchone()
            if row is None:
                current=1
                con.execute('INSERT INTO reservations(nonce,binding,max_calls,used) VALUES (?,?,?,?)',
                            (nonce,binding,max_calls,current))
            else:
                registered_binding,registered_max,used=row
                if registered_binding!=binding or registered_max!=max_calls or used>=max_calls:
                    raise BudgetExhausted('model budget exhausted or conflicting grant')
                current=used+1
                con.execute('UPDATE reservations SET used=? WHERE nonce=?',(current,nonce))
            con.commit()
            return current
        except BudgetExhausted:
            if con is not None: con.rollback()
            raise
        except (sqlite3.Error, OSError, ValueError):
            if con is not None:
                try: con.rollback()
                except Exception: pass
            raise BudgetLedgerUnavailable('durable model-call reservation failed closed') from None
        finally:
            if con is not None:
                try: con.close()
                except Exception: pass

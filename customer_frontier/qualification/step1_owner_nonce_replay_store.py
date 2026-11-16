#!/usr/bin/env python3
"""Offline nonce ledger for a *verified proposal only*, never D1 authority.

Must be called exclusively after the Node Ed25519 owner-proposal verifier.
The ledger itself deliberately cannot authenticate the signer. No Cloudflare,
SQL export/import, customer data, grants, MFA, or provider calls are possible.
An unanchored local database is rollbackable; hosted replay safety stays OPEN.
"""
from __future__ import annotations
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import stat
import sys
from datetime import datetime, timezone

DB_NAME = 'AXIOM_STEP1_LOCAL_OWNER_PROPOSAL_NONCES_NOT_AUTHORITY.sqlite3'
SCHEMA = 'musitu.axiom.step1.verified-proposal-replay-attempt.v1'
RECEIPT_SCHEMA = 'musitu.axiom.step1.local-nonce-consumption-receipt.v1'
PIN = re.compile(r'^[0-9a-f]{64}$')
NONCE = re.compile(r'^[0-9a-f]{32}$')
SOURCE_ACCOUNT = '93f395f5121954671f92fffa453d6b61'
SOURCE_D1 = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
AMENDMENT_SHA = 'cb7f43e1e6b3c28afb88de5a08696dc7b650565a78394eda98e2498c099fb9d5'
EXPECTED_FIELDS = {'schema','source_account','source_database','governance_amendment_sha256',
                   'plan_sha256','signer_spki_sha256','nonce','issued_at','expires_at',
                   'signature_verification_status','step1_closed','release_status'}
TABLE_SQL = '''CREATE TABLE IF NOT EXISTS consumed_owner_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_account TEXT NOT NULL,
  source_database TEXT NOT NULL,
  signer_pin TEXT NOT NULL,
  proposal_nonce TEXT NOT NULL,
  exact_plan_sha256 TEXT NOT NULL UNIQUE,
  observed_at TEXT NOT NULL,
  UNIQUE (source_account, source_database, signer_pin, proposal_nonce)
)'''

class NoGo(Exception):
    pass

def check(test: bool, reason: str) -> None:
    if not test:
        raise NoGo(reason)

def canonical_time(x: str) -> datetime:
    check(isinstance(x,str) and x.endswith('Z'), 'INVALID_TIME')
    try:
        result = datetime.fromisoformat(x.replace('Z','+00:00'))
        check(result.tzinfo is not None and result.utcoffset().total_seconds()==0,'INVALID_TIME')
        check(result.isoformat(timespec='milliseconds').replace('+00:00','Z')==x,'NONCANONICAL_TIME')
        return result
    except (ValueError, TypeError, OverflowError):
        raise NoGo('INVALID_TIME') from None

def validate_attempt(data: dict) -> None:
    check(isinstance(data,dict) and set(data)==EXPECTED_FIELDS,'UNREVIEWED_ATTEMPT_FIELDS')
    check(data['schema']==SCHEMA and data['source_account']==SOURCE_ACCOUNT and
          data['source_database']==SOURCE_D1 and data['governance_amendment_sha256']==AMENDMENT_SHA,
          'UNEXPECTED_SOURCE_OR_POLICY')
    check(all(isinstance(data[k],str) and PIN.fullmatch(data[k]) for k in
          ('plan_sha256','signer_spki_sha256')) and isinstance(data['nonce'],str) and
          bool(NONCE.fullmatch(data['nonce'])),'INVALID_NONCE_OR_HASH')
    check(data['signature_verification_status']=='PINNED_OWNER_SIGNATURE_VALID_POLICY_PROPOSAL_ONLY_NO_GO' and
          data['step1_closed'] is False and data['release_status']=='NOT_RELEASE',
          'UNVERIFIED_SIGNATURE_OR_RELEASE_DRIFT')
    issued=canonical_time(data['issued_at'])
    expires=canonical_time(data['expires_at'])
    check(issued<expires and (expires-issued).total_seconds()<=86400,'INVALID_PROPOSAL_WINDOW')

def validate_directory(path: pathlib.Path) -> pathlib.Path:
    check(path.is_absolute() and '..' not in path.parts, 'ABSOLUTE_OWNER_PRIVATE_DIR_REQUIRED')
    try:
        st=path.lstat()
        check(stat.S_ISDIR(st.st_mode) and not path.is_symlink(), 'OWNER_NONCE_DIR_INVALID')
        check(st.st_mode & 0o077 == 0 and st.st_uid==os.getuid(), 'OWNER_NONCE_DIR_UNSAFE')
        check(path.resolve(strict=True)==path, 'NONCANONICAL_NONCE_DIR')
    except OSError:
        raise NoGo('OWNER_NONCE_DIR_INVALID') from None
    return path

def validate_db_file(path: pathlib.Path) -> None:
    try:
        st=path.lstat()
        check(stat.S_ISREG(st.st_mode) and st.st_nlink==1,'UNSAFE_OR_LINKED_NONCE_DB')
        check(st.st_uid==os.getuid() and (st.st_mode & 0o077)==0,'NONCE_DB_PERMISSIONS_UNSAFE')
    except FileNotFoundError:
        return
    except OSError:
        raise NoGo('UNSAFE_NONCE_DB') from None

def reserve(ledger_dir: pathlib.Path, data: dict) -> dict:
    validate_attempt(data)
    directory=validate_directory(ledger_dir)
    db_path=directory/DB_NAME
    validate_db_file(db_path)
    # sqlite file is non-secret, but permission never permits cross-user reads.
    original_umask=os.umask(0o077)
    try:
        con=sqlite3.connect(str(db_path),isolation_level=None,timeout=5)
    except (sqlite3.Error, OSError):
        raise NoGo('LOCAL_LEDGER_UNAVAILABLE') from None
    finally:
        os.umask(original_umask)
    try:
        validate_db_file(db_path)
        check(con.execute('PRAGMA journal_mode=DELETE').fetchone()[0].lower()=='delete','UNSAFE_JOURNAL')
        con.execute('PRAGMA synchronous=FULL')
        con.execute('PRAGMA secure_delete=ON')
        con.execute('PRAGMA trusted_schema=OFF')
        check(con.execute('PRAGMA quick_check').fetchone()[0]=='ok','LEDGER_INTEGRITY_INVALID')
        con.execute('BEGIN IMMEDIATE')
        try:
            user_version=con.execute('PRAGMA user_version').fetchone()[0]
            check(user_version in (0,1),'LEDGER_VERSION_UNRECOGNIZED')
            con.execute(TABLE_SQL)
            cols=con.execute('PRAGMA table_info(consumed_owner_proposals)').fetchall()
            check([x[1] for x in cols]==['id','source_account','source_database','signer_pin',
                  'proposal_nonce','exact_plan_sha256','observed_at'],'LEDGER_SCHEMA_DRIFT')
            stored_ddl=con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='consumed_owner_proposals'").fetchone()
            check(stored_ddl is not None and stored_ddl[0]==TABLE_SQL.replace('CREATE TABLE IF NOT EXISTS','CREATE TABLE'),
                  'LEDGER_EXACT_SCHEMA_OR_UNIQUENESS_UNQUALIFIED')
            unique_indexes=[x for x in con.execute('PRAGMA index_list(consumed_owner_proposals)') if x[2]==1]
            unique_columns={tuple(y[2] for y in con.execute('PRAGMA index_info(\"'+idx[1]+'\")')) for idx in unique_indexes}
            check(('exact_plan_sha256',) in unique_columns and
                  ('source_account','source_database','signer_pin','proposal_nonce') in unique_columns,
                  'LEDGER_UNIQUENESS_UNQUALIFIED')
            con.execute('PRAGMA user_version=1')
            # Existing-schema safety: duplicate hashes/nonce are DENIAL, not idempotent success.
            try:
                con.execute('INSERT INTO consumed_owner_proposals (source_account,source_database,signer_pin,proposal_nonce,exact_plan_sha256,observed_at) VALUES (?,?,?,?,?,?)',
                            (SOURCE_ACCOUNT,SOURCE_D1,data['signer_spki_sha256'],
                             data['nonce'],data['plan_sha256'],
                             datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')))
            except sqlite3.IntegrityError:
                raise NoGo('NONCE_OR_EXACT_PROPOSAL_ALREADY_CONSUMED_NO_GO') from None
            count=con.execute('SELECT COUNT(1) FROM consumed_owner_proposals').fetchone()[0]
            check(0<count<10000000,'LEDGER_ROWCOUNT_UNEXPECTED')
            con.execute('COMMIT')
        except Exception:
            con.execute('ROLLBACK')
            raise
    except NoGo:
        raise
    except sqlite3.Error:
        raise NoGo('LEDGER_SQLITE_ERROR') from None
    finally:
        con.close()
    # No local success can be elevated to provider authorization.
    return {
        'schema':RECEIPT_SCHEMA,
        'status':'LOCAL_OWNER_SIGNED_PROPOSAL_REPLAY_CONSUMED_ONLY_NO_GO',
        'exact_plan_sha256':data['plan_sha256'],
        'owner_signing_spki_sha256':data['signer_spki_sha256'],
        'local_ledger_nonce_count':count,
        'ed25519_verified_by_separate_owner_policy_module_reported_only':True,
        'local_durable_nonce_commit_observed':True,
        'hosted_nonce_consistency_qualified':False,
        'global_anti_rollback_qualified':False,
        'owner_identity_mfa_verified':False,
        'current_encrypted_customer_backup_qualified':False,
        'provider_zero_additional_spend_qualified':False,
        'disposable_d1_creation_authorized':False,
        'step1_closed':False,
        'step2_authorized':False,
        'release_authorized':False,
        'release_status':'NOT_RELEASE',
    }

def main() -> int:
    try:
        check(len(sys.argv)==2,'ONE_LEDGER_DIRECTORY_REQUIRED')
        payload=sys.stdin.buffer.read(4097)
        check(len(payload)<=4096,'INPUT_TOO_LARGE')
        data=json.loads(payload)
        receipt=reserve(pathlib.Path(sys.argv[1]),data)
        print(json.dumps(receipt,sort_keys=True,separators=(',',':')))
        return 0
    except (NoGo,ValueError,TypeError):
        code=sys.exc_info()[1]
        code=code.args[0] if isinstance(code,NoGo) else 'INVALID_INPUT'
        print('AXIOM_OWNER_LOCAL_NONCE_NO_GO:'+code,file=sys.stderr)
        return 2
    except Exception:
        print('AXIOM_OWNER_LOCAL_NONCE_NO_GO:LOCAL_LEDGER_UNEXPECTED_ERROR',file=sys.stderr)
        return 2
if __name__=='__main__':
    sys.exit(main())

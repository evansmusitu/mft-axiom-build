"""Synthetic S0 local SQLite witness LAB; NOT independent operator authority.

Builder-controlled signer and all local files are rollbackable together.
The historical B27 majority+witness destructive rollback failure remains FAILED.
No network listener, provider, issuer, production grant or automatic recovery.
"""
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat

class WitnessHold(ValueError):pass

SCHEMA='musitu.axiom.iso.s0.reservation-request.v1'
ANCHOR='musitu.axiom.iso.s0.local-witness-anchor.v1'
FIELDS={'schema','receipt_sha256','operation_id','request_sha256','nonce','receipt_sequence'}
ID=re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')
HEX64=re.compile(r'[a-f0-9]{64}\Z')
NONCE=re.compile(r'[a-f0-9]{32,64}\Z')

def fail(why):
    raise WitnessHold('LOCAL_S0_WITNESS_HOLD:'+why)

def canonical(value):
    try:
        return json.dumps(value,sort_keys=True,separators=(',',':'),
                          ensure_ascii=True,allow_nan=False).encode()
    except (TypeError,ValueError,OverflowError):
        fail('NONCANONICAL_VALUE')

def pubhash(key):
    if not isinstance(key,Ed25519PrivateKey):fail('LAB_ED25519_KEY_REQUIRED')
    return hashlib.sha256(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).hexdigest()

def private_parent(path):
    if not path.is_absolute() or path.is_symlink():fail('ABSOLUTE_REAL_PATH_REQUIRED')
    try:mode=path.parent.stat()
    except OSError:fail('PRIVATE_PARENT_MISSING')
    if not stat.S_ISDIR(mode.st_mode) or mode.st_uid!=os.getuid() or stat.S_IMODE(mode.st_mode)!=0o700:
        fail('OWNER_PRIVATE_0700_DIRECTORY_REQUIRED')
    return path.parent

def private_file(path):
    if path.is_symlink():fail('SYMLINK_DENIED')
    try:s=path.stat()
    except OSError:fail('STATE_MISSING')
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o600:
        fail('OWNER_PRIVATE_0600_FILE_REQUIRED')

def syncdir(parent):
    fd=os.open(parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
    try:os.fsync(fd)
    finally:os.close(fd)

def dbhash(con):
    records=con.execute('SELECT receipt_sha,operation_id,request_sha,nonce,receipt_sequence,consumed_index FROM consumed ORDER BY consumed_index').fetchall()
    schema=con.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name,tbl_name').fetchall()
    return hashlib.sha256(canonical({'rows':records,'schema':schema})).hexdigest()

def anchor_bytes(gen,key_sha,epoch,sequence,digest):
    return canonical({'schema':ANCHOR,'generation_id':gen,'public_key_sha256':key_sha,
                      'witness_epoch':epoch,'sequence':sequence,'state_sha256':digest})+b'\n'

def bootstrap_local_witness(db_path,*,witness_id,epoch,signing_key,acknowledged_lab_only):
    if acknowledged_lab_only is not True:fail('EXPLICIT_LAB_ACK_REQUIRED')
    path=Path(db_path);parent=private_parent(path)
    if type(witness_id) is not str or not ID.fullmatch(witness_id) or type(epoch) is not int or epoch<1:
        fail('LAB_WITNESS_CONFIG')
    if list(parent.iterdir()):fail('BOOTSTRAP_PARENT_NOT_EMPTY')
    key_sha=pubhash(signing_key)
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
    lock=Path(str(path)+'.lock');anchor=Path(str(path)+'.anchor')
    fd=os.open(lock,flags,0o600)
    try:os.fsync(fd)
    finally:os.close(fd)
    generation=secrets.token_hex(16)
    try:
        # Do not create a momentarily world-readable SQLite file.
        fd=os.open(path,flags,0o600)
        try:os.fsync(fd)
        finally:os.close(fd)
        con=sqlite3.connect(path,isolation_level=None,timeout=15)
        try:
            con.execute('PRAGMA journal_mode=DELETE')
            con.execute('PRAGMA synchronous=FULL')
            con.execute('BEGIN IMMEDIATE')
            con.execute('CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), generation_id TEXT NOT NULL, witness_id TEXT NOT NULL, witness_epoch INTEGER NOT NULL, pubhash TEXT NOT NULL)')
            con.execute('CREATE TABLE consumed (receipt_sha TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE, request_sha TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, receipt_sequence INTEGER NOT NULL, consumed_index INTEGER PRIMARY KEY CHECK(consumed_index>0))')
            con.execute('INSERT INTO metadata VALUES(1,?,?,?,?)',(generation,witness_id,epoch,key_sha))
            digest=dbhash(con)
            con.commit()
        finally:con.close()
        fd=os.open(anchor,flags,0o600)
        try:os.write(fd,anchor_bytes(generation,key_sha,epoch,0,digest));os.fsync(fd)
        finally:os.close(fd)
        syncdir(parent)
    except Exception:
        # Keep any partial state for manual investigation; never reset in place.
        fail('AMBIGUOUS_INITIALIZATION_HOLD')
    return {'schema':'musitu.axiom.iso.s0.lab-bootstrap.v1','lab_only':True,
            'generation_id':generation,'production_authority':False,'execution_allowed':False}

class LocalWitnessLab:
    def __init__(self,db_path,*,witness_id,epoch,signing_key,clock):
        self.path=Path(db_path);self.lock=Path(str(self.path)+'.lock')
        self.anchor=Path(str(self.path)+'.anchor')
        self.transition=Path(str(self.path)+'.transition')
        self.pubhash=pubhash(signing_key)
        if type(witness_id) is not str or not ID.fullmatch(witness_id) or type(epoch) is not int or epoch<1 or not callable(clock):
            fail('LAB_WITNESS_CONFIG_INVALID')
        self.witness_id=witness_id;self.epoch=epoch;self.signing_key=signing_key;self.clock=clock

    @staticmethod
    def validate(req):
        if type(req) is not dict or set(req)!=FIELDS or req['schema']!=SCHEMA:fail('EXACT_REQUEST_REQUIRED')
        if type(req['operation_id']) is not str or not ID.fullmatch(req['operation_id']):fail('INVALID_OPERATION')
        for field in ('receipt_sha256','request_sha256'):
            if type(req[field]) is not str or not HEX64.fullmatch(req[field]):fail('INVALID_DIGEST')
        if type(req['nonce']) is not str or not NONCE.fullmatch(req['nonce']):fail('INVALID_NONCE')
        if type(req['receipt_sequence']) is not int or req['receipt_sequence']<1:fail('INVALID_SEQUENCE')

    def reserve_once(self,req):
        self.validate(req);parent=private_parent(self.path)
        for p in (self.path,self.lock,self.anchor):private_file(p)
        try:
            fd=os.open(self.lock,os.O_RDWR|getattr(os,'O_NOFOLLOW',0))
            try:
                fcntl.flock(fd,fcntl.LOCK_EX)
                for p in (self.path,self.lock,self.anchor):private_file(p)
                if self.transition.exists() or self.transition.is_symlink():fail('INCOMPLETE_RESERVATION_HOLD')
                # mode=rw refuses silent re-creation of the journal after deletion.
                con=sqlite3.connect(self.path.as_uri()+'?mode=rw',uri=True,isolation_level=None,timeout=15)
                try:
                    con.execute('PRAGMA synchronous=FULL')
                    con.execute('BEGIN IMMEDIATE')
                    metadata=con.execute('SELECT generation_id,witness_id,witness_epoch,pubhash FROM metadata WHERE id=1').fetchone()
                    if metadata is None or metadata[1:]!=(self.witness_id,self.epoch,self.pubhash):fail('TRUST_ROOT_MISMATCH')
                    seq=con.execute('SELECT COUNT(*) FROM consumed').fetchone()[0]
                    if seq!=con.execute('SELECT COALESCE(MAX(consumed_index),0) FROM consumed').fetchone()[0]:
                        fail('SEQUENCE_GAP')
                    anchored=anchor_bytes(metadata[0],self.pubhash,self.epoch,seq,dbhash(con))
                    if self.anchor.read_bytes()!=anchored:fail('UNILATERAL_ROLLBACK_OR_TAMPER')
                    try:now=self.clock()
                    except Exception:fail('LAB_CLOCK_UNAVAILABLE')
                    if type(now) not in (int,float) or not math.isfinite(now) or not 0<=now<2**31:
                        fail('LAB_CLOCK_INVALID')
                    moment=int(now)
                    marker=os.open(self.transition,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
                    try:os.write(marker,b'S0_LAB_PENDING_NO_RELEASE\n');os.fsync(marker)
                    finally:os.close(marker)
                    syncdir(parent)
                    try:
                        con.execute('INSERT INTO consumed VALUES(?,?,?,?,?,?)',
                            (req['receipt_sha256'],req['operation_id'],req['request_sha256'],
                             req['nonce'],req['receipt_sequence'],seq+1))
                    except sqlite3.IntegrityError:
                        con.rollback();os.unlink(self.transition);syncdir(parent)
                        fail('ALREADY_CONSUMED')
                    next_anchor=anchor_bytes(metadata[0],self.pubhash,self.epoch,seq+1,dbhash(con))
                    con.commit()
                    tmp=Path(str(self.anchor)+'.pending-'+secrets.token_hex(8))
                    temp_fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
                    try:os.write(temp_fd,next_anchor);os.fsync(temp_fd)
                    finally:os.close(temp_fd)
                    os.replace(tmp,self.anchor);syncdir(parent)
                    os.unlink(self.transition);syncdir(parent)
                    record={'schema':'musitu.axiom.iso.s0.consumption-witness.v1',
                        'witness_id':self.witness_id,'witness_epoch':self.epoch,
                        'receipt_sha256':req['receipt_sha256'],'operation_id':req['operation_id'],
                        'request_sha256':req['request_sha256'],'nonce':req['nonce'],
                        'receipt_sequence':req['receipt_sequence'],'consumed_index':seq+1,
                        'status':'CONSUMED','issued_at_unix':moment,'expires_at_unix':moment+12}
                    return {'record':record,'signature_b64':base64.b64encode(self.signing_key.sign(canonical(record))).decode()}
                finally:con.close()
            finally:fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
        except WitnessHold:raise
        except (sqlite3.Error,OSError,ValueError) as exc:
            raise WitnessHold('LOCAL_S0_WITNESS_HOLD:AMBIGUOUS_STATE') from exc

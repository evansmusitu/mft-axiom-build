"""B25 S0 local 2-of-3 Ed25519 checkpoint audit voting.

Not real independent regions. No network/provider dispatch, external key ownership,
production promotion, quorum-consensus durability or spend authority.
"""
import base64
import binascii
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

class QuorumDenied(Exception):pass

def deny(code):raise QuorumDenied(code)
def canonical(d):return json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')
ID=re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$')
SHA=re.compile(r'^[a-f0-9]{64}$')
FIELDS={'schema','work_id','sequence','digest_sha256','nonce','utc_day','scope','provider_dispatch_allowed','production_authority'}
RECEIPT_FIELDS={'schema','voter_id','work_id','sequence','digest_sha256','nonce','utc_day','scope','production_authority'}
WRAP={'voter_id','payload_b64','signature_b64'}

def validate(proposal,now):
    if type(now) is not int or not 0<=now<8640000000000:deny('CLOCK_INVALID')
    if type(proposal) is not dict or set(proposal)!=FIELDS:deny('PROPOSAL_SCHEMA_DENIED')
    if proposal['schema']!='axiom.trackb25.s0.checkpoint-proposal.v1' or proposal['scope']!='S0_LOCAL_AUDIT_ONLY' or proposal['production_authority'] is not False or proposal['provider_dispatch_allowed'] is not False:
        deny('SCOPE_NOT_AUTHORIZED')
    if type(proposal['digest_sha256']) is not str or not SHA.fullmatch(proposal['digest_sha256']):deny('CHECKPOINT_DIGEST_INVALID')
    if type(proposal['sequence']) is not int or proposal['sequence']<1:deny('SEQUENCE_INVALID')
    if any(type(proposal[k]) is not str or not ID.fullmatch(proposal[k]) for k in ('work_id','nonce')):
        deny('IDENTITY_INVALID')
    if proposal['utc_day']!=datetime.fromtimestamp(now,timezone.utc).date().isoformat():deny('UTC_DAY_MISMATCH')

def strictb64(data,limit):
    if type(data) is not str or len(data)>limit or not data:deny('BAD_BASE64')
    try:
        raw=base64.b64decode(data,validate=True)
        if base64.b64encode(raw).decode()!=data:deny('NONCANONICAL_BASE64')
        return raw
    except (binascii.Error,ValueError):deny('BAD_BASE64')

def cast_vote(db_path,voter_id,private_key,proposal,*,trusted_now):
    """Synthetic voter service; the producer MUST NOT possess voter private key."""
    validate(proposal,trusted_now)
    if type(voter_id) is not str or not ID.fullmatch(voter_id) or not hasattr(private_key,'sign'):
        deny('VOTER_IDENTITY_OR_SIGNER_DENIED')
    p=Path(db_path)
    if p.is_symlink() or not p.parent.is_dir():deny('VOTER_JOURNAL_PATH_DENIED')
    try:
        with sqlite3.connect(str(p),isolation_level=None,timeout=10) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS signed_votes (work_id TEXT NOT NULL, sequence INTEGER NOT NULL, nonce TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, PRIMARY KEY(work_id,sequence))')
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT MAX(sequence) FROM signed_votes WHERE work_id=?',(proposal['work_id'],)).fetchone()[0]
            if prior is not None and proposal['sequence']<=prior:
                db.execute('ROLLBACK');deny('VOTER_MONOTONIC_REPLAY_DENIED')
            if db.execute('SELECT 1 FROM signed_votes WHERE nonce=?',(proposal['nonce'],)).fetchone():
                db.execute('ROLLBACK');deny('VOTER_NONCE_REPLAY_DENIED')
            db.execute('INSERT INTO signed_votes VALUES (?,?,?,?)',
                       (proposal['work_id'],proposal['sequence'],proposal['nonce'],proposal['digest_sha256']))
            db.execute('COMMIT')
    except sqlite3.IntegrityError:deny('VOTE_DB_CONFLICT')
    except sqlite3.OperationalError:deny('VOTE_DB_UNAVAILABLE')
    statement={'schema':'axiom.trackb25.s0.vote.v1','voter_id':voter_id,'work_id':proposal['work_id'],
      'sequence':proposal['sequence'],'nonce':proposal['nonce'],'digest_sha256':proposal['digest_sha256'],
      'utc_day':proposal['utc_day'],'scope':'S0_LOCAL_AUDIT_ONLY','production_authority':False}
    body=canonical(statement)
    signature=private_key.sign(body)
    return {'voter_id':voter_id,'payload_b64':base64.b64encode(body).decode(),
            'signature_b64':base64.b64encode(signature).decode()}

def verify_quorum(receipts,proposal,*,pinned_voters,trusted_now):
    validate(proposal,trusted_now)
    if type(pinned_voters) is not dict or set(pinned_voters)!=set(('voter-a','voter-b','voter-c')) or any(type(v) is not bytes or len(v)!=32 for v in pinned_voters.values()) or len(set(pinned_voters.values()))!=3:
        deny('INDEPENDENT_VOTER_PIN_SET_REQUIRED')
    if type(receipts) is not list or not 2<=len(receipts)<=3:deny('AUDIT_QUORUM_NOT_MET')
    seen=set()
    for receipt in receipts:
        if type(receipt) is not dict or set(receipt)!=WRAP:deny('VOTE_ENVELOPE_INVALID')
        who=receipt['voter_id']
        if type(who) is not str or who not in pinned_voters or who in seen:deny('VOTER_NOT_UNIQUE_OR_UNKNOWN')
        seen.add(who)
        raw=strictb64(receipt['payload_b64'],4096)
        signature=strictb64(receipt['signature_b64'],100)
        if len(signature)!=64:deny('VOTE_SIGNATURE_FORMAT_INVALID')
        try:Ed25519PublicKey.from_public_bytes(pinned_voters[who]).verify(signature,raw)
        except (InvalidSignature,ValueError,TypeError):deny('VOTE_SIGNATURE_WRONG_PIN')
        try:
            record=json.loads(raw)
            if canonical(record)!=raw:deny('VOTE_NOT_CANONICAL')
        except (TypeError,ValueError,UnicodeError):deny('VOTE_JSON_INVALID')
        if type(record) is not dict or set(record)!=RECEIPT_FIELDS:
            deny('VOTE_SCHEMA_INVALID')
        expected={'schema':'axiom.trackb25.s0.vote.v1','voter_id':who,'work_id':proposal['work_id'],
                  'sequence':proposal['sequence'],'digest_sha256':proposal['digest_sha256'],
                  'nonce':proposal['nonce'],'utc_day':proposal['utc_day'],
                  'scope':'S0_LOCAL_AUDIT_ONLY','production_authority':False}
        if record!=expected:deny('VOTE_CHECKPOINT_BINDING_MISMATCH')
    return {'status':'B25_S0_LOCAL_QUORUM_AUDIT_NOT_DISPATCH','verified_votes':len(seen),
            'production_authority':False,'provider_dispatch_allowed':False,
            'digest_sha256':proposal['digest_sha256']}

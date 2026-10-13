"""B24 S0: fail-closed synthetic evidence authority and region-consistency audit.

The pinned Ed25519 verification key is supplied out-of-band by the verifier;
never taken from the signed envelope or attacker-controlled evidence. Real
issuer onboarding, identity, revocation ledger, attestation source authenticity,
production promotion and provider quota remain UNQUALIFIED.
"""
import base64
import binascii
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

class AuthorityDenied(Exception):pass

HEX40 = re.compile(r'^[a-f0-9]{40}$')
HEX64 = re.compile(r'^[a-f0-9]{64}$')
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
BODY = {'schema','audience','source_commit','work_id','package_sha256','issued_at',
        'expires_at','sequence','nonce','execution_scope','provider_dispatch_authorized',
        'production_authority','max_cost_usd'}
PROTOCOL='axiom.trackb24.s0.signed-checkpoint.v1'
ENVELOPE={'payload_b64','signature_b64'}
ORIGIN={'schema','Project','Work','Agents','Artifacts','Evidence','package_sha256'}
REGION={'region','account_id','utc_day','tenant_id','workload_id',
        'request_id','body_sha256','grant_id','state','result_sha256'}

def deny(reason):raise AuthorityDenied(reason)
def canonical(obj):return json.dumps(obj,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')

def strict_base64(s,limit):
    if type(s) is not str or not 1<=len(s)<=limit:deny('ENCODING_DENIED')
    try:
        raw=base64.b64decode(s,validate=True)
        if base64.b64encode(raw).decode()!=s:deny('NONCANONICAL_ENCODING')
        return raw
    except (ValueError,binascii.Error):deny('ENCODING_DENIED')


def verify_authority(bundle,envelope,*,pinned_public_key,trusted_now):
    """Validate an S0 checkpoint against a verifier-side **pinned** key.

    Signature validity here is only under an injected test pin, NEVER an
    assertion that any production/external party controls it.
    """
    if type(pinned_public_key) is not bytes or len(pinned_public_key)!=32:
        deny('INDEPENDENT_TRUST_PIN_REQUIRED')
    if type(trusted_now) is not int or trusted_now<=0:deny('TRUSTED_CLOCK_REQUIRED')
    if type(bundle) is not dict or set(bundle)!=ORIGIN:deny('ORIGIN_SCHEMA_DENIED')
    if type(bundle['package_sha256']) is not str or not HEX64.fullmatch(bundle['package_sha256']):deny('ORIGIN_DIGEST_DENIED')
    try:
        source={k:v for k,v in bundle.items() if k!='package_sha256'}
        recomputed=hashlib.sha256(canonical(source)).hexdigest()
    except (TypeError, ValueError, OverflowError):deny('ORIGIN_CANONICAL_DENIED')
    if recomputed!=bundle['package_sha256']:deny('ORIGIN_DIGEST_MISMATCH')
    work=bundle['Work'];proj=bundle['Project'];evidence=bundle['Evidence']
    if type(work) is not dict or type(proj) is not dict or type(evidence) is not dict:
        deny('ORIGIN_OBJECT_INVALID')
    if proj!={'project_id':'MUSITU_AXIOM','scope':'ISOLATED_SYNTHETIC_S0'}:
        deny('PROJECT_SCOPE_DENIED')
    if work.get('status')!='VERIFIED_S0' or type(work.get('source_commit')) is not str or not HEX40.fullmatch(work['source_commit']) or type(work.get('work_id')) is not str or not ID.fullmatch(work['work_id']):
        deny('WORK_UNEARNED_OR_INVALID')
    for flag in ('external_origin_certified','provider_remaining_certified','production_release_authorized'):
        if evidence.get(flag) is not False:deny('PRODUCTION_ORIGIN_CLAIM_DENIED')
    links=evidence.get('operation_links')
    if type(links) is not list or len(links)!=6 or any(type(x) is not dict or x.get('dispatch_state')!='COMPLETED' or type(x.get('request_id')) is not str or not ID.fullmatch(x['request_id']) for x in links):
        deny('INCOMPLETE_ORIGINAL_DISPATCH')
    if len({x['request_id'] for x in links})!=6:deny('DUPLICATE_DISPATCH_LINK')
    if type(bundle['Agents']) is not list or len(bundle['Agents'])!=2 or {x.get('agent_id') for x in bundle['Agents'] if type(x) is dict}!={'agent-a','agent-b'}:
        deny('UNEXPECTED_AGENT_SET')
    if type(bundle['Artifacts']) is not list or len(bundle['Artifacts'])!=2:deny('ARTIFACT_COUNT_DENIED')
    if type(envelope) is not dict or set(envelope)!=ENVELOPE:
        deny('SIGNED_ATTESTATION_REQUIRED')
    raw=strict_base64(envelope['payload_b64'],8192)
    sig=strict_base64(envelope['signature_b64'],100)
    if len(sig)!=64 or len(raw)>4096:deny('ATTESTATION_SIZE_DENIED')
    try:Ed25519PublicKey.from_public_bytes(pinned_public_key).verify(sig,raw)
    except (InvalidSignature,ValueError,TypeError):deny('UNPINNED_SIGNATURE_INVALID')
    try:
        document=json.loads(raw.decode('utf8'))
        if canonical(document)!=raw:deny('ATTESTATION_NONCANONICAL')
    except (ValueError,UnicodeError,TypeError):deny('ATTESTATION_JSON_DENIED')
    if type(document) is not dict or set(document)!=BODY:deny('ATTESTATION_SCHEMA_DENIED')
    if document['schema']!=PROTOCOL or document['audience']!='axiom.trackb24.s0.audit' or document['execution_scope']!='S0_SYNTHETIC_ONLY':
        deny('ATTESTATION_AUDIENCE_SCOPE_DENIED')
    if document['production_authority'] is not False or document['provider_dispatch_authorized'] is not False or document['max_cost_usd']!='0.00':
        deny('NO_PRODUCTION_OR_PAID_AUTHORITY')
    if document['source_commit']!=work['source_commit'] or document['work_id']!=work['work_id'] or document['package_sha256']!=bundle['package_sha256']:
        deny('ORIGIN_ATTESTATION_BINDING_DENIED')
    a,b=document['issued_at'],document['expires_at']
    if type(a) is not int or type(b) is not int or a>=b or b-a>120 or a>trusted_now+5 or b<=trusted_now:
        deny('ATTESTATION_CLOCK_DENIED')
    if any(datetime.fromtimestamp(t,timezone.utc).date()!=datetime.fromtimestamp(trusted_now,timezone.utc).date() for t in (a,b-1)):
        deny('UTC_DAY_CROSSING_DENIED')
    if type(document['sequence']) is not int or document['sequence']<1 or type(document['nonce']) is not str or not ID.fullmatch(document['nonce']):
        deny('ATTESTATION_REPLAY_SCOPE_DENIED')
    return {'status':'B24_SYNTHETIC_CHECKPOINT_VALID_NOT_PRODUCTION',
            'source_commit':work['source_commit'],'bundle_sha256':bundle['package_sha256'],
            'signed_sequence':document['sequence'],'production_authority':False,
            'provider_dispatch_allowed':False}


def reconcile_regions(replica_snapshots):
    """S0 local duplicate-region evidence consistency; no distributed quorum.

    A conflict, missing shard, unknown result or mixed tenant/account/day cannot
    produce positive evidence. The two *provided* replicas are not externally
    authenticated, so matching rows are not proof of geographic independence.
    """
    if type(replica_snapshots) is not list or len(replica_snapshots)!=2:
        deny('EXPECTED_TWO_READ_ONLY_SNAPSHOTS')
    maps=[];region_names=[]
    for snapshot in replica_snapshots:
        if type(snapshot) is not list or len(snapshot)!=6:deny('REGION_OPERATION_SET_INCOMPLETE')
        rows={};names=set()
        for row in snapshot:
            if type(row) is not dict or set(row)!=REGION:deny('REGION_ROW_SCHEMA_INVALID')
            for k in ('region','account_id','tenant_id','workload_id','request_id','grant_id'):
                if type(row[k]) is not str or not ID.fullmatch(row[k]):deny('REGION_ID_DENIED')
            if row['utc_day']!='2026-10-13':deny('S0_DAY_SCOPE_DENIED')
            if type(row['body_sha256']) is not str or not HEX64.fullmatch(row['body_sha256']) or type(row['result_sha256']) is not str or not HEX64.fullmatch(row['result_sha256']):deny('REGION_DIGEST_INVALID')
            if row['state']!='COMPLETED':deny('UNRECONCILED_PROVIDER_OUTCOME')
            if row['request_id'] in rows:deny('DUPLICATE_REGION_OPERATION')
            if row['request_id'] not in {f'b22-{w}-{i}' for w in ('agent-a','agent-b') for i in range(3)}:deny('UNEXPECTED_REGION_REQUEST')
            names.add(row['region']);rows[row['request_id']]={k:v for k,v in row.items() if k!='region'}
        if len(names)!=1:deny('MIXED_REPLICA_REGION')
        region_names.append(next(iter(names)));maps.append(rows)
    if region_names[0]==region_names[1]:deny('NONINDEPENDENT_REPLICA_NAMES')
    if set(maps[0])!=set(maps[1]) or maps[0]!=maps[1]:deny('REGION_DIVERGENCE_DENIED')
    return {'unique_operations':6,'replicas_seen':2,'authority':'S0_RECONCILED_NOT_PRODUCTION'}

def record_checkpoint(db_file,bundle,envelope,*,pinned_public_key,trusted_now):
    # S0 only: local WAL replay stop, not cross-region quota authorization.
    audit=verify_authority(bundle,envelope,pinned_public_key=pinned_public_key,trusted_now=trusted_now)
    doc=json.loads(strict_base64(envelope['payload_b64'],8192))
    dbfile=Path(db_file)
    if dbfile.is_symlink() or not dbfile.parent.is_dir():deny('REPLAY_JOURNAL_PATH_DENIED')
    try:
        with sqlite3.connect(str(dbfile),timeout=10,isolation_level=None) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS checkpoints (work_id TEXT NOT NULL, sequence INTEGER NOT NULL, nonce TEXT NOT NULL UNIQUE, source_digest TEXT NOT NULL, PRIMARY KEY(work_id,sequence))')
            db.execute('BEGIN IMMEDIATE')
            latest=db.execute('SELECT MAX(sequence) FROM checkpoints WHERE work_id=?',(doc['work_id'],)).fetchone()[0]
            if latest is not None and doc['sequence']<=latest:
                db.execute('ROLLBACK');deny('REPLAY_OR_SEQUENCE_ROLLBACK_DENIED')
            if db.execute('SELECT 1 FROM checkpoints WHERE nonce=?',(doc['nonce'],)).fetchone():
                db.execute('ROLLBACK');deny('CROSS_WORK_NONCE_REPLAY_DENIED')
            db.execute('INSERT INTO checkpoints VALUES(?,?,?,?)',
                (doc['work_id'],doc['sequence'],doc['nonce'],bundle['package_sha256']))
            db.execute('COMMIT')
    except sqlite3.IntegrityError:deny('ATOMIC_REPLAY_CONFLICT_DENIED')
    except sqlite3.OperationalError:deny('REPLAY_JOURNAL_UNAVAILABLE')
    return {**audit,'status':'B24_S0_CHECKPOINT_RECORDED'}
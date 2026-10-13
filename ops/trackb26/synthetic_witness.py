"""S0 test simulator, NOT independent authority, not for deployment.

SQLite HIGH-WATER state is still rollbackable. Removing this synthetic witness's
DB recreates the B25-style vulnerability. Production MUST provide a separately
controlled, nonrollbackable append_once ledger at the network/service boundary.
"""
import base64
from pathlib import Path
import sqlite3
import hashlib

from witness_gate import WitnessDenied, canonical, SCHEMA
from quorum import ID, validate, verify_quorum, QuorumDenied

class SyntheticWitness:
    def __init__(self,db_path,private_key,pinned_voters,witness_id='test-witness'):
        if type(witness_id) is not str or not ID.fullmatch(witness_id) or not hasattr(private_key,'sign'):
            raise WitnessDenied('SIMULATOR_INVALID')
        self.db_path=Path(db_path)
        self.key=private_key
        self.witness_id=witness_id
        if type(pinned_voters) is not dict or set(pinned_voters)!=set(('voter-a','voter-b','voter-c')) or any(type(v) is not bytes or len(v)!=32 for v in pinned_voters.values()):
            raise WitnessDenied('WITNESS_TRUSTED_VOTER_PINSET_REQUIRED')
        self.pinned_voters=dict(pinned_voters)
        try:
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
            signer_pub=private_key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        except (AttributeError,TypeError,ValueError) as exc:
            raise WitnessDenied('WITNESS_SIGNER_PUBLIC_KEY_INVALID') from exc
        if signer_pub in self.pinned_voters.values():
            raise WitnessDenied('WITNESS_SIGNER_NOT_SEPARATE_FROM_VOTERS')

    def commit(self,*,proposal,proposal_sha256,votes_sha256,trusted_now,votes=None):
        # This is a local emulator for tests. It may NEVER be connected to a
        # production provider dispatch or used to certify global durability.
        validate(proposal,trusted_now)
        # Critical security boundary: do not trust the broker's quorum assertion.
        # Verify voter signatures with witness-configured pins, independently.
        try:
            verify_quorum(votes,proposal,pinned_voters=self.pinned_voters,trusted_now=trusted_now)
            recomputed_proposal=hashlib.sha256(canonical(proposal)).hexdigest()
            recomputed_votes=hashlib.sha256(canonical(sorted(votes,key=lambda r:r['voter_id']))).hexdigest()
        except (QuorumDenied,TypeError,ValueError,KeyError) as exc:
            raise WitnessDenied('WITNESS_INDEPENDENT_QUORUM_REJECTED') from exc
        if proposal_sha256!=recomputed_proposal or votes_sha256!=recomputed_votes:
            raise WitnessDenied('WITNESS_BROKER_DIGEST_SUBSTITUTION_DENIED')
        if self.db_path.is_symlink() or not self.db_path.parent.is_dir():
            raise WitnessDenied('SIMULATOR_JOURNAL_PATH_INVALID')
        db=None
        try:
            db=sqlite3.connect(str(self.db_path),timeout=10,isolation_level=None)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS highwater (work_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS receipts (work_id TEXT NOT NULL, sequence INTEGER NOT NULL, nonce TEXT UNIQUE NOT NULL, proposal_sha256 TEXT NOT NULL, votes_sha256 TEXT NOT NULL, PRIMARY KEY(work_id,sequence))')
            db.execute('BEGIN IMMEDIATE')
            high=db.execute('SELECT sequence FROM highwater WHERE work_id=?',(proposal['work_id'],)).fetchone()
            if high is not None and proposal['sequence']<=high[0]:
                db.execute('ROLLBACK');raise WitnessDenied('SIMULATOR_MONOTONIC_REPLAY_DENIED')
            if db.execute('SELECT 1 FROM receipts WHERE nonce=?',(proposal['nonce'],)).fetchone():
                db.execute('ROLLBACK');raise WitnessDenied('SIMULATOR_NONCE_REPLAY_DENIED')
            db.execute('INSERT INTO receipts VALUES (?,?,?,?,?)',(proposal['work_id'],proposal['sequence'],proposal['nonce'],proposal_sha256,votes_sha256))
            db.execute('INSERT INTO highwater(work_id,sequence) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET sequence=excluded.sequence',(proposal['work_id'],proposal['sequence']))
            db.execute('COMMIT')
        except (sqlite3.OperationalError,sqlite3.IntegrityError) as exc:
            raise WitnessDenied('SIMULATOR_JOURNAL_UNAVAILABLE') from exc
        finally:
            if db is not None:db.close()
        body=canonical({'schema':SCHEMA,'witness_id':self.witness_id,'proposal_sha256':proposal_sha256,
            'votes_sha256':votes_sha256,'work_id':proposal['work_id'],'sequence':proposal['sequence'],
            'nonce':proposal['nonce'],'utc_day':proposal['utc_day'],
            'authority_class':'S0_SYNTHETIC_AUDIT_ONLY','provider_dispatch_allowed':False,
            'production_authority':False})
        signature=self.key.sign(body)
        if type(signature) is not bytes or len(signature)!=64:
            raise WitnessDenied('SIMULATOR_SIGN_FAILURE_AFTER_COMMIT')
        return {'witness_id':self.witness_id,'payload_b64':base64.b64encode(body).decode(),
                'signature_b64':base64.b64encode(signature).decode()}

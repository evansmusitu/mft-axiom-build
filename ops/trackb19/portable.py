"""Portable synthetic S0 native-event evidence, signed but NOT externally anchored.

A signer in the same CI authority domain can sign altered evidence; this tool
cannot turn a developer-controlled public key into an independent certification.
"""
import base64
import binascii
import hashlib
import json
import re
from copy import deepcopy
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat,load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from journal import _event,_canonical,GENESIS

HEX64=re.compile(r'^[0-9a-f]{64}$')
HEX40=re.compile(r'^[0-9a-f]{40}$')
IDENT=re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$')
BODY={'schema','work_id','source_commit','chain_sha256','workers','source_sha256','events'}
ENVELOPE=BODY|{'signer_public_pem','signature_b64'}
SCHEMA='axiom.trackb19.s0.portable-evidence.v1'

class PortableDenied(Exception):pass


def _replay(body):
    if type(body) is not dict or set(body)!=BODY or body.get('schema')!=SCHEMA:
        raise PortableDenied('PORTABLE_SCHEMA_DENIED')
    if not isinstance(body['work_id'],str) or not IDENT.fullmatch(body['work_id']) or type(body['source_commit']) is not str or not HEX40.fullmatch(body['source_commit']):
        raise PortableDenied('PORTABLE_SOURCE_CONTEXT_DENIED')
    trace=body['events']
    if type(trace) is not list or not 1<=len(trace)<=10000:
        raise PortableDenied('PORTABLE_TRACE_SIZE_DENIED')
    hash_prev=GENESIS
    workers={}
    ords={}
    for item in trace:
        if type(item) is not dict or set(item)!={'worker','ordinal','event'}:
            raise PortableDenied('PORTABLE_EVENT_SHAPE_DENIED')
        who=item['worker'];ordinal=item['ordinal'];event=item['event']
        if type(who) is not str or not IDENT.fullmatch(who) or type(ordinal) is not int or ordinal!=ords.get(who,-1)+1:
            raise PortableDenied('PORTABLE_ORDINAL_DENIED')
        try:_event(event)
        except Exception:raise PortableDenied('PORTABLE_SDK_METADATA_DENIED') from None
        payload=_canonical({'work_id':body['work_id'],'worker':who,'ordinal':ordinal,'event':event})
        hash_prev=hashlib.sha256(bytes.fromhex(hash_prev)+payload).hexdigest()
        ords[who]=ordinal
        counts=workers.setdefault(who,{'ActionEvent':0,'ObservationEvent':0,'finish':0})
        counts[event['kind']]+=1
        if event['kind']=='ActionEvent' and event['tool_name']=='finish':counts['finish']+=1
    if hash_prev!=body['chain_sha256'] or body['workers']!=workers:
        raise PortableDenied('PORTABLE_CHAIN_INCONSISTENT')
    digest_map=body['source_sha256']
    if type(digest_map) is not dict or set(digest_map)!=set(workers) or any(type(x) is not str or not HEX64.fullmatch(x) for x in digest_map.values()):
        raise PortableDenied('PORTABLE_SOURCE_DIGEST_DENIED')
    return {'chain_sha256':hash_prev,'work_id':body['work_id'],'workers':workers,'source_sha256':digest_map,'events':len(trace)}


def _signing_blob(body):return _canonical(body)


def make_portable(proof,trace,source,signer,source_commit):
    if not hasattr(signer,'sign') or not hasattr(signer,'public_key'):
        raise PortableDenied('PORTABLE_SIGNER_INVALID')
    body={'schema':SCHEMA,'work_id':proof['work_id'],'source_commit':source_commit,
          'chain_sha256':proof['chain_sha256'],'workers':proof['workers'],
          'source_sha256':deepcopy(source),'events':deepcopy(trace)}
    _replay(body)
    sig=signer.sign(_signing_blob(body))
    if not isinstance(sig,bytes) or len(sig)!=64:
        raise PortableDenied('PORTABLE_SIGNER_INVALID')
    pub=signer.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo).decode('ascii')
    return {**body,'signer_public_pem':pub,'signature_b64':base64.b64encode(sig).decode('ascii')}


def verify_portable(envelope):
    if type(envelope) is not dict or set(envelope)!=ENVELOPE:
        raise PortableDenied('PORTABLE_ENVELOPE_SCHEMA_DENIED')
    body={k:envelope[k] for k in BODY}
    proof=_replay(body)
    try:
        sig=base64.b64decode(envelope['signature_b64'],validate=True)
        if len(sig)!=64 or base64.b64encode(sig).decode()!=envelope['signature_b64']:
            raise ValueError('signature noncanonical')
        pub=load_pem_public_key(envelope['signer_public_pem'].encode('ascii'))
        if not isinstance(pub,Ed25519PublicKey):raise ValueError('not Ed25519')
        pub.verify(sig,_signing_blob(body))
    except (ValueError,TypeError,UnicodeError,binascii.Error,Exception) as err:
        raise PortableDenied('PORTABLE_SIGNATURE_INVALID') from None
    return proof

#!/usr/bin/env python3
"""B19 synthetic-model real OpenHands SDK qualification, nonproduction S0.

Runs unchanged inherited B12 SDK coordinator in a clean temporary CI runner,
then independently hashes source/SDK callback metadata, persists a SQLite
journal, seals it with an ephemeral key, and proves tampering fails closed.
The ephemeral signature is NOT an external trust anchor or production authority.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from journal import EventJournal, EvidenceDenied, ingest_native_file
from portable import make_portable, verify_portable
import base64
import re

BASE=Path('/tmp/axiom-b12')
WORKERS={
    'agent-a': {'file':'mathfix.py','uid':65532,'source':'def multiply(a, b):\n    return a * b\n'},
    'agent-b': {'file':'clampfix.py','uid':65533,'source':'def clamp(value, low, high):\n    return max(low, min(high, value))\n'},
}
PASS='MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS'


def main():
    if os.geteuid()!=0:raise SystemExit('B19_ROOT_ORCHESTRATOR_REQUIRED')
    if any(os.getenv(k) for k in ('CLOUDFLARE_API_TOKEN','OPENAI_API_KEY','AXIOM_PRODUCTION_AUTHORIZATION')):
        raise SystemExit('B19_LIVE_PROVIDER_CREDENTIALS_DENIED')
    if BASE.exists():raise SystemExit('B19_NONFRESH_B12_RUNTIME_PATH_DENIED')
    b12=Path('/tmp/axiom-b19-verified-b12.py')
    if not b12.is_file():raise SystemExit('B19_SOURCED_B12_COORDINATOR_MISSING')
    process=subprocess.run([sys.executable,str(b12)],capture_output=True,text=True,timeout=120,
       env={'PATH':'/usr/bin:/bin:/usr/local/bin','PYTHONUNBUFFERED':'1','HOME':'/tmp',
            'OPENHANDS_DISABLE_TELEMETRY':'true','OTEL_SDK_DISABLED':'true'})
    print('B19_INHERITED_B12_EXIT='+str(process.returncode),flush=True)
    # Only a bounded, scrubbed tail is included in CI logs. B12 sends no real secrets.
    print('B19_NATIVE_B12_LOG_TAIL='+process.stdout[-4000:],flush=True)
    if process.returncode!=0 or PASS not in process.stdout:
        raise SystemExit('B19_NATIVE_SDK_EXECUTION_FAILED')
    receipts={}
    for line in process.stdout.splitlines():
        if line.startswith('B12_WORKER_RECEIPT='):
            row=json.loads(line.split('=',1)[1]);receipts[row['worker']]=row
    if set(receipts)!=set(WORKERS):raise SystemExit('B19_WORKER_RECEIPT_SET_MISMATCH')
    with tempfile.TemporaryDirectory(prefix='axiom-b19-') as workdir:
        j=EventJournal(Path(workdir)/'journal.sqlite')
        for who,task in WORKERS.items():
            receipt=receipts[who]
            source=(BASE/who/task['file']).read_bytes()
            if receipt['uid']!=task['uid'] or receipt['state']!='RETURNED' or receipt['native_finish']!=1:
                raise SystemExit('B19_NATIVE_WORKER_STATE_UNQUALIFIED')
            if source!=task['source'].encode() or hashlib.sha256(source).hexdigest()!=receipt['source_sha256']:
                raise SystemExit('B19_SOURCE_BINDING_FAILED')
            qty=ingest_native_file(j,'axiom-b19-native-s0',who,BASE/who/'native_events.jsonl')
            print('B19_INGESTED_NATIVE_EVENTS_'+who.upper().replace('-','_')+'='+str(qty),flush=True)
        proof=j.verify('axiom-b19-native-s0')
        for who,row in receipts.items():
            record=proof['workers'].get(who)
            if not record or record['ActionEvent']!=row['native_actions'] or record['ObservationEvent']!=row['native_observations'] or record['finish']!=1:
                raise SystemExit('B19_NATIVE_EVENT_RECEIPT_DIVERGENCE')
        if proof['events']<12:raise SystemExit('B19_NATIVE_EVENT_COUNT_INSUFFICIENT')
        # Recover journal process without triggering any model replay.
        original_hash=proof['chain_sha256'];j.close()
        j=EventJournal(Path(workdir)/'journal.sqlite')
        for who in WORKERS:
            ingest_native_file(j,'axiom-b19-native-s0',who,BASE/who/'native_events.jsonl')
        if j.verify('axiom-b19-native-s0')['chain_sha256']!=original_hash:
            raise SystemExit('B19_RESTART_REPLAY_FINGERPRINT_CHANGED')
        issuer=Ed25519PrivateKey.generate()
        j.seal('axiom-b19-native-s0',issuer.sign)
        proof=j.verify_seal('axiom-b19-native-s0',issuer.public_key().verify)
        if proof['chain_sha256']!=original_hash:raise SystemExit('B19_SEALED_CHAIN_CHANGED')
        # Tamper against separate evidence copy, preserve original sealed journal.
        copy=Path(workdir)/'tamper_copy.sqlite'
        j.db.backup(sqlite3.connect(str(copy)))
        corrupted=EventJournal(copy)
        corrupted.db.execute('UPDATE events SET event_data=? WHERE work_id=? AND seq=0',(b'{}','axiom-b19-native-s0'))
        try:
            corrupted.verify_seal('axiom-b19-native-s0',issuer.public_key().verify)
            raise SystemExit('B19_UNDETECTED_TAMPERING')
        except EvidenceDenied:
            print('B19_ALTERED_EVENT_REJECTED_PASS',flush=True)
        finally:corrupted.close()
        commit=os.environ.get('B19_SOURCE_COMMIT','')
        if not re.fullmatch(r'[0-9a-f]{40}',commit):raise SystemExit('B19_COMMIT_CONTEXT_MISSING')
        raw_rows=j.db.execute('SELECT worker,ordinal,event_data FROM events WHERE work_id=? ORDER BY seq',('axiom-b19-native-s0',)).fetchall()
        trace=[{'worker':who,'ordinal':ordinal,'event':json.loads(raw)} for who,ordinal,raw in raw_rows]
        portable=make_portable(proof,trace,{who:receipts[who]['source_sha256'] for who in WORKERS},issuer,commit)
        verified=verify_portable(portable)
        if verified['events']!=proof['events']:raise SystemExit('B19_PORTABLE_EVIDENCE_WRONG')
        encoded=base64.b64encode(json.dumps(portable,sort_keys=True,separators=(',',':')).encode()).decode()
        print('B19_PORTABLE_EVIDENCE_B64='+encoded,flush=True)
        print('B19_VERIFIED_EVENT_COUNTS='+json.dumps(proof['workers'],sort_keys=True),flush=True)
        print('B19_CHAIN_SHA256='+original_hash,flush=True)
        print('AXIOM_B19_GENUINE_OPENHANDS_SDK_NATIVE_EVENT_JOURNAL_S0_PASS_NOT_PRODUCTION',flush=True)
        j.close()

if __name__=='__main__': main()

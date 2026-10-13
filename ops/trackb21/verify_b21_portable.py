"""Independent CI job: no credentials, no SDK, verify actual signed B19 + B20 causality."""
import base64
import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'trackb19'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'trackb20'))
from portable import verify_portable
from verify_receipt import run as verify_original_b19
from causality import verify_linkage

source=os.environ.get('B21_PORTABLE_B64','')
if not source or len(source)>60000:raise SystemExit('B21_MISSING_PORTABLE_RECEIPT')
try:
    data=json.loads(base64.b64decode(source,validate=True))
    origin=verify_original_b19(source,os.environ.get('B21_SOURCE_COMMIT',''))
    verified=verify_portable(data)
    # Verify evidence authorizes no full production claim and that real native
    # callback events are causally linked, not rebuilt from transcript counts.
    result=verify_linkage(data['events'])
except Exception as exc:
    raise SystemExit('B21_PORTABLE_CAUSAL_VERIFICATION_DENIED:'+type(exc).__name__+':'+str(exc)[:250])
if set(result['workers'])!={'agent-a','agent-b'} or result['total_pairs']<6 or result['finish_count']!=2:
    raise SystemExit('B21_NATIVE_CAUSAL_COUNTS_DENIED')
print('AXIOM_B21_INDEPENDENT_SIGNED_OPENHANDS_CAUSAL_EVIDENCE_S0_PASS_NOT_PRODUCTION',verified['events'],result['total_pairs'],origin['portable_sha256'])

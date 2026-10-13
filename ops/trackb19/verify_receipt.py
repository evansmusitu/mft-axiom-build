#!/usr/bin/env python3
"""Independent PROCESS/JOB verifier for a portable B19 synthetic event receipt.

NOT an external identity trust anchor; asserts signature valid relative to the
public key in this receipt, plus source context, event provenance metadata,
and independent code-result hashes. Never treats receipt as production PASS.
"""
import base64
import hashlib
import json
import os
import re
from portable import PortableDenied, verify_portable

EXPECTED_SOURCE={
 'agent-a':'12141ca5171ea43624b961e04b6ef0e709db4d1b90d1c967bea2706afe4aad27',
 'agent-b':'92712716ad57b7dbdd97566faf64dda7597f5a18baa297d3168bf6fc9cd9b199',
}


def run(encoded, commit):
    if type(encoded) is not str or not 1 <= len(encoded) < 60000 or not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}',encoded):
        raise PortableDenied('PORTABLE_INPUT_ENCODING_DENIED')
    try:
        raw=base64.b64decode(encoded,validate=True)
        if base64.b64encode(raw).decode()!=encoded:raise ValueError('non canonical')
        envelope=json.loads(raw)
    except Exception:
        raise PortableDenied('PORTABLE_INPUT_JSON_DENIED') from None
    if envelope.get('source_commit')!=commit:
        raise PortableDenied('B19_COMMIT_BINDING_MISMATCH')
    verified=verify_portable(envelope)
    if verified['work_id']!='axiom-b19-native-s0' or verified['source_sha256']!=EXPECTED_SOURCE:
        raise PortableDenied('B19_NATIVE_SOURCE_NOT_MATCHED')
    if set(verified['workers'])!=set(EXPECTED_SOURCE):
        raise PortableDenied('B19_WORKER_SCOPE_UNEXPECTED')
    if verified['events']!=12:
        raise PortableDenied('B19_NATIVE_EVENT_QUOTA_NOT_EXACT')
    for x in verified['workers'].values():
        if x!={'ActionEvent':3,'ObservationEvent':3,'finish':1}:
            raise PortableDenied('B19_NATIVE_EVENT_SEQUENCE_UNQUALIFIED')
    return {'chain_sha256':verified['chain_sha256'],
            'portable_sha256':hashlib.sha256(raw).hexdigest(),
            'event_count':verified['events'],'worker_count':len(verified['workers'])}


def main():
    outcome=run(os.environ.get('B19_RECEIPT_B64'),os.environ.get('B19_SOURCE_COMMIT'))
    print('B19_INDEPENDENT_VERIFIER='+json.dumps(outcome,sort_keys=True))
    print('AXIOM_B19_PORTABLE_NATIVE_EVIDENCE_S0_VERIFIED_NO_EXTERNAL_AUTHORITY')

if __name__=='__main__':main()

"""Credentialless fail-closed CI transcript verifier for real B19+B21 run."""
import re
import sys
from pathlib import Path
from collections import Counter
from glob import glob

RE=re.compile(r'^B21_WORKERD_ADMITTED=(agent-[ab]):([0-2]):([a-f0-9]{64})$',re.MULTILINE)

def verify(raw):
    matches=RE.findall(raw)
    counts=Counter((w,int(i)) for w,i,_ in matches)
    expect={(w,i) for w in ('agent-a','agent-b') for i in range(3)}
    if len(matches)!=6 or set(counts)!=expect or any(v!=1 for v in counts.values()):
        raise ValueError('B21_NOT_EACH_REAL_SDK_CALL_ADMITTED_ONCE')
    required=(
        'MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS',
        'AXIOM_B19_GENUINE_OPENHANDS_SDK_NATIVE_EVENT_JOURNAL_S0_PASS_NOT_PRODUCTION',
        'B19_CHAIN_SHA256=',
        'B19_PORTABLE_EVIDENCE_B64=',
    )
    for marker in required:
        if marker not in raw:raise ValueError('B21_REQUIRED_ORIGIN_MARKER_ABSENT_'+marker)
    if 'B21_DENIED_BEFORE_NATIVE_MODEL_REPLY' in raw:
        raise ValueError('B21_MODEL_CALL_DENIED_DURING_REAL_SDK_PASS')
    return {'admissions':len(matches),'workers':2,'distinct_requests':6}

if __name__=='__main__':
    text=Path(sys.argv[1]).read_text()
    print('AXIOM_B21_S0_REAL_SDK_WORKERD_ADMISSION_RECEIPTS_PASS',verify(text),flush=True)

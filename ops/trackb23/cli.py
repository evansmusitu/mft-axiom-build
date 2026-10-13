#!/usr/bin/env python3
"""B23 synthetic S0 independent outcome receipt producer/consumer.

No secrets or provider usage. Full input is preserved only in CI job output; the
producer's signature is not an external independent authorization claim.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import sys
from evidence import join,verify_package_against_sources,JoinDenied
from storage import capture

PORTABLE=re.compile(r'^B19_PORTABLE_EVIDENCE_B64=([A-Za-z0-9+/]+={0,2})$',re.MULTILINE)
ADMISSION=re.compile(r'^(?:B22_WORKERD_ADMITTED|B23_SDK_ORIGINAL_REQUEST_SHA256)=.+$',re.MULTILINE)
B12_PASS='MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS'

def relevant_transcript(raw):
    admit=ADMISSION.findall(raw)
    if B12_PASS in raw:admit.append(B12_PASS)
    if 'B22_DENIED_BEFORE_NATIVE_MODEL_REPLY' in raw:admit.append('B22_DENIED_BEFORE_NATIVE_MODEL_REPLY')
    if 'B22_LOCAL_WORKERD_QUOTA_DENIED=' in raw:admit.append('B22_LOCAL_WORKERD_QUOTA_DENIED=UNKNOWN')
    return '\n'.join(admit)

def produce(log,state_dir,source_commit,out):
    raw=Path(log).read_text(encoding='utf-8')
    m=PORTABLE.findall(raw)
    if len(m)!=1:raise JoinDenied('B19_PORTABLE_COUNT_NOT_ONE')
    transcript=relevant_transcript(raw)
    journal,quota,paths=capture(state_dir)
    outcome=join(m[0],source_commit,transcript,journal,quota)
    if outcome['Work']['status']!='VERIFIED_S0':raise JoinDenied('B23_WORK_OUTCOME_INCOMPLETE')
    document={'source_commit':source_commit,'portable_b64':m[0],'transcript':transcript,
              'journal_rows':journal,'quota_rows':quota,'outcome':outcome,
              'storage_diagnostics':{'count':len(paths)}}
    Path(out).write_text(json.dumps(document,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
    print('AXIOM_B23_REAL_WORKERD_NATIVE_JOURNAL_JOIN_S0_PASS_NOT_PRODUCTION',len(journal),len(quota),outcome['package_sha256'])

def consume(document,source_commit):
    doc=json.loads(Path(document).read_text(encoding='utf-8'))
    if type(doc) is not dict or set(doc)!={'source_commit','portable_b64','transcript','journal_rows','quota_rows','outcome','storage_diagnostics'} or doc['source_commit']!=source_commit:
        raise JoinDenied('B23_UNTRUSTED_INPUT_DOCUMENT')
    expected=verify_package_against_sources(doc['outcome'],doc['portable_b64'],source_commit,
          doc['transcript'],doc['journal_rows'],doc['quota_rows'])
    if expected['status']!='VERIFIED_S0':raise JoinDenied('B23_VERIFICATION_INCOMPLETE')
    if type(doc['storage_diagnostics']) is not dict or set(doc['storage_diagnostics'])!={'count'} or doc['storage_diagnostics']['count']!=2:raise JoinDenied('STORAGE_ORIGIN_COUNT_DENIED')
    print('AXIOM_B23_CREDENTIALLESS_CONSUMER_CROSS_LAYER_S0_PASS_NOT_EXTERNAL_AUTHORITY',expected['operations'],expected['sha256'])

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='mode',required=True)
    a=sub.add_parser('produce');a.add_argument('--native-log',required=True);a.add_argument('--state-dir',required=True);a.add_argument('--commit',required=True);a.add_argument('--out',required=True)
    a=sub.add_parser('consume');a.add_argument('--file',required=True);a.add_argument('--commit',required=True)
    a=p.parse_args()
    if a.mode=='produce':produce(a.native_log,a.state_dir,a.commit,a.out)
    else:consume(a.file,a.commit)
if __name__=='__main__':main()

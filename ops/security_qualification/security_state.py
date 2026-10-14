"""AXIOM B27 public evidence *provenance* record, NOT independent release authority.

A successful Sigstore/GitHub attestation would establish provenance of this
record and (for a public repo) a public transparency log entry. It would NOT
resolve B27's successful destructive majority rollback attack. An AXIOM
builder must never interpret this audit artifact as a production permit.
"""
import hashlib
import json
import re

EXPECTED_B27_SHA = 'c57cf8505ceee91a6b9b93ae6368f54c6b9ae127'
REPO = 'evansmusitu/mft-axiom-build'
BRANCH = 'security/axiom-b27-provenance-preflight-s0-20261014'
SCHEMA = 'musitu.axiom.security.b27-public-evidence-provenance.s0.v1'
MARKERS = frozenset({
    'AXIOM_B27_B25_B26_EXACT_PARENT_SHA256_PASS',
    'AXIOM_B27_BOUNDARY_TESTS_PASS 15 NOT_EXTERNAL',
    'AXIOM_B27_GLOBAL_ROLLBACK_COUNTEREXAMPLE_REPRODUCED_NOT_FIXED',
})
FIELDS = {'schema','repository','ref','source_commit','b27_parent_commit',
          'workflow_run_id','transcript_sha256','observed_test_markers',
          'global_antirollback','independent_witness','provider_zero_cost',
          'sigstore_provenance_status','production_authority','provider_dispatch_allowed'}
SHA40=re.compile(r'^[a-f0-9]{40}$')
NUM=re.compile(r'^[1-9][0-9]{0,20}$')

class AnchorDenied(Exception):pass

def _transcript(raw):
    if type(raw) is not bytes or not 1<=len(raw)<=1_000_000:
        raise AnchorDenied('TEST_TRANSCRIPT_SIZE_DENIED')
    try:lines=set(raw.decode('utf-8').splitlines())
    except UnicodeDecodeError:raise AnchorDenied('NON_UTF8_TRANSCRIPT') from None
    if not MARKERS.issubset(lines):raise AnchorDenied('TEST_EVIDENCE_REQUIRED')
    # A manufactured PASS record would directly contradict the archived attack.
    if any('GLOBAL_ANTIROLLBACK_CERTIFIED' in s or
           'B27_GLOBAL_ANTIROLLBACK_PASS' in s for s in lines):
        raise AnchorDenied('FALSE_SECURITY_STATUS_DENIED')
    return hashlib.sha256(raw).hexdigest()

def create_record(*,repo,branch,commit,b27_parent,workflow_run_id,transcript):
    if (repo!=REPO or branch!=BRANCH or type(commit) is not str or not SHA40.fullmatch(commit) or
        b27_parent!=EXPECTED_B27_SHA or type(workflow_run_id) is not str or not NUM.fullmatch(workflow_run_id)):
        raise AnchorDenied('AUTHORITY_CONTEXT_DENIED')
    output={
        'schema':SCHEMA,'repository':REPO,'ref':'refs/heads/'+BRANCH,
        'source_commit':commit,'b27_parent_commit':EXPECTED_B27_SHA,
        'workflow_run_id':workflow_run_id,'transcript_sha256':_transcript(transcript),
        'observed_test_markers':sorted(MARKERS),
        'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
        'independent_witness':'NOT_CERTIFIED',
        'provider_zero_cost':'NOT_VERIFIED',
        'sigstore_provenance_status':'NOT_PUBLISHED_APPROVAL_REQUIRED',
        'production_authority':False,'provider_dispatch_allowed':False,
    }
    validate_record(output,transcript)
    return output

def validate_record(row,transcript):
    if type(row) is not dict or set(row)!=FIELDS:
        raise AnchorDenied('PROVENANCE_RECORD_SCHEMA_DENIED')
    fixed={'schema':SCHEMA,'repository':REPO,'ref':'refs/heads/'+BRANCH,
      'b27_parent_commit':EXPECTED_B27_SHA,'observed_test_markers':sorted(MARKERS),
      'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
      'independent_witness':'NOT_CERTIFIED','provider_zero_cost':'NOT_VERIFIED',
      'sigstore_provenance_status':'NOT_PUBLISHED_APPROVAL_REQUIRED',
      'production_authority':False,'provider_dispatch_allowed':False,
      'transcript_sha256':_transcript(transcript)}
    if any(type(row[k]) is not type(v) or row[k]!=v for k,v in fixed.items()):
        raise AnchorDenied('PROVENANCE_STATUS_TAMPERING_DENIED')
    if (type(row['source_commit']) is not str or not SHA40.fullmatch(row['source_commit']) or
        type(row['workflow_run_id']) is not str or not NUM.fullmatch(row['workflow_run_id'])):
        raise AnchorDenied('UNTRUSTED_SOURCE_CONTEXT')
    return True

def deterministic_json(row):
    return json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)+'\n'

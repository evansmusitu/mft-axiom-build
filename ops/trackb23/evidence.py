"""B23 S0 Work/Agent/Artifact/Evidence causal join for real OpenHands runs.

This verifies consistency of B19 signed native callbacks, B22 Workerd journal
rows, B15 quota reservations, and the B22 bridge transcript. Sources within
one synthetic CI trust domain are NOT externally certified or authoritative.
No real provider/client, secrets, or production side effects.
"""
import base64
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'trackb19'))
sys.path.insert(0,str(HERE.parent/'trackb20'))
from verify_receipt import run as verify_native
from causality import verify_linkage

HEX=re.compile(r'^[0-9a-f]{64}$')
ID=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
ADMIT=re.compile(r'^B22_WORKERD_ADMITTED=(agent-[ab]):([0-2]):([0-9a-f]{64})$')
WORKERS=('agent-a','agent-b')
EXPECTED={f'b22-{w}-{i}' for w in WORKERS for i in range(3)}
JOURNAL_FIELDS={'request_id','account_id','utc_day','tenant_id','workload_id','body_sha','quota_grant_id','state','result_sha'}
QUOTA_FIELDS={'grant_id','request_id','tenant_id','workload_id','request_sha','neurons'}

class JoinDenied(Exception): pass

def canonical(o): return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')
def require(cond,code):
    if not cond:raise JoinDenied(code)

def trusted_native(portable_b64,commit):
    require(type(portable_b64) is str and 0<len(portable_b64)<60000,'NATIVE_EVIDENCE_ABSENT')
    try:
        payload=base64.b64decode(portable_b64,validate=True)
        require(base64.b64encode(payload).decode()==portable_b64,'NATIVE_ENCODING_DENIED')
        env=json.loads(payload)
        origin=verify_native(portable_b64,commit)
        causal=verify_linkage(env['events'])
    except Exception as e:raise JoinDenied('B19_B20_NATIVE_SIGNATURE_OR_CAUSAL_DENIED') from e
    require(causal['finish_count']==2 and causal['total_pairs']==6 and set(causal['workers'])==set(WORKERS),'NATIVE_WORKER_COMPLETION_UNPROVEN')
    return env,origin,causal

def transcript_admissions(transcript):
    require(type(transcript) is str and len(transcript)<400000,'GATEWAY_TRANSCRIPT_INVALID')
    rows=[]
    for line in transcript.splitlines():
        if line.startswith('B22_WORKERD_ADMITTED='):
            m=ADMIT.fullmatch(line)
            require(m is not None,'GATEWAY_RECEIPT_MALFORMED')
            who,index,digest=m.groups()
            rows.append({'request_id':f'b22-{who}-{index}','workload_id':who,'body_sha':digest})
    require(len(rows)==6 and {r['request_id'] for r in rows}==EXPECTED,'GATEWAY_SDK_ADMISSIONS_INCOMPLETE_OR_DUPLICATE')
    for token in ('B22_DENIED_BEFORE_NATIVE_MODEL_REPLY','B22_LOCAL_WORKERD_QUOTA_DENIED='):
        require(token not in transcript,'SDK_PROVIDER_GATE_DENIED')
    require('MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS' in transcript,'REAL_SDK_COMPLETION_UNPROVEN')
    return {r['request_id']:r for r in rows}

def join(portable_b64,source_commit,transcript,journal_rows,quota_rows):
    require(type(source_commit) is str and re.fullmatch(r'[0-9a-f]{40}',source_commit),'UNPINNED_SOURCE_COMMIT')
    env,native,causal=trusted_native(portable_b64,source_commit)
    admitted=transcript_admissions(transcript)
    require(type(journal_rows) is list and len(journal_rows)==6,'JOURNAL_SNAPSHOT_INCOMPLETE')
    require(type(quota_rows) is list and len(quota_rows)==6,'QUOTA_SNAPSHOT_INCOMPLETE')
    journal={};quota={};all_days=set();all_accounts=set();all_tenants=set()
    for j in journal_rows:
        require(type(j) is dict and set(j)==JOURNAL_FIELDS,'JOURNAL_ROW_SCHEMA_DENIED')
        rid=j['request_id']
        require(type(rid) is str and rid in EXPECTED and rid not in journal,'JOURNAL_OPERATION_DUPLICATE_OR_UNKNOWN')
        w=rid.rsplit('-',1)[0].removeprefix('b22-')
        require(j['workload_id']==w and all(type(j[k]) is str and ID.fullmatch(j[k]) for k in ('account_id','tenant_id','quota_grant_id')),'JOURNAL_SCOPE_DENIED')
        require(type(j['utc_day']) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}',j['utc_day']),'JOURNAL_DAY_DENIED')
        require(type(j['body_sha']) is str and HEX.fullmatch(j['body_sha']),'JOURNAL_BODY_SHA_DENIED')
        require(j['state'] in ('COMPLETED','ISSUED','UNKNOWN'),'JOURNAL_UNSUPPORTED_STATE')
        require((j['state']=='COMPLETED' and type(j['result_sha']) is str and HEX.fullmatch(j['result_sha'])) or (j['state'] in ('ISSUED','UNKNOWN') and j['result_sha'] is None),'JOURNAL_RESULT_STATE_INCONSISTENT')
        all_days.add(j['utc_day']);all_accounts.add(j['account_id']);all_tenants.add(j['tenant_id']);journal[rid]=j
    require(len(all_days)==len(all_accounts)==len(all_tenants)==1,'JOURNAL_ACCOUNT_TENANT_DAY_SPLIT')
    for q in quota_rows:
        require(type(q) is dict and set(q)==QUOTA_FIELDS,'QUOTA_ROW_SCHEMA_DENIED')
        rid=q['request_id']
        require(type(rid) is str and rid in EXPECTED and rid not in quota,'QUOTA_OPERATION_DUPLICATE_OR_UNKNOWN')
        w=rid.rsplit('-',1)[0].removeprefix('b22-')
        require(q['workload_id']==w and type(q['grant_id']) is str and ID.fullmatch(q['grant_id']),'QUOTA_SCOPE_DENIED')
        require(type(q['neurons']) is int and 0<q['neurons']<=100,'QUOTA_NEURON_SCOPE_DENIED')
        require(type(q['request_sha']) is str and HEX.fullmatch(q['request_sha']),'QUOTA_HASH_DENIED')
        quota[rid]=q
    require(set(journal)==set(quota)==set(admitted)==EXPECTED,'MISSING_CROSS_LAYER_OPERATION')
    operations=[]
    for w in WORKERS:
        events=[e['event'] for e in env['events'] if e['worker']==w]
        require(len(events)==6,'MISSING_NATIVE_EVENTS')
        for i in range(3):
            action=events[2*i];obs=events[2*i+1]
            rid=f'b22-{w}-{i}'
            j=journal[rid];q=quota[rid];a=admitted[rid]
            require(action['kind']=='ActionEvent' and obs['kind']=='ObservationEvent' and action['id']==obs['action_id'] and action['tool_call_id']==obs['tool_call_id'],'SDK_ACTION_OBSERVATION_MISMATCH')
            require(action['tool_name']==('finish' if i==2 else 'file_editor'),'NATIVE_TOOL_SEQUENCE_NOT_AUTHORIZED')
            require(j['body_sha']==q['request_sha']==a['body_sha'],'PROVIDER_PAYLOAD_CROSS_LAYER_HASH_MISMATCH')
            require(j['quota_grant_id']==q['grant_id'] and j['tenant_id']==q['tenant_id'] and j['workload_id']==q['workload_id']==w,'QUOTA_JOURNAL_IDENTITY_MISMATCH')
            # B22's synthetic transport deliberately hashes the exact same
            # canonical payload bytes as its model request, so equality is
            # required. An actual provider result would have different rules.
            if j['state']=='COMPLETED':require(j['result_sha']==j['body_sha'],'SYNTHETIC_RESULT_BYTES_INCONSISTENT')
            operations.append({'request_id':rid,'agent_id':w,'model_ordinal':i,'action_id':action['id'],
                'tool_call_id':action['tool_call_id'],'observation_id':obs['id'],'tool_name':action['tool_name'],
                'body_sha256':j['body_sha'],'quota_grant_id':q['grant_id'],'reserved_neurons':q['neurons'],
                'dispatch_state':j['state']})
    complete=all(o['dispatch_state']=='COMPLETED' for o in operations)
    package={
      'schema':'axiom.trackb23.s0.native-durable-outcome.v1',
      'Project':{'project_id':'MUSITU_AXIOM','scope':'ISOLATED_SYNTHETIC_S0'},
      'Work':{'work_id':env['work_id'],'source_commit':source_commit,
              'status':'VERIFIED_S0' if complete else 'INCOMPLETE_NOT_PROVEN'},
      'Agents':[{'agent_id':w,'action_observation_pairs':causal['workers'][w]['matched_pairs'],
                 'native_finish':causal['workers'][w]['finish_actions']} for w in WORKERS],
      'Artifacts':[{'agent_id':w,'source_sha256':env['source_sha256'][w]} for w in WORKERS],
      'Evidence':{'b19_native_chain_sha256':native['chain_sha256'],
                  'b19_portable_sha256':native['portable_sha256'],
                  'gateway_transcript_sha256':hashlib.sha256(transcript.encode()).hexdigest(),
                  'journal_rows_sha256':hashlib.sha256(canonical(journal_rows)).hexdigest(),
                  'quota_rows_sha256':hashlib.sha256(canonical(quota_rows)).hexdigest(),
                  'operation_links':operations,'external_origin_certified':False,
                  'provider_remaining_certified':False,'production_release_authorized':False}
    }
    package['package_sha256']=hashlib.sha256(canonical(package)).hexdigest()
    return package

def verify_package_against_sources(bundle,portable_b64,source_commit,transcript,journal_rows,quota_rows):
    require(type(bundle) is dict and set(bundle)=={'schema','Project','Work','Agents','Artifacts','Evidence','package_sha256'},'PACKAGE_SCHEMA_DENIED')
    expected=join(portable_b64,source_commit,transcript,journal_rows,quota_rows)
    require(canonical(bundle)==canonical(expected),'B23_OUTCOME_PACKAGE_TAMPERED')
    return {'operations':len(expected['Evidence']['operation_links']),'status':expected['Work']['status'],'sha256':expected['package_sha256']}

"""One-shot synthetic numeric verification on GitHub runner -> Databricks MLflow.
One private experiment and one run; no Databricks jobs, clusters, LLMs or Axiom production calls.
"""
from __future__ import annotations
import contextlib
import hashlib
import io
import json
import os
import re
import runpy
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

HOST = 'https://dbc-3179c56f-a6c7.cloud.databricks.com'
CASE_IDS = frozenset({'math-exact-1','rounding-1','finance-mismatch-1','bad-nan'})
ENDPOINTS = frozenset({
 ('GET','/api/2.0/preview/scim/v2/Me'),
 ('GET','/api/2.0/mlflow/experiments/get-by-name'),
 ('POST','/api/2.0/mlflow/experiments/create'),
 ('POST','/api/2.0/mlflow/runs/create'),
 ('POST','/api/2.0/mlflow/runs/log-batch'),
 ('POST','/api/2.0/mlflow/runs/update'),
 ('GET','/api/2.0/mlflow/runs/get'),
})

def mk_experiment_path(username):
    from databricks_import import validate_username
    user = validate_username(username)
    return f'/Users/{user}/MUSITU_AXIOM_PRIVATE_PILOT_20261027/MLflow_Numeric_Verification'

def compute_verdict_metrics(cases, evaluate):
    if not isinstance(cases, list) or len(cases) != 4 or {row.get('case_id') for row in cases} != CASE_IDS:
        raise ValueError('Expected exactly the four immutable synthetic case IDs')
    if not all(type(row.get('should_pass')) is bool for row in cases):
        raise ValueError('Expected bool for every case verdict')
    results = []
    for case in sorted(cases, key=lambda x:x['case_id']):
        verdict = evaluate(case)
        if not isinstance(verdict, dict) or type(verdict.get('passed')) is not bool:
            raise RuntimeError('Invalid numeric verifier verdict')
        verdict_passed = verdict['passed']
        correct = verdict_passed is case['should_pass']
        results.append({'case_id':case['case_id'],'expected_pass':case['should_pass'],
                        'actual_pass':verdict_passed,'correct':correct})
    if not all(item['correct'] for item in results):
        raise RuntimeError('Unexpected benchmark classification: refusing MLflow write')
    payload=json.dumps(results,sort_keys=True,separators=(',',':')).encode('utf-8')
    return {'total_cases':4,'correct_classifications':4,'wrong_result_detected':2,
            'correct_result_accepted':2,'classification_rate':1.0,
            'sha256':hashlib.sha256(payload).hexdigest()}

def run_one_time_mlflow_tracking(api, cases, evaluate):
    verdict=compute_verdict_metrics(cases,evaluate)
    identity=api('GET','/api/2.0/preview/scim/v2/Me')
    if not isinstance(identity,dict): raise RuntimeError('Workspace identity not available')
    name=mk_experiment_path(identity.get('userName'))
    existing=api('GET','/api/2.0/mlflow/experiments/get-by-name',params={'experiment_name':name})
    if existing is not None:
        raise RuntimeError('MLflow pilot experiment already exists; no duplicate writes permitted')
    created=api('POST','/api/2.0/mlflow/experiments/create',payload={
        'name':name,'tags':[{'key':'musitu.scope','value':'synthetic-github-runner-only'},
                            {'key':'musitu.production_release','value':'false'}]})
    experiment_id=created.get('experiment_id') if isinstance(created,dict) else None
    if not isinstance(experiment_id,str) or not experiment_id.isdigit():
        raise RuntimeError('MLflow experiment creation lacked valid ID')
    opened=api('POST','/api/2.0/mlflow/runs/create',payload={
        'experiment_id':experiment_id,'start_time':int(time.time()*1000),
        'tags':[{'key':'mlflow.runName','value':'MUSITU_Axiom_4_case_verification_GitHub'},
                {'key':'musitu.mode','value':'no_databricks_compute'}]})
    runinfo=opened.get('run',{}).get('info',{}) if isinstance(opened,dict) else {}
    run_id=runinfo.get('run_id')
    if not isinstance(run_id,str) or not re.fullmatch('[A-Za-z0-9_-]{6,80}',run_id):
        raise RuntimeError('MLflow run creation lacked valid ID')
    metrics={key:float(verdict[key]) for key in ('classification_rate','total_cases',
                   'correct_classifications','wrong_result_detected','correct_result_accepted')}
    now=int(time.time()*1000)
    api('POST','/api/2.0/mlflow/runs/log-batch',payload={
        'run_id':run_id,
        'metrics':[{'key':key,'value':val,'timestamp':now,'step':0} for key,val in metrics.items()],
        'params':[{'key':'synthetic_case_sha256','value':verdict['sha256']},
                  {'key':'execution_environment','value':'github_actions_runner'},
                  {'key':'databricks_compute_started','value':'false'}],
        'tags':[{'key':'musitu.source_verified','value':'true'},
                {'key':'musitu.axiom_production_connection','value':'false'}]})
    api('POST','/api/2.0/mlflow/runs/update',payload={
        'run_id':run_id,'status':'FINISHED','end_time':int(time.time()*1000)})
    stored=api('GET','/api/2.0/mlflow/runs/get',params={'run_id':run_id})
    stored_run=stored.get('run',{}) if isinstance(stored,dict) else {}
    state=stored_run.get('info',{})
    actual_metrics={metric.get('key'):metric.get('value')
                    for metric in stored_run.get('data',{}).get('metrics',[])}
    if state.get('run_id')!=run_id or state.get('status')!='FINISHED':
        raise RuntimeError('MLflow run readback did not confirm completed record')
    for key,expected in metrics.items():
        if actual_metrics.get(key)!=expected:
            raise RuntimeError('MLflow metric readback mismatch')
    return {'status':'MLFLOW_TRACKING_VERIFIED','experiment_id':experiment_id,
            'run_id':run_id,'case_sha256':verdict['sha256'],'metrics':metrics}

def make_api(token):
    if not isinstance(token,str) or not token or '\n' in token or '\r' in token:
        raise ValueError('Invalid or missing Databricks workspace PAT')
    def request(method,path,payload=None,params=None):
        if (method,path) not in ENDPOINTS or (method=='GET' and payload is not None) or (method=='POST' and params is not None):
            raise RuntimeError('Operation is not whitelisted')
        uri=HOST+path+('?' + urlencode(params) if params else '')
        data=json.dumps(payload,separators=(',',':')).encode() if payload is not None else None
        req=Request(uri,method=method,data=data,headers={
            'Authorization':'Bearer '+token, 'Content-Type':'application/json',
            'Accept':'application/json'})
        try:
            with urlopen(req,timeout=25) as response:
                if response.status not in (200,201):
                    raise RuntimeError(f'Databricks MLflow HTTP {response.status}')
                blob=response.read(400000)
                return json.loads(blob) if blob else {}
        except HTTPError as exc:
            if method=='GET' and path=='/api/2.0/mlflow/experiments/get-by-name' and exc.code==404:
                return None
            raise RuntimeError(f'Databricks MLflow endpoint HTTP {exc.code}') from None
        except URLError:
            raise RuntimeError('Databricks MLflow connection unavailable') from None
    return request

def main():
    source=Path(__file__).resolve().parent/'notebooks'/'01_musitu_axiom_selfcontained.py'
    with contextlib.redirect_stdout(io.StringIO()):
        notebook=runpy.run_path(str(source))
    result=run_one_time_mlflow_tracking(make_api(os.environ['DATABRICKS_TOKEN']),
        notebook['CASES'],lambda case:notebook['evaluate_example'](case))
    print('MUSITU_DATABRICKS_MLFLOW_REMOTE_TRACKING_VERIFIED')
    print('MLFLOW_EXPERIMENT_ID='+result['experiment_id'])
    print('MLFLOW_RUN_ID='+result['run_id'])
    print('SYNTHETIC_CASE_SHA256='+result['case_sha256'])
    print('DATABRICKS_COMPUTE_NOT_STARTED')
    return 0

if __name__=='__main__':
    try: sys.exit(main())
    except (OSError,ValueError,RuntimeError,KeyError) as exc:
        print('MUSITU_DATABRICKS_MLFLOW_TRACKING_FAILED: '+str(exc),file=sys.stderr)
        sys.exit(1)

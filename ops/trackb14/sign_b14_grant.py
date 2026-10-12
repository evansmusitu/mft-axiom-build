#!/usr/bin/env python3
"""CI job isolated from the execution worker. Signs a short-lived, read-only-preflighted S2 experiment mandate.
This is an experiment-level authority split, NOT the production independent Security Gateway.
"""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time

# Import the already-tested provider read-only adapter. No model invocation allowed.
from b13_account_usage_probe import ACCOUNT, json_request, validate_subscription_data, validate_graphql_usage, ReadDenied
from b14_live_agents import MODEL


def fresh_native_evidence(token):
    now=dt.datetime.now(dt.timezone.utc)
    identity=json_request(token,'/accounts/'+ACCOUNT)
    subs=json_request(token,'/accounts/'+ACCOUNT+'/subscriptions')
    native=validate_subscription_data(identity,subs)
    if native['paid_worker_plan_seen']:raise ReadDenied('WORKERS_PAID_FORBIDDEN')
    query=('query { viewer { accounts(filter: {accountTag: "'+ACCOUNT+'"}) { '
            'aiInferenceAdaptiveGroups(limit: 1, filter: {datetime_geq: "'+now.strftime('%Y-%m-%d')+'T00:00:00Z"}) '
            '{ count sum { totalNeurons } } } } }')
    usage=validate_graphql_usage(json_request(token,'/graphql',payload={'query':query}))
    # Adaptive analytics is not definitive; remain well below Free hard stop.
    if usage['observed_neurons']>=6500:
        raise ReadDenied('B14_ADVISORY_USAGE_TOO_HIGH')
    return now,usage,native


def compose_grant(now,usage):
    stamp=int(now.timestamp())
    return {'schema':'axiom.trackb14.single-run.s2.v1',
      'account_id':ACCOUNT,'model':MODEL,'utc_day':now.strftime('%Y-%m-%d'),
      'expires_at':stamp+900,'issued_at':stamp,'max_calls_per_worker':8,
      'max_total_calls':16,'max_output_tokens':384,
      'no_production':True,'no_paid_plan_evidence':True,
      'workers_free_user_confirmed':True,
      'native_remaining_neurons_certified':False,
      'model_inference_reservation':'ONE_CI_RUN_ONLY',
      'workloads':['agent-a','agent-b'],
      'observed_neurons_at_issue':usage['observed_neurons']}


def signer_main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:raise ReadDenied('MISSING_PROVIDER_SCOPED_TOKEN')
    now,usage,native=fresh_native_evidence(token)
    print('B14_NATIVE_ACCOUNT_IDENTITY_READ_PASS',flush=True)
    print('B14_NATIVE_WORKERS_PAID_NOT_OBSERVED',flush=True)
    print('B14_NATIVE_AI_ANALYTICS_NEURONS_ADVISORY='+str(usage['observed_neurons']),flush=True)
    print('B14_NATIVE_AI_ANALYTICS_NOT_EXACT_REMAINING',flush=True)
    grant=compose_grant(now,usage)
    out=Path('/tmp/axiom-b14-signed-origin')
    out.mkdir(mode=0o700,exist_ok=False)
    (out/'grant.json').write_text(json.dumps(grant,sort_keys=True,separators=(',',':')))
    private=out/'private.pem'
    subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(private)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['openssl','pkey','-in',str(private),'-pubout','-out',str(out/'public.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['openssl','pkeyutl','-sign','-inkey',str(private),'-rawin',
         '-in',str(out/'grant.json'),'-out',str(out/'sig.bin')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    private.unlink()
    if private.exists():raise ReadDenied('PRIVATE_SIGNER_KEY_RETENTION')
    # Only unsigned public key + signed short-lived scope leaves signer job.
    path=Path(os.environ['GITHUB_OUTPUT'])
    import base64
    with path.open('a') as f:
        for name,key in [('grant.json','grant'),('sig.bin','signature'),('public.pem','public_key')]:
            f.write(key+'='+base64.b64encode((out/name).read_bytes()).decode()+'\n')
    print('B14_EPHEMERAL_ED25519_GRANT_SIGNED_WITH_PRIVATE_KEY_REMOVED',flush=True)
    print('B14_NO_MODEL_INFERENCE_IN_SIGNER_JOB',flush=True)

if __name__=='__main__':
    try:signer_main()
    except (ReadDenied,subprocess.SubprocessError,ValueError,KeyError) as e:
        print('B14_SIGNER_FAIL_CLOSED='+str(e),flush=True)
        sys.exit(72)
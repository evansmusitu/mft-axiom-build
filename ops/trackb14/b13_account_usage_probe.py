#!/usr/bin/env python3
"""Read-only, bounded Cloudflare account entitlement and AI usage advisory. NEVER infers allowance from missing data.
No model inference, no Worker/D1 writes, no long-lived token output.
"""
import datetime as dt
import json
import math
import os
import sys
import urllib.error
import urllib.request

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
BASE = 'https://api.cloudflare.com/client/v4'
MODEL = '@cf/zai-org/glm-4.7-flash'

class ReadDenied(Exception): pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ReadDenied('REDIRECT_DENIED')


def json_request(token, path, *, payload=None, limit=262144):
    if path not in ('/accounts/'+ACCOUNT,'/accounts/'+ACCOUNT+'/subscriptions','/graphql'):
        raise ReadDenied('UNAPPROVED_READ_PATH')
    if path == '/graphql' and payload is None: raise ReadDenied('GRAPHQL_MUST_BE_POST')
    if path != '/graphql' and payload is not None:raise ReadDenied('ACCOUNT_READ_MUST_BE_GET')
    req=urllib.request.Request(BASE+path,method='POST' if payload is not None else 'GET',
      data=json.dumps(payload,separators=(',',':')).encode() if payload is not None else None,
      headers={'Authorization':'Bearer '+token,'Accept':'application/json','Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=14) as resp:
            body=resp.read(limit+1)
            if resp.status!=200 or len(body)>limit:raise ReadDenied('HTTP_STATUS_OR_RESPONSE_SIZE_DENIED')
    except urllib.error.HTTPError as exc:
        raise ReadDenied('PROVIDER_HTTP_'+str(exc.code)) from None
    except (OSError,ValueError,TimeoutError):
        raise ReadDenied('PROVIDER_READ_UNAVAILABLE') from None
    try: return json.loads(body)
    except (ValueError,UnicodeDecodeError):raise ReadDenied('PROVIDER_INVALID_JSON') from None


def validate_subscription_data(account, sub):
    if not isinstance(account,dict) or account.get('success') is not True or not isinstance(account.get('result'),dict) or account['result'].get('id')!=ACCOUNT:
        raise ReadDenied('ACCOUNT_ID_NOT_ATTESTED')
    if not isinstance(sub,dict) or sub.get('success') is not True or not isinstance(sub.get('result'),list):
        raise ReadDenied('SUBSCRIPTION_RESPONSE_UNTRUSTWORTHY')
    info=sub.get('result_info')
    if isinstance(info,dict):
        # Paginated/partial subscription list cannot certify absence of paid products.
        count=info.get('total_count')
        if count is not None and (type(count) is not int or count!=len(sub['result'])):
            raise ReadDenied('SUBSCRIPTION_PARTIAL_PAGE')
    for item in sub['result']:
        if not isinstance(item,dict) or not isinstance(item.get('rate_plan'),(dict,type(None))):
            raise ReadDenied('SUBSCRIPTION_ROW_INVALID')
        plan=str((item.get('rate_plan') or {}).get('id') or '').lower()
        # Other Cloudflare products may be paid while Workers remains Free.
        if plan.startswith(('workers_paid','partners_workers')) or 'workers_paid' in plan or 'workers-paid' in plan:
            raise ReadDenied('WORKERS_PAID_PLAN_PRESENT_FAIL_CLOSED')
    return {'account_identity_read': True, 'subscription_count':len(sub['result']),
            'paid_worker_plan_seen':False, 'free_plan_certified':False}


def validate_graphql_usage(reply):
    if not isinstance(reply,dict):raise ReadDenied('GRAPHQL_NOT_OBJECT')
    if reply.get('errors'):raise ReadDenied('GRAPHQL_DENIED_OR_ERRORS')
    items=(((reply.get('data') or {}).get('viewer') or {}).get('accounts') or [])
    if type(items) is not list or len(items)!=1:raise ReadDenied('GRAPHQL_ACCOUNT_NOT_UNIQUE')
    rows=items[0].get('aiInferenceAdaptiveGroups')
    if type(rows) is not list or len(rows)>1:raise ReadDenied('GRAPHQL_USAGE_SHAPE_INVALID')
    if not rows:
        # Zero rows is not proof of zero use; sampling/analytics latency can hide data.
        raise ReadDenied('GRAPHQL_USAGE_EMPTY_NOT_ZERO')
    raw=(rows[0].get('sum') or {}).get('totalNeurons')
    if type(raw) not in (int,float) or not math.isfinite(raw) or raw<0:
        raise ReadDenied('GRAPHQL_USAGE_NOT_NUMERIC')
    count=rows[0].get('count')
    if type(count) is not int or count<1:raise ReadDenied('GRAPHQL_COUNT_NOT_VALID')
    return {'observed_neurons':round(float(raw),4),'observed_inferences':count,
            'metric':'ADVISORY_ONLY_SAMPLED_POSSIBLY_LAGGING',
            'actual_remaining_free_allocation':'NOT_CERTIFIED'}


def run(token):
    today=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    start=today+'T00:00:00Z'
    acct=json_request(token,'/accounts/'+ACCOUNT)
    subs=json_request(token,'/accounts/'+ACCOUNT+'/subscriptions')
    attested=validate_subscription_data(acct,subs)
    print('B13_ACCOUNT_SUBSCRIPTIONS_FREE_COMPATIBLE='+json.dumps(attested,sort_keys=True),flush=True)
    # GraphQL is read-only; inability to access the analytics dataset is a hard stop for this qualification.
    query=('query { viewer { accounts(filter: {accountTag: "'+ACCOUNT+'"}) { '
            'aiInferenceAdaptiveGroups(limit: 1, filter: {datetime_geq: "'+start+'"}) '
            '{ count sum { totalNeurons } } } } }')
    usage=validate_graphql_usage(json_request(token,'/graphql',payload={'query':query}))
    print('B13_USAGE_READ_ONLY_ADVISORY='+json.dumps({'utc_date':today,**usage},sort_keys=True),flush=True)
    print('B13_EXACT_REMAINING_NEURONS_NOT_PROVEN',flush=True)
    print('B13_NO_MODEL_CALLS_NO_PRODUCTION_WRITES',flush=True)

if __name__=='__main__':
    t=os.environ.get('CLOUDFLARE_API_TOKEN')
    if not t:raise SystemExit('B13_CLOUDFLARE_SCOPED_TOKEN_UNAVAILABLE')
    try:run(t)
    except ReadDenied as e:
        print('B13_ACCOUNT_OR_USAGE_PROOF_BLOCKED='+str(e),flush=True)
        sys.exit(72)
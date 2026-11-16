#!/usr/bin/env python3
"""Sole-owner AXIOM Step1: bounded read-only account D1 usage diagnostics.

Cloudflare GraphQL is query-only (POST transport, not a provider mutation).
The program never executes SQL, writes D1, creates resources or exposes the
query samples, database IDs, token or account billing numbers. It does NOT
certify the user's strict zero-incremental-spend rule: raw billing ledger and
hard spend enforcement are still missing. All results enforce NOT_RELEASE.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import urllib.error
import urllib.request

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'
START='2026-11-01'
END='2026-11-12'
OUTPUT='axiom_step1_owner_d1_billing_analytics_20261112.json'
SCHEMA='musitu.axiom.step1.owner-account-billing-analytics-readonly.v1'
# Single reviewed GraphQL operation. No introspection, no dynamic query string.
# Retains only numeric summary occupancy bands (never raw per-DB metrics).
QUERY='''query AXIOMStep1D1MonthReadOnly($accountTag: string!, $start: Date!, $end: Date!) {
 viewer {
  accounts(filter: {accountTag: $accountTag}) {
   rows: d1AnalyticsAdaptiveGroups(filter: {date_geq: $start, date_leq: $end}, limit: 10000, orderBy: [date_DESC]) {
    dimensions { date databaseId }
    sum { rowsRead rowsWritten }
   }
   storage: d1StorageAdaptiveGroups(filter: {date_geq: $start, date_leq: $end}, limit: 10000, orderBy: [date_DESC]) {
    dimensions { date databaseId }
    max { databaseSizeBytes }
   }
  }
 }
}'''
# Published Cloudflare Workers Paid tier as at 2026-11-12. These are diagnostic
# thresholds, not guaranteed free spend. Storage is conservatively decimal GB.
LIMIT_ROWS_READ=25_000_000_000
LIMIT_ROWS_WRITTEN=50_000_000
LIMIT_STORAGE_BYTES=5_000_000_000
class NoGo(Exception): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def _metric(x,label):
 if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or x<0 or int(x)!=x or x>10**18:
  raise NoGo('INVALID_'+label)
 return int(x)

def _groups(arr,label):
 if not isinstance(arr,list) or len(arr)>=10000:
  raise NoGo('MISSING_OR_TRUNCATED_'+label)
 seen=set();rows=[]
 for event in arr:
  if not isinstance(event,dict) or not isinstance(event.get('dimensions'),dict):raise NoGo('INVALID_'+label+'_GROUP')
  d=event['dimensions'];date=d.get('date');key=d.get('databaseId')
  if not isinstance(key,str) or not (1<=len(key)<=80) or not isinstance(date,str) or not START<=date<=END:
   raise NoGo('OUT_OF_WINDOW_'+label)
  signature=(date,key)
  if signature in seen:raise NoGo('DUPLICATE_'+label+'_GROUP')
  seen.add(signature);rows.append(event)
 return rows

def _band(x,threshold):
 pct=x/threshold
 if pct<.50:return 'LT50'
 if pct<.75:return '50_TO_75'
 if pct<.90:return '75_TO_90'
 if pct<1:return '90_TO_100'
 return 'AT_OR_OVER_LIMIT'

def analyse(payload):
 if not isinstance(payload,dict) or payload.get('errors') or payload.get('data') is None:
  raise NoGo('GRAPHQL_RESPONSE_NOT_SUCCESS')
 v=payload['data'].get('viewer') if isinstance(payload['data'],dict) else None
 accounts=v.get('accounts') if isinstance(v,dict) else None
 if not isinstance(accounts,list) or len(accounts)!=1 or not isinstance(accounts[0],dict):
  raise NoGo('ACCOUNT_SCOPE_NOT_UNIQUE')
 acc=accounts[0]
 rows=_groups(acc.get('rows'),'ROWS')
 storage=_groups(acc.get('storage'),'STORAGE')
 if not rows or not storage:raise NoGo('ANALYTICS_INCOMPLETE')
 total_read=total_write=0
 row_keys=set()
 for x in rows:
  metric=x.get('sum')
  if not isinstance(metric,dict):raise NoGo('ROWS_SUM_MISSING')
  total_read+=_metric(metric.get('rowsRead'),'ROWS_READ')
  total_write+=_metric(metric.get('rowsWritten'),'ROWS_WRITTEN')
  row_keys.add(x['dimensions']['databaseId'])
 latest_by_db={}
 for x in storage:
  metric=x.get('max')
  if not isinstance(metric,dict):raise NoGo('STORAGE_MAX_MISSING')
  size=_metric(metric.get('databaseSizeBytes'),'DATABASE_BYTES')
  key=x['dimensions']['databaseId'];date=x['dimensions']['date']
  if key not in latest_by_db or latest_by_db[key][0]<date:
   latest_by_db[key]=(date,size)
 # A database not in the analytics series may exist and consume storage,
 # including any idle database: never certify account-wide usage coverage.
 observed_storage=sum(x[1] for x in latest_by_db.values())
 return {
  'observed_read_rows_band':_band(total_read,LIMIT_ROWS_READ),
  'observed_written_rows_band':_band(total_write,LIMIT_ROWS_WRITTEN),
  'observed_storage_bytes_band':_band(observed_storage,LIMIT_STORAGE_BYTES),
  'observed_rows_series_count':len(rows),
  'observed_storage_series_count':len(storage),
  'distinct_databases_with_row_events':len(row_keys),
  'distinct_databases_with_storage_samples':len(latest_by_db),
  'storage_samples_include_end_date':all(x[0]>=END for x in latest_by_db.values()),
  'all_usage_below_published_included_bands':(
    total_read<LIMIT_ROWS_READ and total_write<LIMIT_ROWS_WRITTEN and observed_storage<LIMIT_STORAGE_BYTES),
 }

def request(token):
 if not isinstance(token,str) or not 8<=len(token)<=4096 or '\r' in token or '\n' in token:
  raise NoGo('ANALYTICS_TOKEN_UNAVAILABLE')
 data=json.dumps({'query':QUERY,'variables':{'accountTag':ACCOUNT,'start':START,'end':END}},separators=(',',':')).encode()
 req=urllib.request.Request(ENDPOINT,method='POST',data=data,headers={'Authorization':'Bearer '+token,'Accept':'application/json','Content-Type':'application/json'})
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=22) as resp:
   if resp.status!=200:raise NoGo('ANALYTICS_HTTP_NON_200')
   raw=resp.read(750_001)
   if len(raw)>750_000:raise NoGo('ANALYTICS_OVERSIZE')
   return json.loads(raw)
 except urllib.error.HTTPError as exc:raise NoGo('ANALYTICS_HTTP_'+str(exc.code)) from None
 except (OSError,TimeoutError,ValueError,UnicodeDecodeError) as exc:raise NoGo('ANALYTICS_UNAVAILABLE') from None

def receipt(data=None,error=None):
 now=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
 out={'schema':SCHEMA,'account':ACCOUNT,'captured_at_utc':now,'billing_window_start':START,'billing_window_end':END,
  'read_only_graphql_query_via_post':True,'graphql_operation':'AXIOMStep1D1MonthReadOnly',
  'no_sql_or_provider_mutations':True,'raw_analytics_retained':False,'database_ids_retained':False,
  'customer_data_read':False,'zero_additional_spend_qualified':False,
  'current_encrypted_backup_qualified':False,'approved_disposable_target':False,
  'step1_closed':False,'step2_authorized':False,'release':'NOT_RELEASE',
  'status':'BILLING_ANALYTICS_UNQUALIFIED_NO_GO'}
 if error:
  out['error_code']=error
  return out
 try:
  out.update(analyse(data));out['status']='OBSERVED_USAGE_BANDS_ONLY_ZERO_SPEND_UNPROVEN_NO_GO'
 except NoGo as exc:out['error_code']=str(exc)
 return out

def main():
 try: r=receipt(request(os.getenv('CLOUDFLARE_API_TOKEN','')))
 except NoGo as exc:r=receipt(error=str(exc))
 body=(json.dumps(r,sort_keys=True,indent=2)+'\n').encode()
 Path(OUTPUT).write_bytes(body)
 Path(OUTPUT+'.sha256').write_text(hashlib.sha256(body).hexdigest()+'  '+OUTPUT+'\n')
 print('AXIOM_STEP1_BILLING_ANALYTICS_'+r['status'])
 # Return zero for an observed, explicitly unqualified inquiry. Failed fetch
 # also yields NO_GO receipt; it is not permission to touch production.
 return 0
if __name__=='__main__':raise SystemExit(main())

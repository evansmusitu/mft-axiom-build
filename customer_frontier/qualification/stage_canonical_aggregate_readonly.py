"""Aggregate-only canonical ownership readiness on one pinned staging D1.

Reads only scalar count results and FK-violation aggregate, never identity IDs,
subject, email, tenant/customer UUID, flow tokens, or customer rows. This
cannot certify that any particular human owns an existing customer account.
"""
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ACCOUNT="93f395f5121954671f92fffa453d6b61"
DATABASE="ccc473f1-fbb5-4b8d-8a24-45f3696ac10f"
BASE="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/d1/database/"+DATABASE+"/query"
QUERIES={
    "totals":("SELECT (SELECT count(*) FROM identities) AS identities,"
              " (SELECT count(*) FROM tenants) AS tenants,"
              " (SELECT count(*) FROM memberships) AS memberships,"
              " (SELECT count(*) FROM canonical_customer_links) AS canonical_links,"
              " (SELECT count(*) FROM customer_idp_flows_v1) AS flows,"
              " (SELECT count(*) FROM customer_idp_sessions_v1) AS sessions"),
    "active":("SELECT (SELECT count(*) FROM identities WHERE status='active') AS active_identities,"
              " (SELECT count(*) FROM tenants WHERE status='active') AS active_tenants,"
              " (SELECT count(*) FROM memberships WHERE status='active') AS active_memberships,"
              " (SELECT count(*) FROM canonical_customer_links WHERE status='active') AS active_canonical_links,"
              " (SELECT count(*) FROM customer_idp_sessions_v1 WHERE status='active' AND expires_at_ms>unixepoch('now')*1000) AS unexpired_active_sessions"),
    "linked":("SELECT count(*) AS active_joined_links FROM canonical_customer_links l"
              " JOIN identities i ON i.id=l.identity_id"
              " JOIN memberships m ON m.identity_id=i.id AND m.tenant_id=l.tenant_id"
              " JOIN tenants t ON t.id=m.tenant_id"
              " WHERE l.status='active' AND m.status='active' AND t.status='active'"),
    "fk":"SELECT count(*) AS foreign_key_violations FROM pragma_foreign_key_check",
}
class Refuse(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None

def check_counts(kind,obj):
 if kind not in QUERIES:raise Refuse("UNALLOWLISTED_COUNT_QUERY")
 if not isinstance(obj,dict) or obj.get("success") is not True:
  raise Refuse("PROVIDER_QUERY_FAILED")
 result=obj.get("result")
 if not isinstance(result,list) or len(result)!=1 or not isinstance(result[0],dict) or result[0].get("success") is not True:
  raise Refuse("D1_QUERY_RESPONSE_INVALID")
 r=result[0];m=r.get("meta")
 if not isinstance(m,dict) or m.get("changed_db") is not False or type(m.get("changes")) is not int or m["changes"]!=0 or type(m.get("rows_written")) is not int or m["rows_written"]!=0:
  raise Refuse("ZERO_WRITE_NOT_VERIFIED")
 records=r.get("results")
 expected={
  "totals":{"identities","tenants","memberships","canonical_links","flows","sessions"},
  "active":{"active_identities","active_tenants","active_memberships","active_canonical_links","unexpired_active_sessions"},
  "linked":{"active_joined_links"},
  "fk":{"foreign_key_violations"},
 }[kind]
 if (not isinstance(records,list) or len(records)!=1 or not isinstance(records[0],dict) or
     set(records[0])!=expected or any(type(v) is not int or v<0 or v>1_000_000_000 for v in records[0].values())):
  raise Refuse("COUNT_RESULT_INVALID")
 return records[0]

def check_consistency(counts):
 total,active,joined,fk=(counts[k] for k in ("totals","active","linked","fk"))
 if (active["active_identities"]>total["identities"] or
     active["active_tenants"]>total["tenants"] or
     active["active_memberships"]>total["memberships"] or
     active["active_canonical_links"]>total["canonical_links"] or
     active["unexpired_active_sessions"]>total["sessions"] or
     joined["active_joined_links"]>active["active_canonical_links"]):
  raise Refuse("INCONSISTENT_AGGREGATE_COUNTS")
 return {"schema":"AXIOM_STAGE_CANONICAL_AGGREGATE_READONLY_V1",
  "status":"AGGREGATES_OBSERVED_NOT_OWNERSHIP",
  "database_uuid":DATABASE,
  "counts":counts,
  "only_approved_sql_query_hashes":{k:hashlib.sha256(v.encode()).hexdigest() for k,v in QUERIES.items()},
  "foreign_key_zero_violations":fk["foreign_key_violations"]==0,
  "individual_customer_uuid_ownership_verified":False,
  "existing_link_provenance_verified":False,
  "independent_identity_custody_qualified":False,
  "physical_owner_mfa_completed":False,
  "reuse_authorized":False,
  "production_oauth_mutated":False,
  "cloudflare_write_count":0,
  "customer_row_values_read":0,
  "release_authority":False}

def run():
 token=os.environ.get("CLOUDFLARE_API_TOKEN","")
 if not token or any(c in token for c in "\r\n"):
  raise Refuse("SCOPED_CLOUDFLARE_TOKEN_MISSING")
 opener=urllib.request.build_opener(NoRedirect())
 attempts=0
 try:
  counts={}
  for kind,sql in QUERIES.items():
   body=json.dumps({"sql":sql,"params":[]},separators=(",",":")).encode()
   req=urllib.request.Request(BASE,method="POST",data=body,
      headers={"Authorization":"Bearer "+token,"content-type":"application/json","Accept":"application/json"})
   attempts+=1
   try:
    with opener.open(req,timeout=18) as r:
     status=r.status;raw=r.read(24001)
   except urllib.error.HTTPError as e:raise Refuse("PROVIDER_HTTP_"+str(e.code)) from None
   except (OSError,TimeoutError):raise Refuse("PROVIDER_NETWORK_UNAVAILABLE") from None
   if status!=200 or len(raw)>24000:raise Refuse("PROVIDER_RESPONSE_TOO_LARGE")
   try:payload=json.loads(raw.decode("utf8"))
   except (UnicodeError,ValueError):raise Refuse("PROVIDER_RESPONSE_INVALID") from None
   counts[kind]=check_counts(kind,payload)
  out=check_consistency(counts);exit_code=0
 except (Refuse,ValueError) as e:
  out={"schema":"AXIOM_STAGE_CANONICAL_AGGREGATE_READONLY_V1",
     "status":"INCOMPLETE_NO_GO","reason_code":str(e)[:90],
     "database_uuid":DATABASE,
     "individual_customer_uuid_ownership_verified":False,
     "reuse_authorized":False,
     "release_authority":False};exit_code=2
 out["read_only_post_select_attempts"]=attempts
 out["cloudflare_write_count"]=0
 out["customer_row_values_read"]=0
 data=(json.dumps(out,sort_keys=True,indent=2)+"\n").encode()
 p=Path("axiom-stage-canonical-aggregate-readonly.json");p.write_bytes(data)
 p.with_name(p.name+".sha256").write_text(hashlib.sha256(data).hexdigest()+"  "+p.name+"\n")
 print("AXIOM_CANONICAL_OWNER_AGGREGATE="+out["status"]+" WRITES=0")
 return exit_code
if __name__=="__main__":raise SystemExit(run())

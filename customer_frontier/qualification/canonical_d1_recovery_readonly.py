"""AXIOM staging identity: existing canonical D1 schema and recovery bookmark READ-ONLY.

Only exact primary Cloudflare account D1 SQL schema *names* (never user rows),
one current Time Travel bookmark GET, and public Worker script identifiers.
No OAuth, private key, D1 edits, Worker bindings, billing, or credentials printed.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ACCOUNT="93f395f5121954671f92fffa453d6b61"
SESSION_D1="ccc473f1-fbb5-4b8d-8a24-45f3696ac10f"
STAGING_WORKER="musitu-axiom-customer-staging"
ROOT="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT
SQL="SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('canonical_customer_links','identities','memberships','tenants','customers') ORDER BY name"
TABLE_NAMES=frozenset(("canonical_customer_links","identities","memberships","tenants","customers"))
CANONICAL_CORE=frozenset(("canonical_customer_links","identities","memberships","tenants"))
UUID=re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
WORKER=re.compile(r"[A-Za-z0-9_-]{1,128}\Z",re.ASCII)
class Unqualified(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None
def sha(x):return hashlib.sha256((x if isinstance(x,bytes) else x.encode())).hexdigest()
def result_envelope(o):
    if not isinstance(o,dict) or o.get("success") is not True:
        raise Unqualified("CLOUDFLARE_RESPONSE_NOT_SUCCESS")
    return o
def inspect_inventory(obj):
    obj=result_envelope(obj)
    entries=obj.get("result");info=obj.get("result_info")
    if not isinstance(entries,list) or len(entries)!=11 or not isinstance(info,dict):
        raise Unqualified("D1_INVENTORY_NOT_PINNED")
    if any(type(info.get(k)) is not int for k in ("page","count","total_count")) or info["page"]!=1 or info["count"]!=11 or info["total_count"]!=11:
        raise Unqualified("D1_INVENTORY_PAGINATION_NOT_PINNED")
    if any(not isinstance(x,dict) or not isinstance(x.get("name"),str) or not UUID.fullmatch(str(x.get("uuid",""))) for x in entries):
        raise Unqualified("D1_INVENTORY_ID_INVALID")
    ids=[x["uuid"] for x in entries]
    if len(set(ids))!=11 or SESSION_D1 not in ids:raise Unqualified("D1_RESOURCE_NOT_UNIQUE_OR_MISSING")
    return entries
def inspect_schema_result(obj):
    rs=result_envelope(obj).get("result")
    if not isinstance(rs,list) or len(rs)!=1 or not isinstance(rs[0],dict) or rs[0].get("success") is not True:
        raise Unqualified("D1_READ_RESPONSE_UNQUALIFIED")
    rowset=rs[0]
    meta=rowset.get("meta")
    if not isinstance(meta,dict) or meta.get("changed_db") is not False or type(meta.get("changes")) is not int or meta["changes"]!=0 or type(meta.get("rows_written")) is not int or meta["rows_written"]!=0:
        raise Unqualified("D1_ZERO_WRITE_NOT_PROVEN")
    rows=rowset.get("results")
    if not isinstance(rows,list) or len(rows)>len(TABLE_NAMES) or any(not isinstance(r,dict) or set(r)!={"name"} or r["name"] not in TABLE_NAMES for r in rows):
        raise Unqualified("D1_SCHEMA_RESPONSE_INVALID")
    names=[r["name"] for r in rows]
    if len(set(names))!=len(names):raise Unqualified("D1_SCHEMA_DUPLICATE")
    return frozenset(names)
def classify(inventory,rows,workers):
    if not isinstance(inventory,list) or not isinstance(rows,dict) or len(rows)!=len(inventory) or not isinstance(workers,list):
        raise Unqualified("TOPOLOGY_EVIDENCE_INCOMPLETE")
    if not all(isinstance(w,dict) and isinstance(w.get("id"),str) and WORKER.fullmatch(w["id"]) for w in workers):
        raise Unqualified("WORKER_CATALOG_INVALID")
    names=[w["id"] for w in workers]
    if STAGING_WORKER not in names or len(set(names))!=len(names):raise Unqualified("STAGING_WORKER_NOT_UNIQUE")
    candidates=[]
    session_has_canonical=False
    for entry in inventory:
        db=entry["uuid"];table_set=rows.get(db)
        if not isinstance(table_set,frozenset) or not table_set.issubset(TABLE_NAMES):
            raise Unqualified("D1_SCHEMA_UNQUALIFIED")
        if db==SESSION_D1:session_has_canonical=CANONICAL_CORE.issubset(table_set)
        if CANONICAL_CORE.issubset(table_set):
            candidates.append({"database_uuid":db,"required_table_names_present":True,
               "customers_table_name_present":"customers" in table_set,
               "canonical_ownership_verified":False,"reusable":False})
    private_candidates=sorted(n for n in names if n!=STAGING_WORKER and
        any(key in n.lower() for key in ("idp","zitadel","identity")))
    return {"schema":"AXIOM_STAGING_IDP_CANONICAL_AND_RECOVERY_READONLY_V1",
      "status":"CANONICAL_SCHEMA_INVENTORIED_NO_ADOPTION",
      "primary_d1_checked":len(inventory),
      "session_database_uuid":SESSION_D1,
      "session_database_has_canonical_table_names":session_has_canonical,
      "canonical_schema_name_candidate_count":len(candidates),
      "canonical_schema_name_candidates":candidates,
      "private_identity_named_worker_candidates":private_candidates,
      "all_worker_inventory_complete_proven":False,
      "canonical_identity_rows_read":0,
      "customer_uuid_ownership_verified":False,
      "historical_session_database_reuse_authorized":False,
      "provider_bookmark_retrieved":False,
      "restore_tested":False,"production_oauth_changed":False,
      "release_authority":False}
def request(path,token,*,sql=None):
    # Allow only the exact D1 list, an ID validated by the pinned inventory,
    # public worker identifier list and this one existing DB bookmark endpoint.
    allow_get=("/d1/database?per_page=100&page=1","/workers/scripts",
                "/d1/database/"+SESSION_D1+"/time_travel/bookmark")
    if sql is None:
        if path not in allow_get:raise Unqualified("GET_RESOURCE_NOT_ALLOWED")
        method="GET";body=None
    else:
        if sql!=SQL or not re.fullmatch(r"/d1/database/[0-9a-f-]{36}/query",path):
            raise Unqualified("SQL_RESOURCE_NOT_ALLOWED")
        method="POST";body=json.dumps({"sql":SQL,"params":[]},separators=(",",":")).encode()
    head={"Authorization":"Bearer "+token,"Accept":"application/json"}
    if body is not None:head["Content-Type"]="application/json"
    req=urllib.request.Request(ROOT+path,headers=head,method=method,data=body)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=17) as response:
            status=response.status;raw=response.read(100001)
    except urllib.error.HTTPError as e:raise Unqualified("CLOUDFLARE_HTTP_"+str(e.code)) from None
    except (OSError,TimeoutError):raise Unqualified("CLOUDFLARE_NETWORK_UNAVAILABLE") from None
    if status!=200 or len(raw)>100000:raise Unqualified("CLOUDFLARE_RESULT_SIZE_OR_STATUS")
    try:return json.loads(raw.decode("utf-8"))
    except (UnicodeError,ValueError):raise Unqualified("CLOUDFLARE_JSON_INVALID") from None

def run():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if not token or "\r" in token or "\n" in token:raise Unqualified("SCOPED_CLOUDFLARE_TOKEN_MISSING")
    requests=0;sql_reads=0
    try:
        inv=inspect_inventory(request("/d1/database?per_page=100&page=1",token));requests+=1
        rows={}
        for item in inv:
            db=item["uuid"]
            # Ids only from an independently validated, complete 11-DB catalog.
            rows[db]=inspect_schema_result(request("/d1/database/"+db+"/query",token,sql=SQL))
            requests+=1;sql_reads+=1
        wo=result_envelope(request("/workers/scripts",token)).get("result");requests+=1
        summary=classify(inv,rows,wo)
        try:
            b=result_envelope(request("/d1/database/"+SESSION_D1+"/time_travel/bookmark",token)).get("result")
            requests+=1
            if not isinstance(b,dict) or not isinstance(b.get("bookmark"),str) or not re.fullmatch(r"[0-9a-f-]{16,128}",b["bookmark"]):
                raise Unqualified("D1_BOOKMARK_FORMAT_INVALID")
            summary["provider_bookmark_retrieved"]=True
            summary["provider_bookmark_sha256"]=sha(b["bookmark"])
        except Unqualified as e:
            summary["provider_bookmark_read_status"]=str(e)
        summary.update({"provider_methods":["GET","POST_SELECT_ONLY"],
           "provider_requests":requests,"d1_schema_name_queries":sql_reads,
           "cloudflare_writes":0,"customer_rows_read":0,"worker_bindings_changed":False})
        result=summary;exit_code=0
    except (Unqualified,ValueError) as error:
        result={"schema":"AXIOM_STAGING_IDP_CANONICAL_AND_RECOVERY_READONLY_V1",
            "status":"INCOMPLETE_NO_GO","reason_code":str(error)[:90],
            "provider_requests_attempted":requests,"d1_schema_name_queries":sql_reads,
            "cloudflare_writes":0,"customer_rows_read":0,
            "historical_session_database_reuse_authorized":False,
            "release_authority":False}
        exit_code=2
    raw=(json.dumps(result,indent=2,sort_keys=True)+"\n").encode()
    p=Path("axiom-canonical-d1-recovery-readonly.json");p.write_bytes(raw)
    p.with_name(p.name+".sha256").write_text(sha(raw)+"  "+p.name+"\n")
    print("AXIOM_CANONICAL_STAGE_AUDIT="+result["status"]+" WRITES=0")
    return exit_code
if __name__=="__main__":raise SystemExit(run())

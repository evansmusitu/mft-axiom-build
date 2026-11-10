"""Bounded Cloudflare staging identity topology readback; NO MUTATIONS or user rows.

Fetches only the exact primary-account Worker names/settings and pinned historical
D1 metadata. Never writes SQL, creates service bindings, stores secrets, or
authorizes reuse based on names alone. Treat unknown/incomplete data as NO-GO.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
SOURCE_DB = "ccc473f1-fbb5-4b8d-8a24-45f3696ac10f"
SOURCE_NAME_SHA = "7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36"
STAGING_WORKER = "musitu-axiom-customer-staging"
ROOT = "https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT
WORKER = re.compile(r"[A-Za-z0-9_-]{1,128}\Z", re.ASCII)
DATABASE = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")

class Reject(Exception): pass

class NeverRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

def assess_topology(workers, settings, *, database_id=SOURCE_DB):
    """Classify one observed inventory, never convert it into deployment approval."""
    if (not isinstance(workers, list) or not 1 <= len(workers) <= 40 or
            not all(isinstance(row,dict) and isinstance(row.get("id"),str) and
                    WORKER.fullmatch(row["id"]) for row in workers)):
        raise ValueError("WORKER_INVENTORY_INVALID")
    names = [row["id"] for row in workers]
    if len(set(names)) != len(names) or STAGING_WORKER not in names:
        raise ValueError("WORKER_INVENTORY_DUPLICATED_OR_STAGE_ABSENT")
    if not isinstance(settings, dict) or set(settings) != set(names):
        raise ValueError("WORKER_SETTINGS_INCOMPLETE")
    if not isinstance(database_id,str) or not DATABASE.fullmatch(database_id):
        raise ValueError("PINNED_D1_INVALID")
    d1_consumers = []
    named = []
    browser_target = None
    other_d1_names = []
    for worker in names:
        config = settings[worker]
        if not isinstance(config,dict) or not isinstance(config.get("bindings"),list):
            raise ValueError("WORKER_SETTINGS_INVALID")
        bindings = config["bindings"]
        if len(bindings)>128:raise ValueError("WORKER_BINDINGS_OVERSIZE")
        d1_names = []
        service_names = []
        for binding in bindings:
            if not isinstance(binding,dict) or not isinstance(binding.get("type"),str):
                raise ValueError("WORKER_BINDING_INVALID")
            btype = binding["type"].lower()
            if btype not in ("d1","service"):
                continue
            name = binding.get("name")
            if not isinstance(name,str) or not WORKER.fullmatch(name):
                raise ValueError("WORKER_BINDING_NAME_INVALID")
            if btype=="d1":
                dbid = binding.get("id",binding.get("database_id"))
                if not isinstance(dbid,str) or not DATABASE.fullmatch(dbid):
                    raise ValueError("WORKER_D1_DATABASE_ID_INVALID")
                d1_names.append(name)
                if dbid==database_id:
                    d1_consumers.append(worker)
                    if name=="IDP_SESSION_DB":named.append(worker)
                elif worker==STAGING_WORKER:
                    other_d1_names.append(name)
            else:
                service_names.append(name)
                target = binding.get("service")
                if not isinstance(target,str) or not WORKER.fullmatch(target):
                    raise ValueError("WORKER_SERVICE_TARGET_INVALID")
                if worker==STAGING_WORKER and name=="CUSTOMER_IDP_BROWSER":
                    if target not in names:raise ValueError("PRIVATE_SERVICE_NOT_IN_CATALOG")
                    if browser_target is not None:raise ValueError("AMBIGUOUS_PRIVATE_BROWSER_SERVICE")
                    browser_target=target
        if len(d1_names)!=len(set(d1_names)) or len(service_names)!=len(set(service_names)):
            raise ValueError("DUPLICATE_WORKER_BINDING_NAME")
    consumers=sorted(set(d1_consumers))
    designated=sorted(set(named))
    private_like=[w for w in designated if any(a in w.lower() for a in ("idp","identity","zitadel"))]
    observed_exclusive=(len(consumers)==1 and consumers==private_like and
                         len(designated)==1 and browser_target==consumers[0])
    return {
        "status":"IDP_TOPOLOGY_NO_GO",
        "workers_observed":len(names),
        "staging_worker_present":True,
        "stage_private_browser_binding_present":browser_target is not None,
        "observed_browser_worker_name":browser_target,
        "idp_session_db_consumers":consumers,
        "idp_named_db_consumers":designated,
        "historical_db_exclusive_to_private_identity":observed_exclusive,
        "staging_worker_has_other_d1_binding":bool(other_d1_names),
        "historical_database_reuse_provenance":False,
        "historical_database_backup_restore_qualified":False,
        "owner_mfa_qualified":False,
        "canonical_ownership_qualified":False,
        "identity_reuse_authorized":False,
        "live_staging_login_qualified":False,
        "release_authority":False,
    }

def provider_get(path,token,opener):
    if path not in ("/workers/scripts","/d1/database/"+SOURCE_DB) and not re.fullmatch(
            r"/workers/scripts/[A-Za-z0-9_-]{1,128}/settings",path):
        raise Reject("PATH_NOT_ALLOWLISTED")
    req=urllib.request.Request(ROOT+path,method="GET",headers={
        "Authorization":"Bearer "+token,"Accept":"application/json"})
    try:
        with opener.open(req,timeout=15) as r:
            status=r.status; raw=r.read(100001)
    except urllib.error.HTTPError as e:
        raise Reject("PROVIDER_HTTP_"+str(e.code)) from None
    except (OSError,TimeoutError):
        raise Reject("PROVIDER_NETWORK_UNAVAILABLE") from None
    if status!=200 or len(raw)>100000:raise Reject("PROVIDER_RESPONSE_INVALID")
    try:payload=json.loads(raw)
    except (ValueError,UnicodeError):raise Reject("PROVIDER_JSON_INVALID") from None
    if not isinstance(payload,dict) or payload.get("success") is not True:
        raise Reject("PROVIDER_RESULT_UNQUALIFIED")
    return payload["result"]

def run():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if not token or "\n" in token or "\r" in token:raise Reject("SCOPED_READ_TOKEN_MISSING")
    opener=urllib.request.build_opener(NeverRedirect())
    request_count=0
    try:
        d1=provider_get("/d1/database/"+SOURCE_DB,token,opener);request_count+=1
        if (not isinstance(d1,dict) or d1.get("uuid")!=SOURCE_DB or
             not isinstance(d1.get("name"),str) or
             hashlib.sha256(d1["name"].encode()).hexdigest()!=SOURCE_NAME_SHA):
            raise Reject("HISTORICAL_DATABASE_METADATA_DRIFT")
        scripts=provider_get("/workers/scripts",token,opener);request_count+=1
        if not isinstance(scripts,list) or len(scripts)>40:
            raise Reject("WORKER_INVENTORY_INVALID")
        names=[s.get("id") for s in scripts if isinstance(s,dict)]
        if len(names)!=len(scripts) or len(set(names))!=len(names) or STAGING_WORKER not in names:
            raise Reject("WORKER_NAMES_MISSING_OR_DUPLICATED")
        settings={}
        for name in sorted(names):
            if not isinstance(name,str) or not WORKER.fullmatch(name):
                raise Reject("WORKER_NAME_INVALID")
            settings[name]=provider_get("/workers/scripts/"+name+"/settings",token,opener)
            request_count+=1
        result=assess_topology(scripts,settings)
        result.update({
          "schema":"AXIOM_HOSTED_IDENTITY_WORKER_CUSTODY_TOPOLOGY_V1",
          "pinned_historical_database_uuid":SOURCE_DB,
          "pinned_metadata_name_confirmed":True,
          "provider_request_count":request_count,
          "provider_methods":["GET"],
          "provider_writes":0,
          "d1_sql_queries":0,
          "customer_row_values_read":0,
          "worker_bindings_mutated":False,
          "full_worker_catalog_completeness_independently_proven":False,
          "custody_independence_proven":False,
        })
        code=0
    except (Reject,ValueError) as e:
        result={
            "schema":"AXIOM_HOSTED_IDENTITY_WORKER_CUSTODY_TOPOLOGY_V1",
            "status":"INCOMPLETE_NO_GO",
            "reason_code":str(e)[:95],
            "provider_request_count":request_count,
            "provider_methods":["GET"],
            "provider_writes":0,
            "d1_sql_queries":0,
            "customer_row_values_read":0,
            "identity_reuse_authorized":False,
            "release_authority":False,
        }
        code=2
    raw=(json.dumps(result,indent=2,sort_keys=True)+"\n").encode()
    p=Path("axiom-stage-idp-custody-topology-readonly.json")
    p.write_bytes(raw)
    p.with_name(p.name+".sha256").write_text(hashlib.sha256(raw).hexdigest()+"  "+p.name+"\n")
    print("IDP_WORKER_TOPOLOGY="+result["status"]+" WRITES=0")
    return code

if __name__=="__main__":
    raise SystemExit(run())

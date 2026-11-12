"""GET-only Cloudflare v1 origin investigation for pinned existing AXIOM staging D1.

Security: Never log or retain raw audit events, actor PII, token IDs or customer
rows. A matching creation event is NOT an independent owner-of-record decision.
"""
import datetime as dt
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT="93f395f5121954671f92fffa453d6b61"
D1="ccc473f1-fbb5-4b8d-8a24-45f3696ac10f"
NAME_SHA="7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36"
ROOT="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT
UTC=dt.timezone.utc
PAGE_LIMIT=1000
MAX_PAGES=5

class Incomplete(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def sha(value):return hashlib.sha256(value.encode()).hexdigest()

def parsed_time(value):
    if not isinstance(value,str):raise Incomplete("PROVIDER_TIMESTAMP_ABSENT")
    try:
        time=dt.datetime.fromisoformat(value.replace("Z","+00:00"))
        if time.tzinfo is None:raise ValueError("naive")
        return time.astimezone(UTC)
    except ValueError as e:raise Incomplete("PROVIDER_TIMESTAMP_INVALID") from e

def run():
    token=os.getenv("CLOUDFLARE_API_TOKEN","")
    if not token or any(ch in token for ch in "\r\n"):
        raise Incomplete("READ_SCOPED_CLOUDFLARE_TOKEN_MISSING")
    opener=urllib.request.build_opener(NoRedirect())
    def get(path):
        req=urllib.request.Request(ROOT+path,method="GET",headers={
            "Authorization":"Bearer "+token,"Accept":"application/json"})
        try:
            with opener.open(req,timeout=18) as response:
                if response.status!=200:raise Incomplete("CLOUDFLARE_NON_200")
                blob=response.read(8000001)
                if len(blob)>8000000:raise Incomplete("CLOUDFLARE_OVERSIZE")
                payload=json.loads(blob)
        except urllib.error.HTTPError as e:raise Incomplete("CLOUDFLARE_HTTP_"+str(e.code)) from None
        except (OSError,UnicodeError,ValueError):
            raise Incomplete("CLOUDFLARE_READ_FAILED_OR_INVALID_JSON") from None
        if not isinstance(payload,dict) or payload.get("success") is not True:
            raise Incomplete("CLOUDFLARE_SUCCESS_NOT_CONFIRMED")
        return payload
    result={
        "schema":"AXIOM_EXISTING_STAGE_D1_LEGACY_V1_ORIGIN_PROBE_V1",
        "database_uuid":D1,
        "status":"NO_GO_INDEPENDENT_REUSE_APPROVAL_MISSING",
        "origin_metadata_pinned":False,
        "provider_v1_probe_pages_complete":False,
        "provider_v1_pages_read":0,
        "provider_v1_events_examined":0,
        "provider_v1_exact_resource_successful_events":0,
        "provider_v1_possible_create_events":0,
        "provider_v1_candidates":[],
        "provider_http_methods":["GET"],
        "raw_events_exported":False,
        "actor_emails_exported":False,
        "customer_sql_read":False,
        "production_write":False,
        "current_backup_qualified":False,
        "independent_restore_qualified":False,
        "data_separation_qualified":False,
        "historical_ownership_qualified":False,
        "source_reuse_authorized":False,
        "step_2_authorized":False,
        "release_authority":False,
    }
    try:
        metadata=get("/d1/database/"+D1)["result"]
        if not isinstance(metadata,dict) or metadata.get("uuid")!=D1:
            raise Incomplete("D1_UUID_MISMATCH")
        name=metadata.get("name")
        if not isinstance(name,str) or sha(name)!=NAME_SHA:
            raise Incomplete("D1_NAME_MISMATCH")
        created=parsed_time(metadata.get("created_at"))
        result["provider_db_created_utc"]=created.isoformat().replace("+00:00","Z")
        result["origin_metadata_pinned"]=True
        low,high=created-dt.timedelta(minutes=15),created+dt.timedelta(minutes=15)
        seen=set()
        expected_total=None
        for page in range(1,MAX_PAGES+1):
            args={"since":low.isoformat().replace("+00:00","Z"),
                  "before":high.isoformat().replace("+00:00","Z"),
                  "direction":"asc","page":str(page),"per_page":str(PAGE_LIMIT)}
            payload=get("/audit_logs?"+urllib.parse.urlencode(args))
            entries=payload.get("result")
            if not isinstance(entries,list) or len(entries)>PAGE_LIMIT:
                raise Incomplete("LEGACY_PAGE_SHAPE")
            result["provider_v1_pages_read"]+=1
            result["provider_v1_events_examined"]+=len(entries)
            info=payload.get("result_info") or {}
            if not isinstance(info,dict):raise Incomplete("LEGACY_PAGE_INFO_SHAPE")
            if type(info.get("total_count")) is int:
                if expected_total is None:expected_total=info["total_count"]
                elif expected_total!=info["total_count"]:
                    raise Incomplete("LEGACY_EVENT_COUNT_CHANGED")
            for event in entries:
                if not isinstance(event,dict):raise Incomplete("LEGACY_EVENT_SHAPE")
                eid=event.get("id")
                if not isinstance(eid,str):raise Incomplete("LEGACY_EVENT_ID_MISSING")
                ehash=sha(eid)
                if ehash in seen:raise Incomplete("LEGACY_EVENT_DUPLICATE")
                seen.add(ehash)
                when=parsed_time(event.get("when"))
                if not low<=when<=high:raise Incomplete("LEGACY_EVENT_OUT_OF_WINDOW")
                action=event.get("action") or {}
                resource=event.get("resource") or {}
                actor=event.get("actor") or {}
                if not all(isinstance(x,dict) for x in (action,resource,actor)):
                    raise Incomplete("LEGACY_EVENT_FIELDS_MISSING")
                if resource.get("id")!=D1 or action.get("result") is not True:
                    continue
                typ=action.get("type")
                if not isinstance(typ,str):raise Incomplete("LEGACY_EVENT_ACTION_MISSING")
                actor_id=actor.get("id")
                if not isinstance(actor_id,str) or not actor_id:
                    raise Incomplete("LEGACY_EVENT_ACTOR_NOT_IDENTIFIED")
                result["provider_v1_exact_resource_successful_events"]+=1
                if "create" in typ.lower() or "provision" in typ.lower():
                    result["provider_v1_possible_create_events"]+=1
                    candidate={
                        "event_sha256":ehash,
                        "actor_id_sha256":sha(actor_id),
                        "actor_type":actor.get("type") if actor.get("type") in ("user","admin","Cloudflare") else "UNCLASSIFIED",
                        "action_type_sha256":sha(typ),
                        "at_utc":when.isoformat().replace("+00:00","Z"),
                        "resource_uuid_exact":True,
                        "provider_reported_success":True,
                        "independent_owner_admitted":False,
                    }
                    if len(result["provider_v1_candidates"])<20:
                        result["provider_v1_candidates"].append(candidate)
            if expected_total is not None and len(seen)>=expected_total:
                result["provider_v1_probe_pages_complete"]=True
                break
            # A non-full page is not proof of completeness if provider capped
            # a requested 1000. Require an empty next page or stable total.
            if not entries:
                result["provider_v1_probe_pages_complete"]=True
                break
        if not result["provider_v1_probe_pages_complete"]:
            raise Incomplete("LEGACY_EVENTS_NOT_EXHAUSTED")
        result["status"]="LEGACY_ORIGIN_EVENTS_EXAMINED_OWNER_NOT_ADMITTED"
    except Incomplete as e:
        result["status"]="INCOMPLETE_NO_GO"
        result["reason_code"]=str(e)[:80]
    name="axiom_stage_d1_legacy_v1_origin_20261110.json"
    blob=(json.dumps(result,indent=2,sort_keys=True)+"\n").encode()
    with open(name,"wb") as f:f.write(blob)
    with open(name+".sha256","w") as f:
        f.write(hashlib.sha256(blob).hexdigest()+"  "+name+"\n")
    print("AXIOM_D1_LEGACY_V1_ORIGIN_RECEIPT_"+result["status"])
    return 0 if result["status"]=="LEGACY_ORIGIN_EVENTS_EXAMINED_OWNER_NOT_ADMITTED" else 2

if __name__=="__main__":
    raise SystemExit(run())

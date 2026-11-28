#!/usr/bin/env python3
"""MCN-072 account-pinned bounded Cloudflare Queue aggregate operations read.
Read-only GET and GraphQL query; never obtains bodies, ACKs, or broker message IDs.
"""
import datetime as dt
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from qualification import mcn072_cloudflare_consumer_field_diag as base

ACCOUNT_SHA = "68d517b5b40ac48a42707ecc6bdec18e28a12255efc450857f297b3c91e2b6f2"
OUTPUT = Path("mcn072-queue-operations-sanitized.json")
MAX_RESPONSE = 524288

def digest(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

def sanitized_response(url, token, payload=None):
    if url not in (
        f"https://api.cloudflare.com/client/v4/accounts/{base.ACCOUNT}/queues/{sanitized_response.queue_id}/metrics",
        "https://api.cloudflare.com/client/v4/graphql",
    ):
        raise ValueError("PATH_NOT_APPROVED")
    method = "GET" if payload is None else "POST"
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    req = urllib.request.Request(url, data=body, method=method,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json",
                 "Content-Type": "application/json", "User-Agent": "MUSITU-MCN072-QueueOpReadOnly/1.0"})
    opener = urllib.request.build_opener(base.NoRedirect())
    try:
        with opener.open(req, timeout=18) as resp:
            content_type = resp.headers.get("Content-Type","").lower()
            raw = resp.read(MAX_RESPONSE+1)
            status = resp.status
    except urllib.error.HTTPError as e:
        return {"status": e.code, "reason": "HTTP_DENIED"}
    except (urllib.error.URLError, TimeoutError, OSError):
        return {"status": None, "reason": "NETWORK_BLOCKED"}
    if status != 200 or len(raw) > MAX_RESPONSE or "json" not in content_type:
        return {"status": status, "reason": "INVALID_PROVIDER_RESPONSE"}
    try:
        doc = json.loads(raw, object_pairs_hook=base.unique_object)
    except (ValueError, UnicodeError, base.ProbeFailure):
        return {"status": status, "reason": "INVALID_PROVIDER_JSON"}
    return {"status": status, "data": doc, "response_sha256":digest(raw)}

def response_summary(doc):
    if not isinstance(doc,dict) or not isinstance(doc.get("data"), dict):
        return {"provider_success": False,"query_valid":False,"error_code":"QUERY_DATA_MISSING"}
    viewer=doc["data"].get("viewer")
    accts=viewer.get("accounts") if isinstance(viewer,dict) else None
    if not isinstance(accts,list) or len(accts)!=1 or not isinstance(accts[0],dict):
        return {"provider_success":False,"query_valid":False,"error_code":"ACCOUNTS_SHAPE_INVALID"}
    rows=accts[0].get("queueMessageOperationsAdaptiveGroups")
    if not isinstance(rows,list) or len(rows)>500:
        return {"provider_success":False,"query_valid":False,"error_code":"OPERATIONS_SHAPE_INVALID"}
    action_counts={"WriteMessage":0,"ReadMessage":0,"DeleteMessage":0}
    outcomes={"success":0,"fail":0,"dlq":0}
    hours=set()
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get("count"),int) or row["count"]<0:
            return {"provider_success":False,"query_valid":False,"error_code":"ROWS_INVALID"}
        dims=row.get("dimensions")
        if not isinstance(dims,dict) or dims.get("actionType") not in (*action_counts.keys(),None):
            return {"provider_success":False,"query_valid":False,"error_code":"DIMENSIONS_INVALID"}
        a=dims.get("actionType")
        if a in action_counts: action_counts[a] += row["count"]
        outcome=dims.get("outcome")
        if outcome in outcomes: outcomes[outcome] += row["count"]
        h=dims.get("datetimeHour")
        if isinstance(h,str) and len(h)<40: hours.add(h)
    return {"provider_success":True,"query_valid":True,"aggregated_rows":len(rows),
            "aggregation_may_be_sampled":True,"counts_by_action":action_counts,
            "counts_by_delete_outcome":outcomes,"hour_buckets":len(hours),
            "not_per_message":True,"not_ack_receipts":True}

def main():
    report={"schema":"musitu.mcn072.queue_operations_getonly.v1",
            "qualified":False,"commercial_ga":"NO_GO","read_only":True,
            "queue_pull_calls":0,"broker_ack_calls":0,"postgres_writes":0,
            "per_message_delivery_retries_acks_obtained":False,
            "postgres_queue_job_join_verified":False}
    try:
        token=os.environ.get("CLOUDFLARE_API_TOKEN","")
        if not 12<=len(token)<=4096 or any(c.isspace() for c in token):
            raise base.ProbeFailure("SECRET_UNAVAILABLE")
        if digest(base.ACCOUNT)!=ACCOUNT_SHA:
            raise base.ProbeFailure("ACCOUNT_MISMATCH")
        opener=urllib.request.build_opener(base.NoRedirect())
        inv,_=base.fetch(base.LIST_PATH,token,opener)
        queues=inv.get("result")
        info=inv.get("result_info")
        if type(queues)!=list or len(queues)!=1 or type(info)!=dict or info.get("total_count")!=1 or info.get("total_pages")!=1:
            raise base.ProbeFailure("QUEUE_INVENTORY_UNVERIFIED")
        qid=base.checked_id(queues[0].get("queue_id"))
        detail,_=base.fetch(base.PREFIX+"/"+qid,token,opener)
        item=detail.get("result")
        if not isinstance(item,dict) or item.get("queue_id")!=qid:
            raise base.ProbeFailure("QUEUE_ID_MISMATCH")
        sanitized_response.queue_id=qid
        report["queue_id_sha256"]=digest(qid)
        stamp=dt.datetime.now(dt.timezone.utc)
        start=stamp-dt.timedelta(hours=24)
        report["window_start_utc"]=start.isoformat()
        report["window_end_utc"]=stamp.isoformat()
        metrics=sanitized_response(
            f"https://api.cloudflare.com/client/v4/accounts/{base.ACCOUNT}/queues/{qid}/metrics",token)
        report["backlog_http_status"]=metrics.get("status")
        if isinstance(metrics.get("data"),dict) and metrics["data"].get("success") is True:
            r=metrics["data"].get("result")
            if isinstance(r,dict):
                report["backlog"]={k:r[k] for k in ("backlog_count","backlog_bytes","oldest_message_timestamp_ms")
                                   if type(r.get(k)) in (int,float)}
                report["backlog_response_sha256"]=metrics.get("response_sha256")
        else:
            report["backlog_observation"]="UNAVAILABLE_OR_DENIED"
        gql="""query QueueOps($accountTag: string!, $queueId: string!, $start: Time!, $end: Time!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              queueMessageOperationsAdaptiveGroups(limit: 500,
                filter: { queueId: $queueId, datetime_geq: $start, datetime_leq: $end },
                orderBy: [datetimeHour_DESC]) {
                count
                dimensions { actionType outcome datetimeHour }
              }
            }
          }
        }"""
        payload={"query":gql,"variables":{"accountTag":base.ACCOUNT,"queueId":qid,
           "start":start.isoformat().replace("+00:00","Z"),
           "end":stamp.isoformat().replace("+00:00","Z")}}
        g=sanitized_response("https://api.cloudflare.com/client/v4/graphql",token,payload)
        report["graphql_http_status"]=g.get("status")
        report["graphql_response_sha256"]=g.get("response_sha256")
        if isinstance(g.get("data"),dict) and not g["data"].get("errors"):
            report["graphql_summary"]=response_summary(g["data"])
        else:
            err=g.get("data",{}).get("errors") if isinstance(g.get("data"),dict) else None
            report["graphql_summary"]={"provider_success":False,"query_valid":False,
               "reason":"API_SCHEMA_OR_PERMISSION_ERROR" if err else g.get("reason","UNAVAILABLE"),
               "error_count":len(err) if isinstance(err,list) else None}
        report["status"]="COMPLETE_NONQUALIFYING_READ"
    except (base.ProbeFailure,ValueError,KeyError,TypeError) as e:
        report["status"]="FAIL_CLOSED"
        report["reason"]=str(e) if type(e) is base.ProbeFailure else "INVALID_PROVIDER_DATA"
    except Exception:
        report["status"]="FAIL_CLOSED"
        report["reason"]="UNEXPECTED_FAILURE"
    OUTPUT.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    Path(str(OUTPUT)+".sha256").write_text(digest(OUTPUT.read_bytes())+"  "+OUTPUT.name+"\n")
    print("MCN072",report["status"],"GraphQL:",report.get("graphql_summary",{}).get("reason",
        report.get("graphql_summary",{}).get("query_valid")),"NO_GO")

if __name__=="__main__":
    main()

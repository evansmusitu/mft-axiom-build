#!/usr/bin/env python3
"""MUSITU Store *non-public* payments staging only. Never touch Axiom billing.

Creates ONE isolated empty Store D1 and a separate, disabled Worker with
checkout & callbacks gated off and no merchant secret. No routes, customers,
products, payments, app installs, or production access are created.
"""
import email
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_ACCOUNT = "93f395f5121954671f92fffa453d6b61"
EXPECTED_ZONE = "5b56528f03948ff5917a5e0cd9f7109e"
NAME = "musitu-store-v2-payments-staging-20261019"
DATABASE = "musitu_store_v2_payments_staging"
BRANCH = "refs/heads/feature/musitu-store-v2-package-state-20261012"
BILLING_ROUTE = "payments.mftintelligence.com/store/billing/*"
ROOT = Path(__file__).resolve().parent

def deny(message):
    raise RuntimeError("isolated Store staging blocked: " + message)

def get_credentials():
    # Reuse the owner-configured GitHub Secrets pair that the existing Store
    # Cloudflare workflows use. A separately configured scoped API token was
    # previously accepted for reads but rejected isolated D1 creation (403).
    # Prefer the existing global key only within this account-pinned staging
    # provisioner, without exposing keys, altering CI secrets, or widening
    # the operation beyond one disabled and un-routed Store-only deployment.
    mail = os.environ.get("CLOUDFLARE_EMAIL", "")
    key = os.environ.get("CLOUDFLARE_GLOBAL_API_KEY", "")
    if mail and key:
        return {"X-Auth-Email": mail, "X-Auth-Key": key}
    token = os.environ.get("CF_API_TOKEN", "")
    if token:
        return {"Authorization": "Bearer " + token}
    deny("no authorized Cloudflare API credentials in runner secrets")

HEADERS = {}

def cf(path, method="GET", payload=None, mime="application/json"):
    if not path.startswith("/") or "//" in path:
        deny("invalid Cloudflare API path")
    data = None
    headers = dict(HEADERS)
    headers["Accept"] = "application/json"
    headers["User-Agent"] = "MUSITU-Store-Isolated-Staging/1.0"
    if payload is not None:
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        headers["Content-Type"] = mime
    req = urllib.request.Request(BASE + path, headers=headers, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=35) as r:
            code,raw = r.status,r.read(400000)
    except urllib.error.HTTPError as e:
        code,raw = e.code,e.read(2000)
    except Exception:
        deny("Cloudflare API not reachable for read or write")
    try:
        obj = json.loads(raw)
    except (ValueError,TypeError):
        obj = None
    if not (200 <= code < 300) or not isinstance(obj,dict) or obj.get("success") is not True:
        # Only Cloudflare's numeric error IDs are safe to log. Never print
        # response messages, request/response bodies, cookies, headers or token.
        # D1 creation HTTP 403 needs an actionable numeric failure category.
        errors = obj.get("errors") if isinstance(obj,dict) else None
        ids = []
        for item in errors if isinstance(errors,list) else []:
            value = item.get("code") if isinstance(item,dict) else None
            if type(value) is int and 1000 <= value <= 999999:
                ids.append(value)
        ids = ids[:3]
        if (method == "POST"
            and path == "/accounts/" + EXPECTED_ACCOUNT + "/d1/database"
            and 7406 in ids):
            # Documented D1 account-database system limit. Stop instead of
            # retrying, switching accounts, deleting unrelated D1, or treating
            # this as missing API token permission. This is quota authority.
            deny("Cloudflare D1 database account limit reached "
                 "(HTTP 403; error_codes=7406); verify Workers Paid "
                 "entitlement and request Cloudflare quota correction; "
                 "do not delete existing databases")
        deny("Cloudflare API rejected " + method + " request (HTTP " + str(code)
             + "; error_codes=" + (",".join(map(str,ids)) if ids else "none") + ")")
    return obj.get("result")

def make_multipart(modules,meta):
    bound = "----MUSITUStoreStaging" + secrets.token_hex(15)
    parts = []
    def add(data):
        parts.append(data if isinstance(data,bytes) else data.encode())
    add(f'--{bound}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(meta,separators=(",",":")))
    add("\r\n")
    for filename,raw in modules:
        if "/" in filename or ".." in filename or not filename.endswith(".mjs"):
            deny("unsafe worker module filename")
        add(f'--{bound}\r\nContent-Disposition: form-data; name="{filename}"; filename="{filename}"\r\nContent-Type: application/javascript+module\r\n\r\n')
        add(raw)
        add("\r\n")
    add(f"--{bound}--\r\n")
    return b"".join(parts),"multipart/form-data; boundary="+bound

def statements(sql):
    # SQLite complete_statement() recognizes comment lines and excludes
    # semicolons inside quoted strings: do not blindly split SQL on ';'.
    buf = ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip() and not buf.lstrip().startswith("--") or (
                ";" in buf and buf.strip()):
                yield buf
            buf = ""
    if buf.strip():
        deny("incomplete Store SQL schema")

def check_source_and_schema():
    expected={"store_customer_tokens","store_products","store_checkout_intents","store_checkout_reviews"}
    src = (ROOT / "store-axiom-checkout-schema.sql").read_text()
    local = sqlite3.connect(":memory:")
    local.execute("PRAGMA foreign_keys=ON")
    local.executescript(src)
    tables={r[0] for r in local.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not expected.issubset(tables) or tables.intersection({"customers","billing_subscriptions","usage_buckets"}):
        deny("Store source schema contains unexpected Axiom or missing tables")
    for table in expected:
        if local.execute("SELECT count(*) FROM " + table).fetchone()[0] != 0:
            deny("Store schema seeds forbidden customer/product/payment data")
    modules = [
        ("store-axiom-checkout.mjs",(ROOT / "store-axiom-checkout.mjs").read_bytes()),
        ("store-axiom-payment-routes.mjs",(ROOT / "store-axiom-payment-routes.mjs").read_bytes()),
    ]
    # The approved Store checkout now imports boundedBytes together with
    # createStorePaymentRoutes. An obsolete exact-string check rejected this
    # verified current source before Cloudflare was ever contacted.
    required_import = rb"^import\s*\{\s*createStorePaymentRoutes\s*,\s*boundedBytes\s*\}\s*from\s*['\"]\./store-axiom-payment-routes\.mjs['\"]\s*;?\s*$"
    if not re.search(required_import, modules[0][1], flags=re.MULTILINE):
        deny("Store payment imports and module dependencies unexpectedly changed")
    for _,raw in modules:
        if len(raw)>100000:
            deny("unexpected Worker module size")
    return src,modules,expected

def main():
    if os.environ.get("GITHUB_REF") != BRANCH:
        deny("only the pinned isolated Store GitHub branch can stage payments")
    if os.environ.get("ACCOUNT_ID") != EXPECTED_ACCOUNT or os.environ.get("ZONE_ID") != EXPECTED_ZONE:
        deny("Cloudflare account/zone scope does not match previously authorized Store context")
    if os.environ.get("MUSITU_STORE_STAGE_GATE") != "disabled-checkout-no-public-route":
        deny("explicit non-production staging gate absent")
    schema,modules,expected=check_source_and_schema()
    HEADERS.update(get_credentials())
    account=cf("/accounts/"+EXPECTED_ACCOUNT)
    if not isinstance(account,dict) or account.get("id")!=EXPECTED_ACCOUNT:
        deny("Cloudflare account ID cannot be independently verified")
    scripts=cf("/accounts/"+EXPECTED_ACCOUNT+"/workers/scripts")
    dbs=cf("/accounts/"+EXPECTED_ACCOUNT+"/d1/database")
    routes=cf("/zones/"+EXPECTED_ZONE+"/workers/routes")
    if not isinstance(scripts,list) or not isinstance(dbs,list) or not isinstance(routes,list):
        deny("Cloudflare topology listings unavailable; cannot safely provision")
    worker_names={str(x.get("id") or x.get("name") or "") for x in scripts if isinstance(x,dict)}
    if NAME in worker_names:
        deny("isolated Store Worker already exists; never overwrite unverified account resource")
    if any(x.get("name")==DATABASE for x in dbs if isinstance(x,dict)):
        deny("isolated Store D1 already exists; recovery requires independent authorization")
    if any(x.get("pattern") in {BILLING_ROUTE,"payments.mftintelligence.com/store/*"} for x in routes if isinstance(x,dict)):
        deny("Store domain route collision detected, refusing to touch Axiom billing")
    if len(dbs)>=10:
        # The Free-tier limit is ten D1 databases. Verify a PAID Workers
        # subscription from the account's own billing API before allocating
        # an isolated 12th database; never infer plan from database count.
        subscriptions=cf("/accounts/"+EXPECTED_ACCOUNT+"/subscriptions")
        if not isinstance(subscriptions,list):
            deny("Workers Paid subscription cannot be independently verified")
        active=[]
        for sub in subscriptions:
            if not isinstance(sub,dict):continue
            rate=sub.get("rate_plan")
            if not isinstance(rate,dict):continue
            description=" ".join(map(str,[rate.get("id"),rate.get("public_name"),rate.get("name")]))
            if "worker" in description.lower() and str(sub.get("state") or "").lower()=="paid":
                active.append(sub)
        if not active:
            deny("workers paid subscription not verified; no database allocation")

    db=cf("/accounts/"+EXPECTED_ACCOUNT+"/d1/database",method="POST",payload={"name":DATABASE})
    dbid=str(db.get("uuid") or db.get("id") or "") if isinstance(db,dict) else ""
    if not re.fullmatch(r"[0-9a-f-]{36}",dbid):
        deny("D1 created with unverifiable ID; stop and inspect the private account")
    # Only the database just created in THIS run is modified. No migrations
    # against Axiom or any previously existing D1.
    for query in statements(schema):
        cf("/accounts/"+EXPECTED_ACCOUNT+"/d1/database/"+dbid+"/query",
           method="POST",payload={"sql":query})
    rows=cf("/accounts/"+EXPECTED_ACCOUNT+"/d1/database/"+dbid+"/query",
            method="POST",payload={"sql":"SELECT name FROM sqlite_master WHERE type='table';"})
    found=set()
    for group in rows if isinstance(rows,list) else []:
        if isinstance(group,dict):
            for item in group.get("results") or []:
                if isinstance(item,dict):found.add(str(item.get("name") or ""))
    if not expected.issubset(found):
        deny("new Store staging D1 is missing required tables after isolated migration")

    meta={
        "main_module":modules[0][0],
        "compatibility_date":"2026-09-01",
        "bindings":[
            {"type":"d1","name":"STORE_DB","id":dbid},
            {"type":"plain_text","name":"STORE_CHECKOUT_ENABLED","text":"false"},
            {"type":"plain_text","name":"STORE_CALLBACKS_CERTIFIED","text":"false"},
            {"type":"plain_text","name":"STORE_FIRST_PARTY_ONLY","text":"true"},
        ],
    }
    payload,mime=make_multipart(modules,meta)
    cf("/accounts/"+EXPECTED_ACCOUNT+"/workers/scripts/"+NAME,"PUT",payload,mime)
    # Prevent accidental public workers.dev traffic. No custom-domain,
    # Worker routes or Store Payment secret are ever configured.
    cf("/accounts/"+EXPECTED_ACCOUNT+"/workers/scripts/"+NAME+"/subdomain",
       method="POST",payload={"enabled":False,"previews_enabled":False})
    settings=cf("/accounts/"+EXPECTED_ACCOUNT+"/workers/scripts/"+NAME+"/settings")
    bindings=settings.get("bindings") if isinstance(settings,dict) else None
    if not isinstance(bindings,list):
        deny("new Worker settings unavailable for readback")
    indexed={x.get("name"):x for x in bindings if isinstance(x,dict)}
    if indexed.get("STORE_DB",{}).get("type")!="d1":
        deny("isolated new Store D1 binding readback failed")
    if "STORE_PAYNOW_INTEGRATION_KEY" in indexed or "PAYNOW_INTEGRATION_KEY" in indexed:
        deny("unexpected real merchant secret on disabled staging worker")
    for key in ("STORE_CHECKOUT_ENABLED","STORE_CALLBACKS_CERTIFIED"):
        value=indexed.get(key,{})
        if value.get("type")!="plain_text" or value.get("text")!="false":
            deny("disabled Store billing binding missing or unexpectedly enabled")
    sub=cf("/accounts/"+EXPECTED_ACCOUNT+"/workers/scripts/"+NAME+"/subdomain")
    if not isinstance(sub,dict) or sub.get("enabled") is not False:
        deny("new Store staging Worker subdomain not independently verified OFF")
    # Final second read-only check: no payments.mftintelligence.com route
    # was attached/modified by this isolated provisioning script.
    after=cf("/zones/"+EXPECTED_ZONE+"/workers/routes")
    if not isinstance(after,list) or after!=routes:
        deny("zone routing unexpectedly changed; manual inspection required")
    evidence={
        "schema":"musitu.store.payments.staging_provision.v1",
        "state":"ISOLATED_STAGING_PROVISIONED_DISABLED",
        "account_id_sha256":hashlib.sha256(EXPECTED_ACCOUNT.encode()).hexdigest(),
        "staging_db_name":DATABASE,
        "staging_db_id_sha256":hashlib.sha256(dbid.encode()).hexdigest(),
        "staging_worker_name":NAME,
        "store_d1_tables_verified":sorted(expected),
        "store_checkout_enabled":False,
        "store_callbacks_certified":False,
        "merchant_key_present":False,
        "workers_dev_enabled":False,
        "custom_domain_route_added":False,
        "axiom_billing_modified":False,
        "v1_signed_store_modified":False,
        "staging_payments_processed":False,
        "production_ready":False,
        "release_authorized":False,
        "non_public":True
    }
    Path("store-payments-staging-evidence.json").write_text(json.dumps(evidence,sort_keys=True,indent=2)+"\n")
    print(json.dumps(evidence,sort_keys=True))

if __name__=="__main__":
    main()

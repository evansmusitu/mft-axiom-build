#!/usr/bin/env python3
"""One-use MUSITU corporate 404 maintenance release check and rollback controller.

This is NOT a Phase 03 release. Private API token is injected by GitHub Actions,
never echoed. Mutations are restricted to rollback of the exact corporate Pages
production project, only after exact-source and deployment identity checks.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.parse import urlsplit

ACCOUNT="93f395f5121954671f92fffa453d6b61"
PROJECT="musitu-corporate"
CORPORATE="https://mftintelligence.com"
SOURCE_SHA="6b1643ab2d3b03628104b617435db1d364076aa9"
BASELINE="a2426a81-b0cb-4a46-a90c-493f871c9775"
HISTORIC_ROLLBACK="69ee853a-f0b4-432e-b069-7d6e180fdb4c"
API="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/pages/projects/"+PROJECT
NEGATIVE="/__musitu-nonexistent-404-maintenance-test-20261109/"
ARTICLE_NEGATIVE="/research/articles/backtesting-overfitting/"
VIDEO_SHA="afd6dfd3c73668e544f3f8a857697fed0abaadccd4927202bb3a185612c2dea0"
POSTER_SHA="0ea5e961d916375029010dbae01bf8a1783e5fd6b90f74c006dc852df1c285d0"
AGENT="MUSITU-Corporate-Controlled-Maintenance/1.0"


def token():
    value=os.environ.get("CLOUDFLARE_API_TOKEN","").strip()
    if not value:raise RuntimeError("Cloudflare scoped Pages token unavailable")
    return value


def cloudflare(path="", method="GET"):
    if method=="GET":
        if path not in ("","/deployments/"+BASELINE,
                "/deployments/"+HISTORIC_ROLLBACK,
                "/deployments?per_page=10"):
            raise RuntimeError("Unexpected Cloudflare GET request")
    elif method=="POST":
        if not path.startswith("/deployments/") or not path.endswith("/rollback"):
            raise RuntimeError("Unexpected Cloudflare rollback request")
        identifier=path.split("/")[2]
        if identifier not in {BASELINE,active_new_deployment_id()}:
            raise RuntimeError("Refusing rollback to unqualified deployment")
    else:
        raise RuntimeError("Unexpected Cloudflare method")
    url=API+path
    req=urllib.request.Request(url,method=method,headers={
        "Authorization":"Bearer "+token(),
        "Accept":"application/json",
        "User-Agent":AGENT})
    try:
        with urllib.request.urlopen(req,timeout=25) as response:
            if response.status!=200:raise RuntimeError("Unexpected Cloudflare status")
            body=response.read(750001)
    except urllib.error.HTTPError as exc:
        # Do not log request URLs: they may hold credentials in other APIs.
        raise RuntimeError("Cloudflare "+method+" rejected (HTTP "+str(exc.code)+")") from None
    except (urllib.error.URLError,TimeoutError):
        raise RuntimeError("Cloudflare "+method+" connectivity error") from None
    if len(body)>750000:raise RuntimeError("Cloudflare response too large")
    try: obj=json.loads(body)
    except (ValueError,UnicodeError):raise RuntimeError("Cloudflare returned invalid JSON") from None
    if not isinstance(obj,dict) or obj.get("success") is not True:
        raise RuntimeError("Cloudflare response did not confirm success")
    return obj.get("result")


def project():
    value=cloudflare()
    if not isinstance(value,dict) or value.get("name")!=PROJECT or (
            value.get("production_branch")!="main") or (
            CORPORATE.removeprefix("https://") not in value.get("domains",[])) or (
            (value.get("source") or {}).get("type")):
        raise RuntimeError("Corporate Pages project identity mismatch")
    return value


def deployment_id(value):
    return (value.get("canonical_deployment") or {}).get("id")


def active_new_deployment_id():
    p=project()
    d=p.get("canonical_deployment") or {}
    if (d.get("environment")!="production" or
        ((d.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash")!=SOURCE_SHA or
        (d.get("latest_stage") or {}).get("status")!="success"):
        raise RuntimeError("Active production does not match exact qualified hotfix")
    return d.get("id")


def get_public(path, max_bytes=500000):
    url=CORPORATE+path
    req=urllib.request.Request(url,headers={"User-Agent":AGENT},method="GET")
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            status=response.status
            actual=response.url
            headers={a.lower():b for a,b in response.headers.items()}
            body=response.read(max_bytes+1)
    except urllib.error.HTTPError as exc:
        status=exc.code
        actual=exc.url
        headers={a.lower():b for a,b in exc.headers.items()}
        body=exc.read(max_bytes+1)
    if len(body)>max_bytes:raise RuntimeError("Public response over bounded budget")
    if actual.rstrip("/")!=url.rstrip("/"):
        raise RuntimeError("Unexpected public redirect on exact route")
    return status,headers,body


class Meta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.robots=[]
        self.canonical=[]
        self.lang=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if tag=="html":self.lang.append(d.get("lang"))
        if tag=="meta" and d.get("name")=="robots":self.robots.append(d.get("content"))
        if tag=="link" and d.get("rel")=="canonical":self.canonical.append(d.get("href"))


def safe_headers(headers,path):
    if (not headers.get("content-security-policy") or
            headers.get("x-content-type-options","").lower()!="nosniff"):
        raise RuntimeError("Missing critical live security headers on "+path)


def check_indexable_route(route):
    status,headers,body=get_public(route)
    if status!=200:raise RuntimeError("Approved public route returned non-200: "+route)
    safe_headers(headers,route)
    page=Meta()
    page.feed(body.decode("utf-8","replace"))
    if page.robots!=["index,follow"] or page.canonical!=[CORPORATE+route]:
        raise RuntimeError("Public canonical/indexability mismatch: "+route)
    return True


def verify_sitemap_and_pages():
    status,_,data=get_public("/sitemap.xml")
    if status!=200:raise RuntimeError("Current public sitemap unavailable")
    try:root=ET.fromstring(data)
    except ET.ParseError:raise RuntimeError("Current public sitemap invalid") from None
    ns="{http://www.sitemaps.org/schemas/sitemap/0.9}"
    urls=[n.text for n in root.findall(ns+"url/"+ns+"loc")]
    if (len(urls)!=33 or len(set(urls))!=33 or CORPORATE+"/" not in urls or
        any(not isinstance(u,str) or not u.startswith(CORPORATE+"/") or
            u.startswith(CORPORATE+"/fr/") or
            u.startswith(CORPORATE+"/research/articles/") or
            u==CORPORATE+"/404/" for u in urls)):
        raise RuntimeError("Public site sitemap changed from approved 33 URL cohort")
    status,_,robots=get_public("/robots.txt")
    if status!=200 or b"Allow: /" not in robots or b"Disallow: /" in robots or (
            ("Sitemap: "+CORPORATE+"/sitemap.xml").encode() not in robots):
        raise RuntimeError("Public robots/indexing contract has changed")
    routes=[u.removeprefix(CORPORATE) for u in urls]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(check_indexable_route,routes))
    if len(results)!=33 or not all(results):
        raise RuntimeError("Public sitemap URLs failed acceptance")
    print("All 33 existing canonical public URLs and sitemap/robots: PASS")


def verify_unknown(expected):
    for route in (NEGATIVE,"/fr/",ARTICLE_NEGATIVE):
        status,headers,body=get_public(route)
        if status!=expected:raise RuntimeError("Wrong missing-route HTTP status on "+route)
        if expected==404:
            safe_headers(headers,route)
            p=Meta();p.feed(body.decode("utf-8","replace"))
            if p.robots!=["noindex,nofollow"] or p.canonical:
                raise RuntimeError("Missing-route noindex/canonical failure on "+route)
        else:
            p=Meta();p.feed(body.decode("utf-8","replace"))
            if p.canonical!=[CORPORATE+"/"] or p.lang!=["en"]:
                raise RuntimeError("Expected legacy soft-404 homepage state not observed")
    print("Three missing paths correctly returned:",expected)


def verify_media_and_intelligence():
    for path,checksum in (("/assets/studio-demo-82s.mp4",VIDEO_SHA),("/assets/studio-poster.png",POSTER_SHA)):
        status,_,body=get_public(path,max_bytes=2_000_000)
        if status!=200 or hashlib.sha256(body).hexdigest()!=checksum:
            raise RuntimeError("Published Studio media changed or unavailable")
    request=urllib.request.Request("https://evansmusitu.github.io/",method="GET",headers={"User-Agent":AGENT})
    with urllib.request.urlopen(request,timeout=20) as response:
        if response.status!=200 or b"MUSITU" not in response.read(150000):
            raise RuntimeError("Independent Intelligence origin has regressed")
    print("Studio approved media and separate Intelligence origin: PASS")


def wait_for_production(target,expected_404,attempts=15):
    last="Provider or public propagation is not ready"
    for attempt in range(attempts):
        try:
            p=project()
            if deployment_id(p)!=target:
                last="Active canonical Pages target not yet propagated"
            else:
                # Retry only waiting on provider propagation; full acceptance is done separately.
                status,_,_=get_public(NEGATIVE)
                if status==expected_404:
                    return
                last="Public 404 response not yet propagated"
        except (RuntimeError,urllib.error.URLError,TimeoutError):
            last="Public/Pages readiness check pending"
        if attempt!=attempts-1:time.sleep(3)
    raise RuntimeError("HOLD: expected production state failed to propagate: "+last)


def rollback_to(target):
    if target!=BASELINE and target!=active_new_deployment_id():
        raise RuntimeError("Refusing rollback to unqualified target")
    result=cloudflare("/deployments/"+target+"/rollback",method="POST")
    if not isinstance(result,dict):
        raise RuntimeError("Rollback provider result missing")
    print("Cloudflare exact production rollback API returned success")


def preflight():
    p=project()
    if deployment_id(p)!=BASELINE:
        raise RuntimeError("HOLD: currently active Pages production does not match qualified baseline")
    for ref in (BASELINE,HISTORIC_ROLLBACK):
        d=cloudflare("/deployments/"+ref)
        if (not isinstance(d,dict) or d.get("id")!=ref or
            d.get("environment")!="production" or
            (d.get("latest_stage") or {}).get("status")!="success"):
            raise RuntimeError("HOLD: successful qualified recovery deployment absent")
    verify_sitemap_and_pages()
    verify_unknown(200)
    verify_media_and_intelligence()
    print("EXACT-SHA RELEASE PREFLIGHT PASS; zero provider writes")


def verify_new():
    new=active_new_deployment_id()
    if new==BASELINE:raise RuntimeError("No new production deployment was created")
    wait_for_production(new,404)
    verify_sitemap_and_pages()
    verify_unknown(404)
    verify_media_and_intelligence()
    print("NEW-404 PRODUCTION ACCEPTANCE PASS; source matches exact SHA")
    return new


def recovery_on_failure():
    p=project()
    if deployment_id(p)==BASELINE:
        print("RECOVERY: existing baseline remains live; no rollback necessary")
        return
    try:
        new=active_new_deployment_id()
    except RuntimeError:
        raise RuntimeError("RECOVERY HOLD: unfamiliar production change; no blind rollback") from None
    rollback_to(BASELINE)
    wait_for_production(BASELINE,200)
    verify_sitemap_and_pages()
    verify_unknown(200)
    verify_media_and_intelligence()
    print("FAILURE RECOVERY: previous production restored and independently verified")


def rehearsal():
    new=verify_new()
    rollback_to(BASELINE)
    wait_for_production(BASELINE,200)
    verify_sitemap_and_pages()
    verify_unknown(200)
    print("ACTUAL PRODUCTION ROLLBACK TO VERIFIED PRIOR RELEASE: PASS")
    # Only this new exact-source, previously verified production deployment may be restored.
    current=project()
    if deployment_id(current)!=BASELINE:
        raise RuntimeError("HOLD: unexpected production change during rollback exercise")
    # Confirm new target remains an eligible successful production deployment using list read.
    entries=cloudflare("/deployments?per_page=10")
    d=[x for x in entries if isinstance(x,dict) and x.get("id")==new]
    if len(d)!=1 or d[0].get("environment")!="production" or (d[0].get("latest_stage") or {}).get("status")!="success":
        raise RuntimeError("HOLD: exact new deployment no longer qualifies for restoration")
    # Restore newer known-good release (Cloudflare permits rollback to a newer successful target).
    # The only other allowed write is restoring the exact new target whose
    # ID and successful production status were verified above.
    token_value=token()
    request=urllib.request.Request(API+"/deployments/"+new+"/rollback",method="POST",
        headers={"Authorization":"Bearer "+token_value,"Accept":"application/json","User-Agent":AGENT})
    try:
        with urllib.request.urlopen(request,timeout=25) as resp:
            data=json.loads(resp.read(750001))
    except urllib.error.HTTPError as exc:
        raise RuntimeError("HOLD: new-deployment restoration rejected HTTP "+str(exc.code)) from None
    if not isinstance(data,dict) or data.get("success") is not True:
        raise RuntimeError("HOLD: provider did not confirm new-deployment restoration")
    wait_for_production(new,404)
    verify_sitemap_and_pages()
    verify_unknown(404)
    verify_media_and_intelligence()
    print("A/B/A RECOVERY EXERCISE PASS: prior production restored then approved hotfix restored")
    print("FINAL PRODUCTION: exact-source 404-maintenance release is active")
    print("PHASE03: 15 research/language pages remain UNPUBLISHED; sitemap remains 33")


def main():
    command=sys.argv[1] if len(sys.argv)==2 else ""
    operations={
        "preflight":preflight,
        "verify-new":verify_new,
        "rehearse":rehearsal,
        "recover-on-failure":recovery_on_failure,
    }
    if command not in operations:
        raise SystemExit("Usage: corporate_soft404_maintenance_control.py preflight|verify-new|rehearse|recover-on-failure")
    try:operations[command]()
    except Exception as exc:
        # All routine exceptions have safe messages; do not print provider response bodies or tokens.
        print("MAINTENANCE CONTROL FAILURE:",type(exc).__name__,str(exc))
        raise SystemExit(1) from None


if __name__=="__main__":main()

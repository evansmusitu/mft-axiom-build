"""Synthetic five-request concurrent S0 read-only OpenHands API challenge.

Runs inside a disposable worker container. It is not a five-worker scale test,
a model evaluation, or independent certification.
"""
import json
import os
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

class LoadNotQualified(RuntimeError):
    pass

def run_bounded_s0_load(endpoint, key, *, count=5, probe=None):
    if type(count) is not int or count!=5:
        raise LoadNotQualified('only the bounded 5-request S0 challenge is admitted')
    if probe is None:
        from workspace_s0_probe import run_workspace_s0_probe
        probe=run_workspace_s0_probe
    if not callable(probe):
        raise LoadNotQualified('S0 workspace probe unavailable')
    gate=threading.Barrier(count,timeout=15)
    lock=threading.Lock()
    active=0
    peak=0
    def attempt(_):
        nonlocal active,peak
        try:
            gate.wait()
            with lock:
                active+=1
                peak=max(peak,active)
            try:
                start=time.monotonic()
                receipt=probe(endpoint,key)
                latency=(time.monotonic()-start)*1000
                if not isinstance(receipt,dict) or receipt.get('remote_workspace_s0_executed') is not True or receipt.get('live_runtime_qualification')!='NOT_PROVEN' or receipt.get('external_action_executed') is not False:
                    raise LoadNotQualified('S0 response contract mismatch')
                return latency
            finally:
                with lock:
                    active-=1
        except Exception:
            raise LoadNotQualified('bounded S0 request did not complete safely') from None
    try:
        with ThreadPoolExecutor(max_workers=count) as pool:
            latencies=list(pool.map(attempt,range(count)))
    except Exception:
        raise LoadNotQualified('bounded S0 concurrent challenge failed closed') from None
    if len(latencies)!=5 or peak!=5:
        raise LoadNotQualified('bounded S0 concurrency evidence not established')
    values=sorted(latencies)
    return {
        'schema':'musitu.axiom.trackb.s0-api-load.v1',
        'requests_completed':len(latencies),
        'max_inflight':peak,
        'p50_ms':round(statistics.median(values),2),
        'p95_ms':round(values[-1],2),
        'model_driven_execution':'NOT_PROVEN',
        'ten_concurrent_workers':'NOT_PROVEN',
        'external_action_executed':False,
        'production_authority':False,
        'certification_authority':False,
        'live_runtime_qualification':'NOT_PROVEN',
    }

def main():
    if os.getenv('AXIOM_ISOLATED_QUALIFICATION')!='TRUE':
        print('MUSITU_AXIOM_S0_LOAD_SCOPE_DENIED',file=sys.stderr)
        return 42
    try:
        result=run_bounded_s0_load(os.getenv('AXIOM_OPENHANDS_LOOPBACK_URL',''),os.getenv('OH_SESSION_API_KEYS_0',''))
    except LoadNotQualified:
        print('MUSITU_AXIOM_S0_LOAD_NOT_QUALIFIED',file=sys.stderr)
        return 43
    print(json.dumps(result,sort_keys=True))
    print('MUSITU_AXIOM_OPENHANDS_FIVE_CONCURRENT_S0_REQUESTS_PASS')
    return 0

if __name__=='__main__':
    raise SystemExit(main())

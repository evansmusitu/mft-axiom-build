"""Fail-closed Cloudflare cleanup for one narrow Studio PITR disposable proof.

Never accepts production Worker names or a KV namespace inferred from title.
Never deletes an exact temporary KV namespace until the corresponding test
Worker has been independently verified absent. Receipts contain no credentials.
"""
import re
import time

WORKER_SCOPE = re.compile(r'musitu-studio-v03-pitr-kv-v[0-9]-e2e-20261021\Z')
KV_ID = re.compile(r'[a-f0-9]{32}\Z')
PROTECTED = {
    'studio.mftintelligence.com': 'musitu-studio-v02',
    'studio-v03.mftintelligence.com': 'musitu-studio-v03-do',
}

class CleanupGuardError(Exception):
    """Provider readback did not prove a narrow, disposable cleanup."""


def cleanup_exact_disposables(request, worker, namespace, *, pause=None):
    """Delete only a narrowly verified disposable Worker and its exact bound KV.

    `request(method,path)` is a provider client returning `(status, payload)`.
    The caller must pass the exact KV ID returned by its own CREATE response;
    a title match alone is not sufficient authorization for destructive cleanup.
    """
    if not isinstance(worker,str) or not WORKER_SCOPE.fullmatch(worker):
        raise CleanupGuardError('SCRIPT_NAME_NOT_DISPOSABLE')
    if namespace is not None and (not isinstance(namespace,str) or not KV_ID.fullmatch(namespace)):
        raise CleanupGuardError('KV_ID_NOT_ATTESTED')
    if pause is None:pause=time.sleep
    result={'worker_absent':False,'namespace_absent':False,
            'namespace_retained_for_safety':False,'exact_script_delete_proven':False,
            'exact_kv_delete_proven':False}
    script='/workers/scripts/'+worker

    def data(path):
        status,payload=request('GET',path)
        if status!=200 or not isinstance(payload,dict) or payload.get('success') is not True:
            raise CleanupGuardError('PROVIDER_READBACK_UNAVAILABLE')
        return payload.get('result')

    domain_rows=data('/workers/domains')
    if not isinstance(domain_rows,list):raise CleanupGuardError('DOMAIN_INVENTORY_NOT_LIST')
    for host,service in PROTECTED.items():
        if sum(x.get('hostname')==host and x.get('service')==service
               for x in domain_rows if isinstance(x,dict))!=1:
            raise CleanupGuardError('PRODUCTION_DOMAIN_SCOPE_CHANGED')
    if any(x.get('service')==worker for x in domain_rows if isinstance(x,dict)):
        raise CleanupGuardError('TEMP_SCRIPT_HAS_DOMAIN')

    status,_=request('GET',script)
    if status==200:
        bindings=data(script+'/settings')
        if not isinstance(bindings,dict) or not isinstance(bindings.get('bindings'),list):
            raise CleanupGuardError('DISPOSABLE_BINDINGS_UNKNOWN')
        b=bindings['bindings']
        if len(b)!=2 or {(x.get('name'),x.get('type')) for x in b if isinstance(x,dict)} != {
            ('STUDIO_CRON_PITR','durable_object_namespace'),
            ('STUDIO_PITR_RECEIPTS','kv_namespace')
        }:
            raise CleanupGuardError('DISPOSABLE_BINDINGS_NOT_EXACT')
        kv_bind=next(x for x in b if x.get('name')=='STUDIO_PITR_RECEIPTS')
        if namespace is None or kv_bind.get('namespace_id')!=namespace:
            raise CleanupGuardError('DISPOSABLE_KV_BINDING_MISMATCH')
        code,body=request('DELETE',script)
        if code not in (200,202) or not isinstance(body,dict) or body.get('success') is not True:
            raise CleanupGuardError('EXACT_TEMP_WORKER_DELETE_FAILED')
        result['exact_script_delete_proven']=True
    elif status!=404:
        raise CleanupGuardError('DISPOSABLE_SCRIPT_STATUS_UNKNOWN')

    for i in range(5):
        code,_=request('GET',script)
        if code==404:
            result['worker_absent']=True
            break
        if i<4:pause(2)
    if not result['worker_absent']:
        # Preserving the KV namespace avoids leaving a live Worker attached
        # to a deleted binding, as happened in the earlier failed V2 attempt.
        result['namespace_retained_for_safety']=namespace is not None
        return result

    if namespace is None:
        result['namespace_absent']=True
    else:
        kv_path='/storage/kv/namespaces/'+namespace
        code,body=request('DELETE',kv_path)
        if code not in (200,202) or not isinstance(body,dict) or body.get('success') is not True:
            raise CleanupGuardError('EXACT_TEMP_KV_DELETE_FAILED')
        result['exact_kv_delete_proven']=True
        for i in range(5):
            code,_=request('GET',kv_path)
            if code==404:
                result['namespace_absent']=True
                break
            if i<4:pause(2)
    return result


def categorize_deploy_failure(output):
    """Reduce untrusted Wrangler output to an allowlisted code; never log text."""
    low=str(output).lower()[:100000]
    if any(x in low for x in ('migration','new_sqlite_classes','class_name')):
        return 'DURABLE_OBJECT_MIGRATION'
    if any(x in low for x in ('authentication','insufficient scope','unauthorized',
                             'permission denied','error code: 10000','error: 10000')):
        return 'AUTH_SCOPE'
    if any(x in low for x in ('kv_namespace','kv namespace','binding')):
        return 'BINDING_CONFIGURATION'
    if any(x in low for x in ('connection refused','timed out','tls','econnreset')):
        return 'NETWORK_ERROR'
    if any(x in low for x in ('rate limit','429','too many requests')):
        return 'RATE_LIMITED'
    return 'UNCLASSIFIED'

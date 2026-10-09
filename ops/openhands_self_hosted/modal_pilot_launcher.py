"""Signature-gated Modal Sandbox launcher; NEVER invoked by CI or on push.

The sandbox is an external reversible S3 write. A valid preexisting
independent FA-11 human-approved signature is mandatory. An in-memory SDK
mock result is not live qualification and cannot certify a release.
"""
import hashlib
import hmac
import json
import math
import re
import time

from modal_pilot_spec import plan_pilot, PilotPlanDenied


class ProvisioningNotAuthorized(RuntimeError):
    pass


_SIG=re.compile(r'^[a-f0-9]{64}$')
_FIELDS=frozenset({
    'schema','plan_sha256','risk_class','operation','builder_id',
    'independent_human_approver_id','not_before_unix','expires_unix',
    'production_authority','release_authority','certification_authority',
})
_ID=re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,100}$')


def _deny(reason):
    raise ProvisioningNotAuthorized(reason)


def _canonical(value):
    try:
        return json.dumps(value,sort_keys=True,separators=(',',':'),
                          ensure_ascii=True,allow_nan=False).encode('utf-8')
    except (TypeError,ValueError,OverflowError):
        _deny('S3 authorization envelope cannot be serialized')


def _revalidate_plan(plan):
    if type(plan) is not dict or not isinstance(plan.get('canonical_plan_json'),str):
        _deny('pilot plan envelope invalid')
    try:
        original=json.loads(plan['canonical_plan_json'])
        scope=original['scope']
        limits=original['resource_limits']
        expected=plan_pilot(
            tenant_id=scope['tenant_id'], project_id=scope['project_id'],
            work_id=scope['work_id'], workload_id=scope['workload_id'],
            image=scope['image'], ingress_cidr=scope['ingress_cidr'],
            cpu=limits['cpu'], memory_mib=limits['memory_mib'],
            timeout_seconds=limits['timeout_seconds'],
        )
    except (ValueError,KeyError,TypeError,PilotPlanDenied):
        _deny('pilot target plan cannot be independently reconstructed')
    if type(plan)!=type(expected) or plan!=expected:
        _deny('pilot plan drifted from independently hashed resource scope')
    return expected


def _approve(plan,approval,signature,independent_signing_key,now):
    if type(independent_signing_key) is not bytes or len(independent_signing_key)<32:
        _deny('independent gateway signing key unavailable')
    if type(approval) is not dict or set(approval)!=_FIELDS:
        _deny('operation-scoped provisioning approval invalid')
    if type(signature) is not str or not _SIG.fullmatch(signature):
        _deny('operation-scoped provisioning signature invalid')
    observed=hmac.new(independent_signing_key,_canonical(approval),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(observed,signature):
        _deny('operation-scoped provisioning authority signature mismatch')
    if (approval['schema']!='musitu.axiom.trackb.modal-provision-approval.v1' or
        approval['plan_sha256']!=plan['plan_sha256'] or
        approval['risk_class']!='S3' or
        approval['operation']!='PROVISION_ISOLATED_MODAL_SANDBOX'):
        _deny('provisioning plan/risk/operation authority mismatch')
    for field in ('builder_id','independent_human_approver_id'):
        value=approval[field]
        if type(value) is not str or not _ID.fullmatch(value):
            _deny('provisioning identity is not verifiable')
    if approval['builder_id']==approval['independent_human_approver_id']:
        _deny('builder cannot independently approve provisioning')
    if any(approval[f] is not False for f in
           ('production_authority','release_authority','certification_authority')):
        _deny('isolated provisioning cannot grant release or production authority')
    start=approval['not_before_unix']
    expiry=approval['expires_unix']
    if (type(start) is not int or type(expiry) is not int or
        not 0<expiry-start<=60 or type(now) not in (int,float) or
        not math.isfinite(now) or not start<=now<expiry):
        _deny('provisioning authorization expired or not active')


def launch_approved_pilot(*,plan,approval,signature,independent_signing_key,
                          modal_sdk,isolated_app,pinned_image,
                          ephemeral_session_secret,clock=time.time):
    normalized=_revalidate_plan(plan)
    _approve(normalized,approval,signature,independent_signing_key,clock())
    if (modal_sdk is None or not callable(getattr(getattr(modal_sdk,'Sandbox',None),'create',None))
        or isolated_app is None or pinned_image is None or ephemeral_session_secret is None):
        _deny('pre-provisioned isolated app/image and ephemeral worker session required')
    kwargs=dict(normalized['sandbox_kwargs'])
    kwargs['tags']=dict(kwargs['tags'])
    kwargs['secrets']=[ephemeral_session_secret]
    kwargs['app']=isolated_app
    kwargs['image']=pinned_image
    # This is the ONLY S3 operation in the launcher. Never call from
    # a workflow receiving only a builder-controlled boolean.
    sandbox=None
    try:
        sandbox=modal_sdk.Sandbox.create(*normalized['command'],**kwargs)
        sandbox_id=getattr(sandbox,'object_id',None)
        if type(sandbox_id) is not str or not _ID.fullmatch(sandbox_id):
            raise RuntimeError('sandbox did not supply a valid opaque ID')
        if not callable(getattr(sandbox,'poll',None)) or sandbox.poll() is not None:
            raise RuntimeError('sandbox not running after create')
    except Exception:
        if sandbox is not None:
            try: sandbox.terminate(wait=False)
            except Exception: pass
        raise ProvisioningNotAuthorized('isolated provisioning failed; no qualification granted') from None
    return {
        'schema':'musitu.axiom.trackb.modal-pilot-provisioning-receipt.v1',
        'plan_sha256':normalized['plan_sha256'],
        'sandbox_id':sandbox_id,
        'provider':'Modal',
        'provider_status':'RUNNING_REPORTED_BY_SDK_UNVERIFIED',
        'external_action_executed':True,
        'independent_sandbox_readback':'NOT_PROVEN',
        'live_runtime_qualification':'NOT_PROVEN',
        'release_authority':False,
        'production_authority':False,
        'certification_authority':False,
    }

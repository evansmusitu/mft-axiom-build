"""Target-only self-hosted OpenHands Modal Sandbox plan; ZERO cloud operations.

This specifies a candidate in Modal Python SDK 1.6.1 terms, not a deployment.
S3 provisioning requires independent authorization, a sealed image, ephemeral
session credential broker, test admission and cloud budget approval.
"""
import hashlib
import ipaddress
import json
import re


class PilotPlanDenied(ValueError):
    pass


_IMAGE=re.compile(r'^ghcr\.io/openhands/agent-server@sha256:[0-9a-f]{64}$')
_SCOPE=re.compile(r'^[a-z][a-z0-9_-]{2,63}$')
_RESERVED={'prod','production','main','root','admin','system'}
_SCHEMA='musitu.axiom.trackb.modal-pilot-spec.v1'


def _scope(name,value):
    if (type(value) is not str or not _SCOPE.fullmatch(value) or
            value in _RESERVED or '..' in value):
        raise PilotPlanDenied(name+' is not an isolated scope')
    return value


def _exact_ingress(cidr):
    if type(cidr) is not str:
        raise PilotPlanDenied('explicit operator ingress IP /32 required')
    try:
        network=ipaddress.ip_network(cidr,strict=True)
    except ValueError:
        raise PilotPlanDenied('ingress must be a valid IPv4 /32 address') from None
    if (network.version!=4 or network.prefixlen!=32 or
            network.is_private or network.is_loopback or
            network.is_multicast or network.is_unspecified):
        raise PilotPlanDenied('ingress must be an explicit non-private IPv4 /32')
    return cidr


def plan_pilot(*, tenant_id,project_id,work_id,workload_id,image,
               ingress_cidr,cpu=1.0,memory_mib=2048,timeout_seconds=300):
    tenant_id=_scope('tenant_id',tenant_id)
    project_id=_scope('project_id',project_id)
    work_id=_scope('work_id',work_id)
    workload_id=_scope('workload_id',workload_id)
    if type(image) is not str or not _IMAGE.fullmatch(image):
        raise PilotPlanDenied('immutable verified OpenHands agent-server image digest required')
    ingress_cidr=_exact_ingress(ingress_cidr)
    if (type(cpu) not in (int,float) or not 0.5<=cpu<=2.0 or
            type(memory_mib) is not int or not 512<=memory_mib<=4096 or
            type(timeout_seconds) is not int or not 60<=timeout_seconds<=900):
        raise PilotPlanDenied('resource/budget ceiling invalid')
    bound={'tenant_id':tenant_id,'project_id':project_id,'work_id':work_id,
           'workload_id':workload_id,'image':image,'ingress_cidr':ingress_cidr}
    name='axiom-oh-b1-'+hashlib.sha256(
        json.dumps(bound,sort_keys=True,separators=(',',':')).encode()
    ).hexdigest()[:16]
    command=['python','-m','openhands.agent_server','--host','0.0.0.0','--port','18765']
    kwargs={
        'name':name,
        'tags':{'axiom_track':'trackb-isolated','qualification':'S0_NO_EXTERNAL_MODEL'},
        'cpu':(float(cpu),float(cpu)),
        'memory':(memory_mib,memory_mib),
        'timeout':timeout_seconds,
        'idle_timeout':min(120,timeout_seconds),
        # Tunnel access and egress policy still require live Modal-native proof.
        'encrypted_ports':[18765],
        'unencrypted_ports':[],
        'inbound_cidr_allowlist':[ingress_cidr],
        'outbound_cidr_allowlist':[],
        'outbound_domain_allowlist':[],
        'block_network':False,
        'secrets':[],
        'env':{'AXIOM_ISOLATED_QUALIFICATION':'TRUE',
               'OH_ENABLE_VSCODE':'0','OH_PRELOAD_TOOLS':'0'},
        'pty':False,
    }
    # No secret/credential fields or provider handles in the canonical record.
    canonical={
        'schema':_SCHEMA,'scope':bound,'name':name,
        'command':command,
        'resource_limits':{'cpu':float(cpu),'memory_mib':memory_mib,
                           'timeout_seconds':timeout_seconds,
                           'idle_timeout_seconds':kwargs['idle_timeout']},
        'network':{'encrypted_port':18765,'inbound_operator_cidr':ingress_cidr,
                   'outbound_cidr_allowlist':[],'outbound_domain_allowlist':[]},
        'mode':'TARGET_ONLY_NO_DEPLOYMENT',
    }
    serialized=json.dumps(canonical,sort_keys=True,separators=(',',':'),ensure_ascii=True)
    return {
        'schema':_SCHEMA,
        'image':image,
        'command':command,
        'sandbox_kwargs':kwargs,
        'canonical_plan_json':serialized,
        'plan_sha256':hashlib.sha256(serialized.encode()).hexdigest(),
        'required_next_gate':'INDEPENDENT_S3_PROVISIONING_AUTHORIZATION',
        'deployment_authorized':False,
        'runtime_activation_authorized':False,
        'external_action_executed':False,
        'live_runtime_qualification':'NOT_PROVEN',
        'release_authority':False,
        'production_authority':False,
        'certification_authority':False,
    }

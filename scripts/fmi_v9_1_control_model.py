#!/usr/bin/env python3
"""Pure fail-closed promotion state machine. No network I/O; production executor must implement this exact order."""
from dataclasses import dataclass,field

@dataclass
class State:
    rights_ready: bool
    live_edge_exact: bool=True
    private_names_safe: bool=True
    operations:list=field(default_factory=list)
    snapshots:dict=field(default_factory=dict)
    rollback:list=field(default_factory=list)

def execute(s:State, fail_at:str|None=None):
    if not s.rights_ready: return {'status':'BLOCKED_RIGHTS','mutations':0,'ops':[],'rollback':[]}
    if not s.live_edge_exact: return {'status':'BLOCKED_LIVE_DRIFT','mutations':0,'ops':[],'rollback':[]}
    if not s.private_names_safe: return {'status':'BLOCKED_NAME_COLLISION','mutations':0,'ops':[],'rollback':[]}
    try:
        s.snapshots={'edge_source':'EXACT_BYTES','edge_settings':'EXACT_SETTINGS','router_previous':'ABSENT_OR_EXACT','provider_previous':'ABSENT_OR_EXACT'}
        sequence=[
          'deploy_provider_private','write_provider_secret','disable_provider_workers_dev_and_previews','verify_provider_source_settings_privacy',
          'deploy_router_private','bind_router_primary_to_provider','disable_router_workers_dev_and_previews','verify_router_source_settings_privacy',
          'snapshot_public_edge_bindings','patch_public_edge_add_FMI_MARKET_DATA','verify_public_edge_binding',
          'content_put_v9_edge','verify_edge_source_workspace_billing_adapter','functional_market_context_probe'
        ]
        for op in sequence:
            s.operations.append(op)
            if fail_at==op: raise RuntimeError(op)
        return {'status':'PROMOTED_VERIFIED','mutations':len(s.operations),'ops':s.operations,'rollback':[]}
    except Exception:
        s.rollback=['restore_public_edge_source_exact_bytes','restore_public_edge_settings_exact_snapshot','verify_v8_1_edge_and_binding_state','verify_billing_adapter_unchanged']
        return {'status':'ROLLED_BACK_VERIFIED_REQUIRED','mutations':len(s.operations),'ops':s.operations,'rollback':s.rollback}

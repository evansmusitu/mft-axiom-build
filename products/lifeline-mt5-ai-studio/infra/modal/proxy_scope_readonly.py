"""Read-only Modal workspace/proxy-scope evidence. No token creation or remote invocation.

Provider metadata cannot certify an environment-scoped Proxy Token on the
Starter plan. Never infer permission to create a workspace-wide credential.
"""
from __future__ import annotations
from decimal import Decimal, InvalidOperation
import json
from urllib.parse import urlsplit

EXPECTED_APP="lifeline-mt5-analytics-isolated"
EXPECTED_FUNCTION="private_api"
EXPECTED_STORES={"lifeline-mt5-neon-stage-unwrap-key-20261021",
                 "lifeline-mt5-bridge-probe-20261021"}

def audit_provider_readonly(modal_sdk):
    try:
        workspace=modal_sdk.Workspace.from_context()
        budget=workspace.billing.summary()
        billed=Decimal(str(budget.billed_cost))
        metered=Decimal(str(budget.metered_cost))
        if not billed.is_finite() or not metered.is_finite() or billed!=0 or not 0<=metered<=5:
            raise ValueError("no-spend evidence absent or outside guard")
        environments=list(modal_sdk.Environment.objects.list())
        if not environments:
            raise ValueError("environment inventory missing")
        names={x.name for x in modal_sdk.Secret.objects.list(max_objects=100)}
        if not EXPECTED_STORES.issubset(names):
            raise ValueError("named LIFELINE secret stores not found")
        url=modal_sdk.Function.from_name(EXPECTED_APP,EXPECTED_FUNCTION).get_web_url()
        endpoint=urlsplit(url or "")
        if (endpoint.scheme!="https" or not endpoint.hostname or
            not endpoint.hostname.endswith(".modal.run") or
            endpoint.username or endpoint.password or endpoint.query or
            endpoint.fragment or endpoint.port is not None):
            raise ValueError("LIFELINE isolated Modal HTTPS endpoint missing")
        # Modal SDK returns proxy TOKEN IDENTIFIERS, not reusable secret values.
        # Never serialize the objects or inspect token IDs, names, membership,
        # descriptions, other environment names, user identities or secret texts.
        tokens=list(workspace.proxy_tokens.list())
        if any(getattr(x,"token_secret",None) for x in tokens):
            raise ValueError("unexpected secret in control-plane metadata")
    except Exception:
        raise RuntimeError("read-only Modal isolation evidence unavailable") from None
    return {
        "schema":"lifeline.modal_proxy_scope_readonly.v1",
        "existing_private_endpoint_qualified":True,
        "lifeline_named_secret_stores_present":True,
        "workspace_environment_count":len(environments),
        "existing_proxy_token_count":len(tokens),
        "workspace_billed_zero_at_check":True,
        "metered_below_preflight_guard":True,
        # Neither presence of environments nor TOKEN count proves RBAC scoping.
        "environment_level_proxy_scope_verified":False,
        "free_starter_proxy_token_isolation_verified":False,
        "workspace_or_agent_credential_created":False,
        "modal_remote_function_invoked":False,
        "cloudflare_worker_changed":False,
        "private_backend_cutover_authorized":False,
        "windows_host_paired":False,
        "trading_enabled":False
    }

if __name__=="__main__":
    import modal
    print(json.dumps(audit_provider_readonly(modal),sort_keys=True))

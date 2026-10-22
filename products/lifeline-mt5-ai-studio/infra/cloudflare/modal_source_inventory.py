"""Read-only prerequisite inventory for an owner-gated LIFELINE Cloudflare/Modal bridge.

Never reads secret *values*, creates proxy tokens, executes remote Modal
functions, changes Cloudflare bindings, deploys compute, or exposes other apps.
Exit closed when source identities are missing. For metadata only.
"""
from __future__ import annotations
import json, os, urllib.request, urllib.error
from urllib.parse import urlparse

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
APP = "71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST = "lifeline-mt5-stage.mftintelligence.com"
WORKER = "lifeline-mt5-edge-isolated"
EXPECTED_IDENTITY = {"ACCESS_ISSUER", "ACCESS_AUD", "ACCESS_OPERATOR_SUB"}
NEEDED_BACKEND = {"MODAL_ORIGIN", "MODAL_PROXY_KEY", "MODAL_PROXY_SECRET",
                  "EDGE_SHARED_SECRET", "AGENT_ID", "AGENT_TENANT", "AGENT_HMAC_KEY"}
MODAL_APP = "lifeline-mt5-analytics-isolated"
MODAL_BRIDGE = "lifeline-mt5-bridge-probe-20261021"
MODAL_UNWRAP = "lifeline-mt5-neon-stage-unwrap-key-20261021"

def get_json(path: str, bearer: str):
    req=urllib.request.Request("https://api.cloudflare.com/client/v4"+path,
      headers={"Authorization":"Bearer "+bearer,"Accept":"application/json",
      "User-Agent":"LIFELINE-Control-Plane-ReadOnly/1"},method="GET")
    try:
        with urllib.request.urlopen(req,timeout=25) as r:
            if r.status!=200:raise RuntimeError("provider read failed")
            obj=json.load(r)
    except Exception:
        raise RuntimeError("required Cloudflare metadata unavailable") from None
    if not isinstance(obj,dict) or obj.get("success") is not True:
        raise RuntimeError("Cloudflare metadata rejected")
    return obj.get("result")

def inventory(cloudflare_token: str, modal_module) -> dict:
    if len(cloudflare_token)<20:raise RuntimeError("Cloudflare auth absent")
    account=get_json("/accounts/"+ACCOUNT,cloudflare_token)
    if not isinstance(account,dict) or account.get("id")!=ACCOUNT:
        raise RuntimeError("exact Cloudflare account mismatch")
    app=get_json("/accounts/"+ACCOUNT+"/access/apps/"+APP,cloudflare_token)
    if not isinstance(app,dict) or app.get("id")!=APP or app.get("domain")!=HOST:
        raise RuntimeError("LIFELINE owner Access app mismatch")
    policies=get_json("/accounts/"+ACCOUNT+"/access/apps/"+APP+"/policies?per_page=20",cloudflare_token)
    if not isinstance(policies,list) or len(policies)!=1 or policies[0].get("decision")!="allow":
        raise RuntimeError("owner-only policy mismatch")
    mfa=policies[0].get("mfa_config") or {}
    if mfa.get("mfa_disabled") is not False or mfa.get("session_duration")!="0m":
        raise RuntimeError("owner-specific MFA policy is not enforced")
    worker_secrets=get_json("/accounts/"+ACCOUNT+"/workers/scripts/"+WORKER+"/secrets",cloudflare_token)
    if not isinstance(worker_secrets,list):raise RuntimeError("private Worker secret readback unavailable")
    names={s.get("name") for s in worker_secrets if isinstance(s,dict)}
    if names!=EXPECTED_IDENTITY:
        raise RuntimeError("existing Worker binding scope changed; refuses any assumption")
    # Modal metadata API: hydrated Secret handles provide NAMES, not secret values.
    try:
        secret_names={s.name for s in modal_module.Secret.objects.list(max_objects=100)}
        secret_ok=MODAL_BRIDGE in secret_names and MODAL_UNWRAP in secret_names
        private_url=modal_module.Function.from_name(MODAL_APP,"private_api").get_web_url()
        parsed=urlparse(private_url or "")
        origin_ok=(parsed.scheme=="https" and (parsed.hostname or "").endswith(".modal.run")
            and not parsed.username and not parsed.password)
        # Never list token IDs or names. Presence does not mean recoverable credentials.
        all_tokens=modal_module.Workspace.from_context().proxy_tokens.list()
        no_proxy_token_values_obtained=all(not getattr(t,"token_secret",None) for t in all_tokens)
    except Exception:
        raise RuntimeError("read-only Modal metadata unavailable") from None
    if not secret_ok or not origin_ok or not no_proxy_token_values_obtained:
        raise RuntimeError("Modal bridge prerequisite absent or unsafe API response")
    return {"schema":"lifeline.cloudflare_modal_secret_inventory.v1",
      "cloudflare_account_pinned":True,"access_app_pinned":True,
      "independent_owner_mfa_policy":True,"worker_identity_only":True,
      "identity_binding_count":len(EXPECTED_IDENTITY),
      "missing_backend_binding_count":len(NEEDED_BACKEND),
      "modal_bridge_named_secret_exists":True,
      "modal_unwrap_named_secret_exists":True,
      "private_modal_endpoint_metadata_valid":True,
      "modal_proxy_token_secret_available_to_runner":False,
      "paired_agent_secret_values_available_to_runner":False,
      "modal_remote_functions_invoked":False,
      "modal_deployment_attempted":False,
      "new_modal_proxy_tokens_created":False,
      "cloudflare_bindings_modified":False,
      "backend_cutover_allowed":False,
      "credentials_or_identifiers_printed":False}

def main():
    import modal
    report=inventory(os.environ.get("CLOUDFLARE_API_TOKEN",""),modal)
    print(json.dumps(report,sort_keys=True))

if __name__=="__main__":main()

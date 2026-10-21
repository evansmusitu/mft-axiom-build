"""Fail-closed, account-scoped, read-only Cloudflare Access and D1 inventory.

Never prints tokens, IDs of apps/users, hostnames except the intended hostname,
JWTs, emails, full responses, or credential-bearing HTTP error bodies. Makes GET
requests only. No provisioning, writes, authentication-policy edits or deployments.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
DOMAIN = "mftintelligence.com"
CANDIDATE = "workspace.mftintelligence.com"
OUTFILE = "musitu-cloud-workspace-readonly-assessment.json"
BASE = "https://api.cloudflare.com/client/v4"


def request_json(path, token):
    assert path.startswith("/") and ".." not in path
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            if resp.status != 200:
                raise RuntimeError("HTTP_" + str(resp.status))
            data = resp.read(1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        # No error body is ever printed; Cloudflare errors could contain details.
        raise RuntimeError("HTTP_" + str(error.code)) from None
    except urllib.error.URLError:
        raise RuntimeError("NETWORK_UNAVAILABLE") from None
    if len(data) > 1024 * 1024:
        raise RuntimeError("RESPONSE_TOO_LARGE")
    try:
        value = json.loads(data)
        if value.get("success") is not True or not isinstance(value.get("result"), list):
            raise RuntimeError("API_RESPONSE_INVALID")
        return value["result"]
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError("API_JSON_INVALID") from None


def main():
    if os.environ.get("EXPECTED_ACCOUNT_ID") != ACCOUNT or os.environ.get("EXPECTED_DOMAIN") != DOMAIN:
        print("REFUSED: canonical account and zone invariants not met")
        return 2
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("BLOCKED: existing Cloudflare token is not available in this workflow")
        return 3
    output = {
        "schema": "musitu.cloud_workspace.readonly_inventory.v1",
        "account_id": ACCOUNT,
        "domain": DOMAIN,
        "candidate_private_hostname": CANDIDATE,
        "write_performed": False,
        "deployment_performed": False,
        "access_mfa_verified": False,
        "private_origin_browser_verified": False,
        "d1_membership_provisioned": False,
        "actual_workspace_deployment_qualified": False,
        "results": {},
    }
    zone_path = "/zones?" + urllib.parse.urlencode({"name": DOMAIN, "per_page": 50})
    paths = {
        "zone": zone_path,
        "access_apps": f"/accounts/{ACCOUNT}/access/apps?per_page=100",
        "d1_databases": f"/accounts/{ACCOUNT}/d1/database?per_page=100",
    }
    overall = True
    for label, path in paths.items():
        try:
            rows = request_json(path, token)
            if label == "zone":
                owned = [x for x in rows if x.get("name") == DOMAIN and
                         (x.get("account") or {}).get("id") == ACCOUNT]
                valid = len(owned) == 1 and owned[0].get("status") == "active"
                output["results"][label] = {"readable": True, "canonical_zone_active": valid}
                if not valid:
                    overall = False
            elif label == "access_apps":
                matches = [app for app in rows if str(app.get("domain", "")).lower() == CANDIDATE or
                           any(d.get("hostname") == CANDIDATE for d in (app.get("self_hosted_domains") or [])
                               if isinstance(d, dict))]
                output["results"][label] = {
                    "readable": True,
                    "existing_apps_on_candidate_hostname": len(matches),
                    # The API inventory alone NEVER proves a valid MFA policy.
                    "mfa_policy_verified": False,
                }
            elif label == "d1_databases":
                matches = [db for db in rows if db.get("name") == "musitu-cloud-workspaces-private"]
                output["results"][label] = {
                    "readable": True,
                    "existing_dedicated_named_databases": len(matches),
                    "database_binding_and_isolation_verified": False,
                }
        except RuntimeError as error:
            output["results"][label] = {"readable": False, "failure": str(error)}
            overall = False
    with open(OUTFILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, sort_keys=True, indent=2)
        fh.write("\n")
    print("Read-only account inspection:", json.dumps(output["results"], sort_keys=True))
    print("NO WRITES, NO DEPLOYMENT; PRIVATE WORKSPACE QUALIFICATION REMAINS FALSE")
    return 0 if overall else 4


if __name__ == "__main__":
    sys.exit(main())

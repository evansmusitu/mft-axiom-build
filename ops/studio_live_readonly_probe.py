"""Read-only MUSITU Studio account inventory. No provider mutating endpoints or compute calls."""
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

CF = "https://api.cloudflare.com/client/v4"
STUDIO_DB = "musitu-studio-v02"
STUDIO_BUCKET = "musitu-studio-v02-assets"
STUDIO_MODAL = "musitu-studio-v02"


def cloudflare(env):
    aid = env.get("STUDIO_CF_ACCOUNT_ID", "")
    email = env.get("CLOUDFLARE_EMAIL", "")
    api_key = env.get("CLOUDFLARE_GLOBAL_API_KEY", "")
    if not re.fullmatch("[a-fA-F0-9]{32}", aid):
        return {"status": "ACCOUNT_ID_NOT_CONFIGURED"}
    if not email or not api_key:
        return {"status": "CREDENTIALS_NOT_AVAILABLE_IN_THIS_REPOSITORY"}
    headers = {
        "X-Auth-Email": email,
        "X-Auth-Key": api_key,
        "Accept": "application/json",
        "User-Agent": "MUSITU-Studio-ReadOnly-Inventory/0.1",
    }

    def get(endpoint):
        assert endpoint.startswith("/accounts/" + aid + "/") or endpoint == "/accounts/" + aid
        req = urllib.request.Request(CF + endpoint, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=22) as r:
            if r.status != 200:
                raise ValueError("HTTP_NOT_200")
            document = json.load(r)
        if not isinstance(document, dict) or document.get("success") is not True:
            raise ValueError("PROVIDER_REJECTED")
        return document.get("result")

    out = {"status": "CANNOT_VERIFY", "account_verified": False}
    try:
        obj = get("/accounts/" + aid)
        if not isinstance(obj, dict) or obj.get("id", "").lower() != aid.lower():
            return {"status": "ACCOUNT_ID_MISMATCH", "account_verified": False}
        out = {"status": "READ_ONLY_AUTH_OK", "account_verified": True}
    except (OSError, TypeError, KeyError, ValueError, urllib.error.URLError):
        return out

    try:
        records = get("/accounts/" + aid + "/d1/database?per_page=100")
        databases = records.get("databases", []) if isinstance(records, dict) else records
        if not isinstance(databases, list):
            raise ValueError("UNEXPECTED_D1_SHAPE")
        out["d1_read"] = "READ_ONLY_OK"
        out["studio_d1_exists"] = any(isinstance(x, dict) and x.get("name") == STUDIO_DB for x in databases)
    except (OSError, TypeError, KeyError, ValueError, urllib.error.URLError):
        out["d1_read"] = "CANNOT_VERIFY"

    try:
        records = get("/accounts/" + aid + "/r2/buckets?per_page=100")
        buckets = records.get("buckets", []) if isinstance(records, dict) else records
        if not isinstance(buckets, list):
            raise ValueError("UNEXPECTED_R2_SHAPE")
        out["r2_read"] = "READ_ONLY_OK"
        out["studio_r2_exists"] = any(isinstance(x, dict) and x.get("name") == STUDIO_BUCKET for x in buckets)
    except (OSError, TypeError, KeyError, ValueError, urllib.error.URLError):
        out["r2_read"] = "CANNOT_VERIFY"

    return out


def modal_inventory(env):
    if not (env.get("MODAL_TOKEN_ID") and env.get("MODAL_TOKEN_SECRET")):
        return {"status": "CREDENTIALS_NOT_AVAILABLE_IN_THIS_REPOSITORY"}
    envvars = dict(os.environ)
    envvars["MODAL_TOKEN_ID"] = env["MODAL_TOKEN_ID"]
    envvars["MODAL_TOKEN_SECRET"] = env["MODAL_TOKEN_SECRET"]
    try:
        result = subprocess.run([sys.executable, "-m", "modal", "app", "list", "--json"],
                                env=envvars, capture_output=True, text=True,
                                timeout=40, check=False)
        if result.returncode != 0:
            return {"status": "CANNOT_VERIFY"}
        obj = json.loads(result.stdout)
        entries = obj if isinstance(obj, list) else obj.get("apps", [])
        if not isinstance(entries, list):
            return {"status": "CANNOT_VERIFY"}
        return {
            "status": "READ_ONLY_AUTH_OK",
            "studio_modal_app_exists": any(
                isinstance(x, dict) and x.get("name") == STUDIO_MODAL for x in entries
            ),
        }
    except (OSError, TypeError, ValueError, subprocess.TimeoutExpired):
        return {"status": "CANNOT_VERIFY"}


def run():
    record = {
        "schema": "musitu.studio.live-provider-readonly.v1",
        "read_only": True,
        "deployment_authorized": False,
        "render_authorized": False,
        "provider_zero_charge_cap_verified": False,
        "billing_mutated": False,
        "provider_mutation_performed": False,
        "cloudflare": cloudflare(os.environ),
        "modal": modal_inventory(os.environ),
    }
    pathlib.Path("studio-provider-readonly.json").write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print("STUDIO_LIVE_READ_ONLY_INVENTORY=" + json.dumps(record, sort_keys=True))
    return record


if __name__ == "__main__":
    run()

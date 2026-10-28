"""Read-only feasibility check for MUSITU's Databricks Unity Gateway MCP pilot.

No compute, secret creation, service registration, connection writes or production
Axiom calls. Exposes only redacted counts and HTTP status classifications.
"""
from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HOST = "https://dbc-3179c56f-a6c7.cloud.databricks.com"
PATHS = {
    "catalogs": "/api/2.1/unity-catalog/catalogs",
    "builtin_mcp": "/api/2.1/unity-catalog/mcp-services?" + urlencode({
        "parent": "schemas/system.ai", "view": "BASIC", "page_size": "20",
    }),
    "pilot_mcp": "/api/2.1/unity-catalog/mcp-services?" + urlencode({
        "parent": "schemas/main.default", "view": "BASIC", "page_size": "20",
    }),
}


def build_path(name: str) -> str:
    if name not in PATHS:
        raise ValueError("Non-allowlisted Databricks readiness operation")
    return PATHS[name]


def classify_response(status: int) -> str:
    return {
        200: "ACCESSIBLE",
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        429: "RATE_LIMITED",
    }.get(status, "REMOTE_ERROR")


def summarize(results: dict) -> dict:
    catalog_code, catalog_data = results.get("catalogs", (500, {}))
    builtin_code, builtin_data = results.get("builtin_mcp", (500, {}))
    pilot_code, pilot_data = results.get("pilot_mcp", (500, {}))
    cats = catalog_data.get("catalogs") if catalog_code == 200 and isinstance(catalog_data, dict) else []
    builtin = builtin_data.get("mcp_services") if builtin_code == 200 and isinstance(builtin_data, dict) else []
    pilots = pilot_data.get("mcp_services") if pilot_code == 200 and isinstance(pilot_data, dict) else []
    if not isinstance(cats, list):
        cats = []
    if not isinstance(builtin, list):
        builtin = []
    if not isinstance(pilots, list):
        pilots = []
    main_visible = any(isinstance(x, dict) and x.get("name") == "main" for x in cats)
    return {
        "probe_schema": "musitu.axiom.databricks.unity-readiness.v1",
        "read_only": True,
        "catalogs_status": classify_response(catalog_code),
        "catalog_count_first_page": len(cats),
        "main_catalog_visible": main_visible,
        "built_in_mcp_status": classify_response(builtin_code),
        "built_in_mcp_count": len(builtin),
        "pilot_mcp_status": classify_response(pilot_code),
        "pilot_mcp_count": len(pilots),
        # APIs do not establish CREATE SERVICE or CREATE CONNECTION grants.
        "can_claim_registration_ready": False,
        "metastore_grants_checked": False,
        "model_serving_region_checked": False,
        "external_egress_checked": False,
        "axiom_service_identity_admitted": False,
        "service_created": False,
    }


def read_api(token: str, operation: str) -> tuple[int, object]:
    if not token or "\r" in token or "\n" in token:
        raise ValueError("Missing or malformed workspace credential")
    path = build_path(operation)
    request = Request(
        HOST + path, method="GET",
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=25) as response:
            code = response.status
            if code != 200:
                return code, {}
            raw = response.read(100_000)
            try:
                return code, json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return code, {}
    except HTTPError as error:
        # Refuse to echo response body, HTTP headers or caller identity.
        return error.code, {}
    except URLError:
        return 503, {}


def main() -> int:
    if os.environ.get("GITHUB_REF") != "refs/heads/pilot/axiom-databricks-pat-20261027":
        raise RuntimeError("Readiness probe restricted to isolated branch")
    token = os.environ["DATABRICKS_TOKEN"]
    observations = {key: read_api(token, key) for key in PATHS}
    result = summarize(observations)
    print("MUSITU_DATABRICKS_UNITY_READINESS_PROBED")
    print("MUSITU_DATABRICKS_UNITY_READINESS=" + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print("MUSITU_DATABRICKS_UNITY_READINESS_FAILED:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)

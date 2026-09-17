#!/usr/bin/env python3
"""Read-only Cloudflare evidence collector for MUSITU Axiom AR-02.

This utility is intentionally incapable of provider mutation. It issues only
HTTP GET requests, keeps raw provider identifiers in memory, and emits a
redacted evidence summary containing only booleans, names already frozen in
AR-02 contracts, counts, and SHA-256 fingerprints of provider identifiers.

It does not deploy, create, update, delete, query D1 data, change billing, or
claim AR-02 completion. Cloud isolation and free-tier headroom remain NOT_PROVEN
until their dedicated gates are independently satisfied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API_ROOT = "https://api.cloudflare.com/client/v4"
USER_AGENT = "musitu-axiom-ar02-readonly-evidence/1.0"

EXPECTED = {
    "staging": {
        "d1": "musitu-axiom-ar02-staging",
        "r2": "musitu-axiom-ar02-staging-artifacts",
        "queue": "musitu-axiom-ar02-staging-tasks",
        "workflow": "musitu-axiom-ar02-staging-orchestrator",
    },
    "canary": {
        "d1": "musitu-axiom-ar02-canary",
        "r2": "musitu-axiom-ar02-canary-artifacts",
        "queue": "musitu-axiom-ar02-canary-tasks",
        "workflow": "musitu-axiom-ar02-canary-orchestrator",
    },
}

PRODUCTION_D1_NAMES = {"musitu-axiom-prod", "mft-axiom-prod"}
PRODUCTION_D1_IDS = {
    "504029cc-f9a5-495e-818f-63c6144b4ea4",
    "4a62b374-7232-4103-b201-34443c467382",
}
MUTATION_PERMISSION_MARKERS = (" write", " edit", " revoke")


class EvidenceError(RuntimeError):
    """Fail-closed provider evidence error."""


def fingerprint(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _json_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{context} must be a JSON object")
    return value


def _result_list(payload: dict[str, Any], context: str) -> list[dict[str, Any]]:
    result = payload.get("result")
    if not isinstance(result, list):
        raise EvidenceError(f"{context} result must be a list")
    rows: list[dict[str, Any]] = []
    for item in result:
        if not isinstance(item, dict):
            raise EvidenceError(f"{context} contains a non-object result")
        rows.append(item)
    return rows


def _r2_buckets(payload: dict[str, Any]) -> list[dict[str, Any]]:
    result = payload.get("result")
    if not isinstance(result, dict):
        raise EvidenceError("R2 result must be an object")
    buckets = result.get("buckets")
    if not isinstance(buckets, list):
        raise EvidenceError("R2 result.buckets must be a list")
    rows: list[dict[str, Any]] = []
    for item in buckets:
        if not isinstance(item, dict):
            raise EvidenceError("R2 bucket entry must be an object")
        rows.append(item)
    return rows


def _exact_one(rows: list[dict[str, Any]], field: str, expected: str, context: str) -> dict[str, Any]:
    matches = [row for row in rows if row.get(field) == expected]
    if len(matches) != 1:
        raise EvidenceError(f"{context} expected exactly one {expected!r}, found {len(matches)}")
    return matches[0]


def _provider_id(row: dict[str, Any], fields: tuple[str, ...], context: str) -> str:
    for field in fields:
        value = row.get(field)
        if isinstance(value, str) and value:
            return value
    raise EvidenceError(f"{context} did not expose a provider identifier")


class CloudflareReadClient:
    def __init__(self, account_id: str, token: str, timeout_seconds: int = 20):
        if not account_id or len(account_id) != 32:
            raise EvidenceError("Cloudflare account ID must be a 32-character identifier")
        if not token:
            raise EvidenceError("CLOUDFLARE_AR02_READ_TOKEN is required")
        self.account_id = account_id
        self._token = token
        self.timeout_seconds = timeout_seconds
        self.requests_made: list[str] = []

    def get(self, path: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
        expected_prefix = f"/accounts/{self.account_id}/"
        if not path.startswith(expected_prefix):
            raise EvidenceError("provider path escaped the authorized account scope")
        query_string = urllib.parse.urlencode(query or {}, doseq=True)
        url = API_ROOT + path + ("?" + query_string if query_string else "")
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
            method="GET",
        )
        self.requests_made.append(path)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:2000]
            raise EvidenceError(f"Cloudflare GET {path} failed with HTTP {exc.code}: {body}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise EvidenceError(f"Cloudflare GET {path} failed: {exc}") from exc
        payload = _json_object(payload, path)
        if payload.get("success") is not True:
            raise EvidenceError(f"Cloudflare GET {path} returned success!=true")
        return payload


def _subscription_status(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"status": "NOT_PROVEN", "subscription_count": 0, "nonzero_price_observed": False}
    prices: list[float] = []
    missing_price = False
    for row in rows:
        price = row.get("price")
        if isinstance(price, (int, float)):
            prices.append(float(price))
        else:
            missing_price = True
    nonzero = any(price > 0 for price in prices)
    if nonzero:
        status = "NONZERO_PRICE_OBSERVED"
    elif prices and not missing_price:
        status = "PROVEN_ZERO_PRICE_SUBSCRIPTIONS"
    else:
        status = "NOT_PROVEN"
    return {
        "status": status,
        "subscription_count": len(rows),
        "nonzero_price_observed": nonzero,
        "rate_plan_ids": sorted(
            {
                str(row.get("rate_plan", {}).get("id"))
                for row in rows
                if isinstance(row.get("rate_plan"), dict) and row.get("rate_plan", {}).get("id")
            }
        ),
    }


def _token_scope_status(client: CloudflareReadClient, token_id: str | None) -> dict[str, Any]:
    if not token_id:
        return {"status": "NOT_PROVEN", "reason": "CLOUDFLARE_AR02_TOKEN_ID_NOT_SUPPLIED"}
    payload = client.get(f"/accounts/{client.account_id}/tokens/{token_id}")
    token = _json_object(payload.get("result"), "token details result")
    policies = token.get("policies")
    if not isinstance(policies, list) or not policies:
        return {"status": "NOT_PROVEN", "reason": "TOKEN_POLICIES_NOT_RETURNED"}
    allow_names: list[str] = []
    for policy in policies:
        if not isinstance(policy, dict) or policy.get("effect") != "allow":
            continue
        groups = policy.get("permission_groups")
        if not isinstance(groups, list):
            continue
        for group in groups:
            if isinstance(group, dict) and isinstance(group.get("name"), str):
                allow_names.append(group["name"])
    mutation_capable = any(
        marker in (" " + name.casefold())
        for name in allow_names
        for marker in MUTATION_PERMISSION_MARKERS
    )
    return {
        "status": "MUTATION_CAPABLE" if mutation_capable else "READ_ONLY_PROVEN",
        "allow_permission_names": sorted(set(allow_names)),
        "mutation_permission_observed": mutation_capable,
        "token_status": token.get("status"),
    }


def collect(client: CloudflareReadClient, token_id: str | None = None) -> dict[str, Any]:
    raw: dict[str, dict[str, str]] = {}
    environments: dict[str, Any] = {}

    for environment, expected in EXPECTED.items():
        d1_payload = client.get(
            f"/accounts/{client.account_id}/d1/database",
            {"name": expected["d1"], "per_page": 100},
        )
        d1 = _exact_one(_result_list(d1_payload, "D1"), "name", expected["d1"], "D1")
        d1_id = _provider_id(d1, ("uuid", "id"), "D1")

        r2_payload = client.get(
            f"/accounts/{client.account_id}/r2/buckets",
            {"name_contains": expected["r2"], "per_page": 100},
        )
        r2 = _exact_one(_r2_buckets(r2_payload), "name", expected["r2"], "R2")
        r2_identity = str(r2["name"])

        queue_payload = client.get(f"/accounts/{client.account_id}/queues")
        queue = _exact_one(_result_list(queue_payload, "Queues"), "queue_name", expected["queue"], "Queues")
        queue_id = _provider_id(queue, ("queue_id", "id"), "Queue")

        workflow_payload = client.get(
            f"/accounts/{client.account_id}/workflows",
            {"search": expected["workflow"], "per_page": 100},
        )
        workflow = _exact_one(
            _result_list(workflow_payload, "Workflows"),
            "name",
            expected["workflow"],
            "Workflows",
        )
        workflow_id = _provider_id(workflow, ("id",), "Workflow")

        raw[environment] = {
            "d1": d1_id,
            "r2": r2_identity,
            "queue": queue_id,
            "workflow": workflow_id,
        }
        environments[environment] = {
            "database_name": expected["d1"],
            "database_identity_kind": "UUID",
            "database_identity_sha256": fingerprint(d1_id),
            "artifact_bucket_name": expected["r2"],
            "artifact_bucket_identity_kind": "NAME",
            "artifact_bucket_identity_sha256": fingerprint(r2_identity),
            "queue_name": expected["queue"],
            "queue_identity_kind": "ID",
            "queue_identity_sha256": fingerprint(queue_id),
            "workflow_name": expected["workflow"],
            "workflow_identity_kind": "UUID",
            "workflow_identity_sha256": fingerprint(workflow_id),
            "provider_readback_status": "PROVEN_EXACT_MATCH",
        }

    pairwise_distinct = {
        kind: raw["staging"][kind] != raw["canary"][kind]
        for kind in ("d1", "r2", "queue", "workflow")
    }
    production_denylist_clear = (
        all(values["d1"] not in PRODUCTION_D1_IDS for values in raw.values())
        and all(EXPECTED[env]["d1"] not in PRODUCTION_D1_NAMES for env in EXPECTED)
    )

    subscriptions = _result_list(
        client.get(f"/accounts/{client.account_id}/subscriptions"),
        "Subscriptions",
    )
    plan = _subscription_status(subscriptions)
    token_scope = _token_scope_status(client, token_id)

    resource_readback_passed = all(pairwise_distinct.values()) and production_denylist_clear
    return {
        "schema": "musitu.axiom.recovery.ar02-provider-readonly-evidence.v1",
        "mode": "READ_ONLY_PROVIDER_EVIDENCE",
        "status": "PASS_PROVIDER_RESOURCE_READBACK" if resource_readback_passed else "FAIL_PROVIDER_RESOURCE_READBACK",
        "account_id_sha256": fingerprint(client.account_id),
        "http_methods_used": ["GET"],
        "request_count": len(client.requests_made),
        "environments": environments,
        "pairwise_distinct_provider_identities": pairwise_distinct,
        "production_denylist_clear": production_denylist_clear,
        "account_plan": plan,
        "account_wide_free_tier_headroom": "NOT_PROVEN",
        "credential_scope": token_scope,
        "cloud_isolation": "NOT_PROVEN",
        "runtime_rebound_off_production_d1": False,
        "cloud_restore_drill": "NOT_PERFORMED",
        "external_independent_verification": "NOT_PERFORMED",
        "production_mutated": False,
        "billing_mutated": False,
        "provider_mutation_enabled": False,
        "ar02_complete": False,
    }


def self_test() -> dict[str, Any]:
    d1 = {"success": True, "result": [{"name": EXPECTED["staging"]["d1"], "uuid": "a" * 36}]}
    r2 = {"success": True, "result": {"buckets": [{"name": EXPECTED["staging"]["r2"]}]}}
    queues = {"success": True, "result": [{"queue_name": EXPECTED["staging"]["queue"], "queue_id": "q" * 32}]}
    workflows = {"success": True, "result": [{"name": EXPECTED["staging"]["workflow"], "id": "w" * 36}]}
    assert _provider_id(_exact_one(_result_list(d1, "D1"), "name", EXPECTED["staging"]["d1"], "D1"), ("uuid",), "D1") == "a" * 36
    assert _exact_one(_r2_buckets(r2), "name", EXPECTED["staging"]["r2"], "R2")["name"] == EXPECTED["staging"]["r2"]
    assert _provider_id(_exact_one(_result_list(queues, "Queues"), "queue_name", EXPECTED["staging"]["queue"], "Queues"), ("queue_id",), "Queue") == "q" * 32
    assert _provider_id(_exact_one(_result_list(workflows, "Workflows"), "name", EXPECTED["staging"]["workflow"], "Workflows"), ("id",), "Workflow") == "w" * 36
    assert _subscription_status([{"price": 0, "rate_plan": {"id": "free"}}])["status"] == "PROVEN_ZERO_PRICE_SUBSCRIPTIONS"
    assert _subscription_status([{"price": 1, "rate_plan": {"id": "paid"}}])["status"] == "NONZERO_PRICE_OBSERVED"
    return {
        "status": "PASS_READ_ONLY_PROVIDER_HARNESS_SELF_TEST",
        "network_used": False,
        "provider_credentials_used": False,
        "production_authority": False,
        "r2_provider_identity_kind": "NAME",
        "provider_mutation_enabled": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--account-id", default=os.environ.get("CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), sort_keys=True))
        return 0

    token = os.environ.get("CLOUDFLARE_AR02_READ_TOKEN", "")
    token_id = os.environ.get("CLOUDFLARE_AR02_TOKEN_ID")
    if not args.account_id:
        raise EvidenceError("--account-id or CLOUDFLARE_ACCOUNT_ID is required")
    evidence = collect(CloudflareReadClient(args.account_id, token), token_id=token_id)
    rendered = json.dumps(evidence, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if evidence["status"] == "PASS_PROVIDER_RESOURCE_READBACK" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except EvidenceError as exc:
        print(json.dumps({"status": "FAIL_CLOSED", "error": str(exc)}), file=sys.stderr)
        sys.exit(2)

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import urllib.parse


BASE_PATH = Path(__file__).with_name("axiom_browser_application_deploy.py")
SPEC = importlib.util.spec_from_file_location("axiom_browser_application_deploy", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load canonical browser deployment module")
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)

DIRECT_RULE_REF = "musitu_axiom_browser_world_release_direct_origin_v1"
DIRECT_RULE_EXPRESSION = f'(http.host eq "{base.APP_HOST}")'


def _public_rule(row: dict) -> dict:
    return base.public_configuration_rule(row)


def validate_direct_target(topology: dict) -> dict:
    domains = topology["domains"]
    dns = topology["dns"]
    routes = topology["routes"]
    ruleset = topology.get("configuration_ruleset") or {}
    rules = topology.get("configuration_rules") or []
    if (
        not ruleset.get("id")
        or ruleset.get("phase") != "http_config_settings"
        or ruleset.get("kind") != "zone"
    ):
        raise RuntimeError("canonical zone configuration ruleset identity mismatch")

    direct = [row for row in rules if isinstance(row, dict) and row.get("ref") == DIRECT_RULE_REF]
    if len(direct) > 1:
        raise RuntimeError("duplicate direct-origin world-release configuration rules")
    same_expression = [
        row for row in rules
        if isinstance(row, dict) and row.get("expression") == DIRECT_RULE_EXPRESSION
    ]
    if same_expression and not (
        len(same_expression) == 1
        and len(direct) == 1
        and same_expression[0].get("id") == direct[0].get("id")
    ):
        raise RuntimeError("application hostname already has a different exact-host configuration rule")
    if direct:
        rule = direct[0]
        parameters = rule.get("action_parameters") or {}
        if (
            rule.get("action") != "set_config"
            or rule.get("expression") != DIRECT_RULE_EXPRESSION
            or parameters.get("security_level") != "essentially_off"
            or parameters.get("bic") is not False
            or rule.get("enabled") is False
            or not rule.get("id")
        ):
            raise RuntimeError("direct-origin world-release configuration rule differs from exact contract")

    coupled = [row for row in rules if isinstance(row, dict) and row.get("ref") == base.CONFIG_RULE_REF]
    if coupled:
        raise RuntimeError("stale apex-coupled browser configuration rule remains; refusing broader release scope")

    app_domains = base.records_by_name(domains, base.APP_HOST)
    if len(app_domains) > 1:
        raise RuntimeError("duplicate application custom-domain rows")
    if app_domains and app_domains[0].get("service") != base.SERVICE:
        raise RuntimeError("application hostname is already owned by another Worker")
    app_dns = [row for row in dns if isinstance(row, dict) and row.get("name") == base.APP_HOST]
    if not app_domains and app_dns:
        raise RuntimeError("application hostname already has DNS records; refusing origin override")

    reserved = base.records_by_name(domains, base.RESERVED_API_HOST)
    if len(reserved) != 1:
        raise RuntimeError("reserved production API domain authority is missing or duplicated")
    if reserved[0].get("service") == base.SERVICE:
        raise RuntimeError("browser application Worker cannot own the reserved production API domain")

    apex_rows: list[dict] = []
    for pattern in base.ROUTE_PATTERNS:
        matches = base.routes_by_pattern(routes, pattern)
        if len(matches) > 1:
            raise RuntimeError(f"duplicate apex integration route observed: {pattern}")
        apex_rows.extend(matches)

    return {
        "app_domain": [base.public_domain(row) for row in app_domains],
        "app_dns": [
            {key: row.get(key) for key in ("id", "name", "type", "content", "proxied") if row.get(key) is not None}
            for row in app_dns
        ],
        "reserved_api_domain": [base.public_domain(row) for row in reserved],
        "configuration_ruleset": {
            key: ruleset.get(key)
            for key in ("id", "phase", "kind")
            if ruleset.get(key) is not None
        },
        "direct_origin_configuration_rule": [_public_rule(row) for row in direct],
        "apex_routes_observed_not_required": [base.public_route(row) for row in apex_rows],
    }


def preflight(output: Path, source_sha: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        client = base.Cloudflare()
        selected = validate_direct_target(base.live_topology(client))
        payload = {
            "schema": "musitu.axiom.browser-world-release.preflight.v1",
            "status": "PASS",
            "source_git_sha": source_sha,
            "zone": {"id": base.ZONE_ID, "name": base.ZONE_NAME, "account_id": base.ACCOUNT_ID},
            "worker_service": base.SERVICE,
            "public_application_origin": base.APP_ORIGIN,
            "public_application_entry": f"{base.APP_ORIGIN}/#/home",
            "direct_origin_configuration_rule_ref": DIRECT_RULE_REF,
            "direct_origin_configuration_rule_expression": DIRECT_RULE_EXPRESSION,
            "apex_bridge_required": False,
            "apex_routes_write_authorized": False,
            "reserved_api_origin_repurpose_authorized": False,
            "target_before": selected,
            "write_performed": False,
        }
        output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({
            "preflight": "PASS",
            "app_domain_exists": bool(selected["app_domain"]),
            "apex_routes_observed_not_required": len(selected["apex_routes_observed_not_required"]),
        }, sort_keys=True))
    except Exception as error:
        failure = {
            "schema": "musitu.axiom.browser-world-release.preflight.failure.v1",
            "status": "FAIL",
            "source_git_sha": source_sha,
            "error_type": type(error).__name__,
            "error": str(error),
            "write_performed": False,
            "apex_routes_write_authorized": False,
            "reserved_api_origin_repurpose_authorized": False,
        }
        output.with_name("world-release-preflight-failure.json").write_text(
            json.dumps(failure, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        raise


def activate(preflight_path: Path, evidence_dir: Path, source_sha: str) -> None:
    prior = json.loads(preflight_path.read_text(encoding="utf-8"))
    if prior.get("status") != "PASS" or prior.get("source_git_sha") != source_sha:
        raise RuntimeError("world-release preflight is missing or belongs to another source SHA")

    client = base.Cloudflare()
    base.worker_settings(client, source_sha)
    before = validate_direct_target(base.live_topology(client))
    if before != prior.get("target_before"):
        raise RuntimeError("Cloudflare direct-origin target topology changed after preflight")

    ruleset_id = before["configuration_ruleset"]["id"]
    created_rule_id: str | None = None
    created_domain_id: str | None = None
    try:
        if not before["direct_origin_configuration_rule"]:
            created_rule = client.call(
                f"/zones/{base.ZONE_ID}/rulesets/{ruleset_id}/rules",
                "POST",
                {
                    "action": "set_config",
                    "action_parameters": {"security_level": "essentially_off", "bic": False},
                    "expression": DIRECT_RULE_EXPRESSION,
                    "description": (
                        "MUSITU Axiom world release: suppress the zone interstitial only on the dedicated "
                        "application hostname; Worker authentication, rate limiting, CSRF, CSP and session controls remain fail-closed"
                    ),
                    "enabled": True,
                    "ref": DIRECT_RULE_REF,
                },
            ) or {}
            created_rule_id = created_rule.get("id")
            current = validate_direct_target(base.live_topology(client))
            if len(current["direct_origin_configuration_rule"]) != 1:
                raise RuntimeError("direct-origin configuration rule creation readback failed")
            if not created_rule_id:
                created_rule_id = current["direct_origin_configuration_rule"][0].get("id")
            if not created_rule_id:
                raise RuntimeError("direct-origin configuration rule id is missing after creation")

        if not before["app_domain"]:
            client.call(
                f"/accounts/{base.ACCOUNT_ID}/workers/domains",
                "PUT",
                {
                    "hostname": base.APP_HOST,
                    "service": base.SERVICE,
                    "zone_id": base.ZONE_ID,
                    "zone_name": base.ZONE_NAME,
                },
            )
            current = validate_direct_target(base.live_topology(client))
            if len(current["app_domain"]) != 1 or not current["app_domain"][0].get("id"):
                raise RuntimeError("application custom-domain creation readback failed")
            created_domain_id = current["app_domain"][0]["id"]

        health = base.wait_for_application(source_sha)
        static = base.verify_static_application(source_sha)
        identity = base.verify_identity()
        after = validate_direct_target(base.live_topology(client))

        if len(after["app_domain"]) != 1 or after["app_domain"][0].get("service") != base.SERVICE:
            raise RuntimeError("application custom-domain final readback mismatch")
        if after["reserved_api_domain"] != before["reserved_api_domain"]:
            raise RuntimeError("reserved production API domain changed during world release")
        if len(after["direct_origin_configuration_rule"]) != 1:
            raise RuntimeError("direct-origin configuration rule final readback mismatch")

        evidence = {
            "schema": "musitu.axiom.browser-world-release.production.v1",
            "status": "PASS",
            "source_git_sha": source_sha,
            "public_application_origin": f"{base.APP_ORIGIN}/",
            "public_application_entry": f"{base.APP_ORIGIN}/#/home",
            "worker_service": base.SERVICE,
            "application_domain": after["app_domain"][0],
            "direct_origin_configuration_rule": after["direct_origin_configuration_rule"][0],
            "configuration_rule_scope": "EXACT_DEDICATED_APP_HOST_ONLY",
            "apex_bridge_required": False,
            "apex_bridge_status": "OPTIONAL_NOT_REQUIRED_FOR_WORLD_RELEASE",
            "apex_routes_observed_not_required": after["apex_routes_observed_not_required"],
            "apex_routes_created_by_world_release": False,
            "reserved_api_domain_before": before["reserved_api_domain"],
            "reserved_api_domain_after": after["reserved_api_domain"],
            "reserved_api_origin_preserved": True,
            "existing_apex_origin_overridden": False,
            "global_security_policy_mutated": False,
            "worker_security_and_authentication_preserved": True,
            "worker_health": health,
            "static_application": static,
            "identity_integration": identity,
            "production_deployment_claimed": True,
            "production_identity_integration_claimed": True,
            "phase13_earned_claimed": False,
            "phase14_earned_claimed": False,
        }
        digest = base.write_evidence(evidence_dir, "axiom-browser-world-release-production.json", evidence)
        print(json.dumps({
            "world_release": "PASS",
            "public_application_origin": evidence["public_application_origin"],
            "public_application_entry": evidence["public_application_entry"],
            "evidence_sha256": digest,
        }, sort_keys=True))
    except Exception as error:
        rollback = base.delete_created(
            client,
            created_domain_id,
            [],
            ruleset_id,
            created_rule_id,
        )
        failure = {
            "schema": "musitu.axiom.browser-world-release.production.failure.v1",
            "status": "FAIL",
            "source_git_sha": source_sha,
            "error_type": type(error).__name__,
            "error": str(error),
            "rollback": rollback,
            "apex_routes_created_by_world_release": False,
            "apex_routes_write_authorized": False,
            "reserved_api_origin_repurpose_authorized": False,
            "phase13_earned_claimed": False,
            "phase14_earned_claimed": False,
        }
        base.write_evidence(evidence_dir, "axiom-browser-world-release-production-failure.json", failure)
        raise


def selftest() -> None:
    if DIRECT_RULE_EXPRESSION != f'(http.host eq "{base.APP_HOST}")':
        raise RuntimeError("direct-origin rule expression drift")
    if "/axiom" in DIRECT_RULE_EXPRESSION or "http.host in" in DIRECT_RULE_EXPRESSION:
        raise RuntimeError("direct-origin rule must not widen to apex paths")
    if DIRECT_RULE_REF == base.CONFIG_RULE_REF:
        raise RuntimeError("world-release and apex-coupled rule refs must remain distinct")
    print("MUSITU_AXIOM_BROWSER_WORLD_RELEASE_SELFTEST_PASS")


def main() -> None:
    parser = argparse.ArgumentParser(description="MUSITU Axiom direct-origin world release")
    subparsers = parser.add_subparsers(dest="command", required=True)
    preflight_parser = subparsers.add_parser("preflight")
    preflight_parser.add_argument("--output", type=Path, required=True)
    preflight_parser.add_argument("--source-sha", required=True)
    activate_parser = subparsers.add_parser("activate")
    activate_parser.add_argument("--preflight", type=Path, required=True)
    activate_parser.add_argument("--evidence-dir", type=Path, required=True)
    activate_parser.add_argument("--source-sha", required=True)
    subparsers.add_parser("selftest")
    arguments = parser.parse_args()
    if arguments.command == "selftest":
        selftest()
        return
    if not base.re.fullmatch(r"[0-9a-f]{40}", arguments.source_sha):
        raise SystemExit("source SHA must be an exact 40-character lowercase Git commit")
    if arguments.command == "preflight":
        preflight(arguments.output, arguments.source_sha)
    else:
        activate(arguments.preflight, arguments.evidence_dir, arguments.source_sha)


if __name__ == "__main__":
    main()

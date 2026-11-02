"""Execute existing script-style contracts; unittest discovery does not run main().

The browser/media full-stack case is deliberately separate: it needs installed
browser/media dependencies. These checks make no hosted capability claim.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
MODULES = (
    "advanced_runtime", "agent_plugin_package", "benchmark_registry",
    "browser_network_preflight", "cimd_contract", "circuit_breaker_contract",
    "data_lifecycle_contract", "dns_rebinding_pin", "durable_tasks",
    "enterprise_contracts_contract", "enterprise_disaster_recovery",
    "enterprise_identity_contract", "enterprise_incident_response",
    "enterprise_slo_governance", "enterprise_spend_governance",
    "external_claim_boundary", "external_comparative_gate", "failure_corpus_contract",
    "financial_ontology_contract", "freshness_contract", "frontier_runtime",
    "incident_forensics_contract", "latency_performance_contract",
    "malicious_file_contract", "mcp_2026_contract", "migration_safety",
    "oidc_contract", "openai_plugin_package", "persistent_planner",
    "privacy_analytics_contract", "provider_fallback_contract",
    "research_redirect_preflight", "secret_scanning_contract",
    "supply_chain_contract", "workspace_licensing",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    results = []
    for suffix in MODULES:
        module = f"frontier_v5.tests.test_{suffix}"
        command = [sys.executable, "-m", module]
        log = args.output.parent / f"contract-{suffix}.log"
        started = time.monotonic()
        with log.open("w") as stream:
            try:
                code = subprocess.run(command, cwd=ROOT, stdout=stream,
                                      stderr=subprocess.STDOUT, timeout=45).returncode
            except subprocess.TimeoutExpired:
                code = 124
        evidence_scope = ("ARCHIVED_DISTRIBUTION_SOURCE_ONLY" if suffix in
                          {"supply_chain_contract", "openai_plugin_package"} else "LOCAL_CONTRACT_ONLY")
        row = {"module": module, "command": command, "exit": code, "evidence_scope": evidence_scope,
               "seconds": round(time.monotonic() - started, 3), "log": log.name}
        results.append(row)
        print(json.dumps(row), flush=True)
    report = {"schema": "musitu.axiom.offline-frontier-contracts.v1",
              "scope": "EXISTING_SCRIPT_CONTRACTS_LOCAL_ONLY",
              "hosted_qualified": False, "external_comparison_qualified": False,
              "excluded": {"test_fullstack_local": "browser/media dependency acceptance is separate"},
              "total_modules": len(results),
              "passed_modules": sum(row["exit"] == 0 for row in results),
              "results": results}
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    raise SystemExit(any(row["exit"] != 0 for row in results))


if __name__ == "__main__":
    main()

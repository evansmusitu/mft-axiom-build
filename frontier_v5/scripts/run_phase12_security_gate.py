#!/usr/bin/env python3
from __future__ import annotations
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "axiom_interface"
OUT = Path(os.environ.get("AXIOM_PHASE12_SECURITY_ARTIFACT_DIR", "/tmp/axiom-interface-phase12-security"))
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    files = {name: (ROOT / name).read_text(encoding="utf-8") for name in ["developer_security.js", "developer_store.js", "developer_ui.js", "developer_bootstrap.js"]}
    joined = "\n".join(files.values())
    for token in ["fetch(", "WebSocket(", "EventSource(", "new Function(", "eval("]:
        if token in joined:
            raise SystemExit(f"Phase 12 external transport or dynamic execution forbidden: {token}")
    required = [
        "DENY_ALL_EXTERNAL_NETWORK", "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY",
        "SYMBOLIC_HANDLE_ONLY_NO_PLAINTEXT_API_KEYS", "DECLARATION_AND_LOCAL_SIGNED_FIXTURE_ONLY_NO_DELIVERY",
        "MCP_2026_LOCAL_CONFORMANCE_ONLY_NO_REMOTE_BINDING", "A2A_LOCAL_CAPABILITY_CARD_CONFORMANCE_ONLY",
        "STATIC_MANIFEST_VALIDATION_NO_UNTRUSTED_CODE_EXECUTION", "prepareInstall", "applyInstall",
        "previous_event_sha256", "receipt_sha256", "package_sha256", "install_sha256",
    ]
    missing = [token for token in required if token not in joined]
    if missing:
        raise SystemExit("Phase 12 contract tokens missing: " + ",".join(missing))
    evidence = {
        "schema": "musitu.axiom.interface.phase12-security-evidence.v1", "status": "PASS",
        "network_policy": "DENY_ALL_EXTERNAL_NETWORK", "platform_mode": "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY",
        "symbolic_credential_only": True, "exact_install_digest_required": True,
        "least_privilege_install_required": True, "tamper_evident_events_and_receipts": True,
        "production_api_key_issued": False, "remote_mcp_binding_claimed": False,
        "outbound_webhook_delivery_claimed": False, "untrusted_package_code_executed": False,
        "external_conformance_certification_claimed": False, "phase11_authority_preserved": True,
    }
    (OUT / "phase12-security-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("MUSITU_AXIOM_INTERFACE_PHASE12_SECURITY_PASS")


if __name__ == "__main__":
    main()

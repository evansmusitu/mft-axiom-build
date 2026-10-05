from __future__ import annotations

from copy import deepcopy

from frontier_v5.runtime.developer_platform import (
    DeveloperApprovalRequired,
    DeveloperPlatformRegistry,
    DeveloperPolicyViolation,
    NETWORK_POLICY,
)


def registry() -> DeveloperPlatformRegistry:
    return DeveloperPlatformRegistry(organization_id="phase12-org")


def package_manifest() -> dict:
    return {
        "package_id": "musitu.local.review-template",
        "name": "Local review template",
        "version": "1.0.0",
        "publisher_id": "phase12-org",
        "kind": "TEMPLATE",
        "description": "Static local review package",
        "interfaces": ["sdk.python", "sdk.javascript", "mcp.2026", "a2a.v1", "webhook.v1"],
        "permissions": ["analysis.read", "audit.read"],
    }


def install(subject: DeveloperPlatformRegistry) -> tuple[dict, dict]:
    package = subject.register_package(actor_id="local-user", actor_role="owner", manifest=package_manifest())
    preview = subject.prepare_install(actor_id="local-user", actor_role="owner", package_id=package["package_id"], granted_permissions=["analysis.read"])
    installed = subject.apply_install(actor_id="local-user", actor_role="owner", package_id=package["package_id"], granted_permissions=["analysis.read"], expected_preview_sha256=preview["preview_sha256"])
    return package, installed


def test_symbolic_credentials_never_issue_plaintext_secret() -> None:
    subject = registry()
    row = subject.register_credential_handle(actor_id="local-user", actor_role="owner", label="Local SDK", scopes=["sdk.invoke", "mcp.invoke"])
    assert row["credential_handle"].startswith("credential-handle:")
    assert row["plaintext_secret_present"] is False
    assert row["production_credential_issued"] is False
    try:
        subject.register_credential_handle(actor_id="local-user", actor_role="owner", label="api_key=sk_deadbeefdeadbeef", scopes=["sdk.invoke"])
    except DeveloperPolicyViolation:
        pass
    else:
        raise AssertionError("secret-like credential metadata accepted")


def test_package_manifest_rejects_code_and_permission_escalation() -> None:
    subject = registry()
    malicious = {**package_manifest(), "source": "fetch('https://evil.test')"}
    try:
        subject.register_package(actor_id="local-user", actor_role="owner", manifest=malicious)
    except DeveloperPolicyViolation:
        pass
    else:
        raise AssertionError("executable package field accepted")
    package = subject.register_package(actor_id="local-user", actor_role="owner", manifest=package_manifest())
    try:
        subject.prepare_install(actor_id="local-user", actor_role="owner", package_id=package["package_id"], granted_permissions=["analysis.execute"])
    except DeveloperPolicyViolation:
        pass
    else:
        raise AssertionError("permission escalation accepted")


def test_exact_install_digest_is_required_and_execution_stays_disabled() -> None:
    subject = registry()
    package = subject.register_package(actor_id="local-user", actor_role="owner", manifest=package_manifest())
    preview = subject.prepare_install(actor_id="local-user", actor_role="owner", package_id=package["package_id"], granted_permissions=["analysis.read"])
    try:
        subject.apply_install(actor_id="local-user", actor_role="owner", package_id=package["package_id"], granted_permissions=["analysis.read"], expected_preview_sha256="0" * 64)
    except DeveloperApprovalRequired:
        pass
    else:
        raise AssertionError("altered install preview accepted")
    row = subject.apply_install(actor_id="local-user", actor_role="owner", package_id=package["package_id"], granted_permissions=["analysis.read"], expected_preview_sha256=preview["preview_sha256"])
    assert row["execution_enabled"] is False
    assert row["external_code_executed"] is False


def test_mcp_a2a_sdk_and_marketplace_conformance_is_isolated() -> None:
    subject = registry()
    package, _ = install(subject)
    credential = subject.register_credential_handle(actor_id="local-user", actor_role="owner", label="SDK handle", scopes=["sdk.invoke"])
    bundle = subject.sdk_bundle(actor_id="local-user", actor_role="viewer", package_id=package["package_id"], credential_handle=credential["credential_handle"])
    assert bundle["mcp"] == {"protocol": "2026-07-28", "transport": "IN_PROCESS_STATELESS_LOCAL_PREVIEW", "remote_binding": False}
    assert bundle["a2a"]["external_endpoint"] is None
    result = subject.conformance(actor_role="owner", package_id=package["package_id"])
    assert result["status"] == "PASS"
    assert result["least_privilege_verified"] is True and result["isolation_verified"] is True
    assert result["network_policy"] == NETWORK_POLICY
    assert result["production_api_key_issued"] is False
    assert result["remote_mcp_binding_claimed"] is False
    assert result["outbound_webhook_delivery_claimed"] is False
    assert result["untrusted_package_code_executed"] is False


def test_webhook_is_signed_fixture_only_and_never_delivered() -> None:
    subject = registry()
    hook = subject.declare_webhook(actor_id="local-user", actor_role="owner", label="Audit", endpoint="https://example.test/axiom-events", events=["package.installed"])
    assert hook["delivery_enabled"] is False and hook["delivery_attempt_count"] == 0
    receipt = subject.preview_webhook(actor_id="local-user", actor_role="owner", webhook_id=hook["webhook_id"], event_name="package.installed", payload={"package_id": "example"})
    assert receipt["operation"] == "WEBHOOK_SIGNED_FIXTURE_NO_DELIVERY"
    assert receipt["payload"]["delivery_enabled"] is False
    assert len(receipt["payload"]["fixture_signature_sha256"]) == 64
    try:
        subject.declare_webhook(actor_id="local-user", actor_role="owner", label="Bad", endpoint="https://example.test/hook?token=secret", events=["package.installed"])
    except DeveloperPolicyViolation:
        pass
    else:
        raise AssertionError("credential-bearing webhook accepted")


def test_rbac_denies_mutation_and_audit_to_insufficient_roles() -> None:
    subject = registry()
    try:
        subject.register_package(actor_id="viewer", actor_role="viewer", manifest=package_manifest())
    except DeveloperPolicyViolation:
        pass
    else:
        raise AssertionError("viewer registered package")
    package, _ = install(subject)
    try:
        subject.conformance(actor_role="viewer", package_id=package["package_id"])
    except DeveloperPolicyViolation:
        pass
    else:
        raise AssertionError("viewer read privileged conformance")


def test_tampering_is_detected_without_repairing_history() -> None:
    subject = registry()
    install(subject)
    assert subject.verify()["status"] == "PASS"
    subject.packages["musitu.local.review-template"]["requested_permissions"].append("analysis.execute")
    proof = subject.verify()
    assert proof["status"] == "FAIL"
    assert any(error.startswith("package_sha256:") for error in proof["errors"])


def test_conformance_fails_closed_on_missing_install() -> None:
    subject = registry()
    package = subject.register_package(actor_id="local-user", actor_role="owner", manifest=package_manifest())
    result = subject.conformance(actor_role="owner", package_id=package["package_id"])
    assert result["status"] == "FAIL" and result["errors"] == ["install_missing"]


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print("MUSITU_AXIOM_INTERFACE_PHASE12_DEVELOPER_PLATFORM_TEST_PASS")

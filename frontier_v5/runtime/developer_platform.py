#!/usr/bin/env python3
"""Fail-closed Phase-12 developer-platform and marketplace preview.

The registry validates static package manifests, least-privilege installation
previews, symbolic credential handles, SDK descriptors, MCP/A2A descriptors,
and non-delivering webhook fixtures. It never issues production credentials,
loads package code, opens a network transport, or claims remote registration.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence
from urllib.parse import urlsplit
import hashlib
import json
import re
import uuid


class DeveloperPlatformError(RuntimeError):
    """Base failure for the bounded local developer-platform preview."""


class DeveloperPolicyViolation(DeveloperPlatformError):
    """A manifest, permission, role, or credential crossed policy."""


class DeveloperApprovalRequired(DeveloperPlatformError):
    """An exact package-install preview was not approved."""


NETWORK_POLICY = "DENY_ALL_EXTERNAL_NETWORK"
PLATFORM_MODE = "LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY"
CREDENTIAL_POLICY = "SYMBOLIC_HANDLE_ONLY_NO_PLAINTEXT_API_KEYS"
WEBHOOK_POLICY = "DECLARATION_AND_LOCAL_SIGNED_FIXTURE_ONLY_NO_DELIVERY"
MCP_POLICY = "MCP_2026_LOCAL_CONFORMANCE_ONLY_NO_REMOTE_BINDING"
A2A_POLICY = "A2A_LOCAL_CAPABILITY_CARD_CONFORMANCE_ONLY"
PACKAGE_EXECUTION_POLICY = "STATIC_MANIFEST_VALIDATION_NO_UNTRUSTED_CODE_EXECUTION"
MARKETPLACE_POLICY = "EXACT_PACKAGE_DIGEST_AND_LEAST_PRIVILEGE_INSTALL_APPROVAL"
INTERFACES = frozenset({"sdk.python", "sdk.javascript", "mcp.2026", "a2a.v1", "webhook.v1"})
PACKAGE_KINDS = frozenset({"AGENT_PACKAGE", "TEMPLATE"})
PACKAGE_PERMISSIONS = frozenset({"analysis.read", "analysis.execute", "audit.read"})
API_SCOPES = frozenset({"sdk.invoke", "mcp.invoke", "a2a.card.read", "webhook.fixture"})
WEBHOOK_EVENTS = frozenset({"package.installed", "agent.preview.completed", "artifact.version.created"})
ROLE_PERMISSIONS = {
    "owner": frozenset({"policy.manage", "analysis.read", "analysis.execute", "audit.read"}),
    "admin": frozenset({"policy.manage", "analysis.read", "analysis.execute", "audit.read"}),
    "analyst": frozenset({"analysis.read", "analysis.execute"}),
    "viewer": frozenset({"analysis.read"}),
}
_SECRET_RX = re.compile(
    r"(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]"
    r"|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|\bbearer\s+[A-Za-z0-9._~-]{12,}", re.I
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: Any, label: str, limit: int = 180) -> str:
    result = str(value if value is not None else "").replace("\x00", " ").strip()[:limit]
    if not result:
        raise ValueError(f"{label} required")
    return result


def _reject_secrets(value: Any, label: str) -> None:
    if _SECRET_RX.search(_canonical(value)):
        raise DeveloperPolicyViolation(f"{label} contains secret-like material")


def _exact(values: Sequence[str], allowed: frozenset[str], label: str) -> list[str]:
    if not isinstance(values, (list, tuple, set, frozenset)) or not values:
        raise ValueError(f"{label} required")
    result = sorted({_required(value, label, 80) for value in values})
    if not set(result).issubset(allowed):
        raise DeveloperPolicyViolation(f"{label} exceeds the allow-list")
    return result


class DeveloperPlatformRegistry:
    """In-memory reference ledger for Phase-12 conformance/isolation tests."""

    def __init__(self, *, organization_id: str, owner_id: str = "local-user") -> None:
        self.organization_id = _required(organization_id, "organization_id")
        self.owner_id = _required(owner_id, "owner_id")
        self.credentials: dict[str, dict[str, Any]] = {}
        self.packages: dict[str, dict[str, Any]] = {}
        self.installs: dict[str, dict[str, Any]] = {}
        self.webhooks: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self.receipts: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _authorize(role: str, permission: str) -> None:
        role = _required(role, "role", 32).lower()
        if permission not in ROLE_PERMISSIONS.get(role, frozenset()):
            raise DeveloperPolicyViolation(f"{permission} authorization required")

    def _event(self, kind: str, actor_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        body = {
            "schema": "musitu.axiom.developer-event.v1", "event_id": f"developer-event:{len(self.events)}",
            "sequence": len(self.events), "kind": _required(kind, "event kind", 80),
            "actor_id": _required(actor_id, "actor_id"), "organization_id": self.organization_id,
            "payload": deepcopy(dict(payload)), "created_at": _now(),
            "previous_event_sha256": self.events[-1]["event_sha256"] if self.events else None,
        }
        row = {**body, "event_sha256": _sha(body)}
        self.events.append(row)
        return deepcopy(row)

    def _receipt(self, operation: str, actor_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        body = {
            "schema": "musitu.axiom.developer-receipt.v1", "receipt_id": f"developer-receipt:{uuid.uuid4()}",
            "operation": operation, "actor_id": actor_id, "organization_id": self.organization_id,
            "payload": deepcopy(dict(payload)), "created_at": _now(), "platform_mode": PLATFORM_MODE,
        }
        row = {**body, "receipt_sha256": _sha(body)}
        self.receipts[row["receipt_id"]] = row
        return deepcopy(row)

    def register_credential_handle(self, *, actor_id: str, actor_role: str, label: str, scopes: Sequence[str], **unknown: Any) -> dict[str, Any]:
        self._authorize(actor_role, "policy.manage")
        if unknown:
            raise DeveloperPolicyViolation("credential input accepts metadata only")
        _reject_secrets({"label": label, "scopes": scopes}, "credential metadata")
        body = {
            "schema": "musitu.axiom.symbolic-api-credential.v1", "credential_handle": f"credential-handle:{uuid.uuid4()}",
            "organization_id": self.organization_id, "label": _required(label, "credential label"),
            "scopes": _exact(scopes, API_SCOPES, "API scopes"), "status": "ACTIVE_LOCAL_HANDLE",
            "created_at": _now(), "credential_policy": CREDENTIAL_POLICY,
            "plaintext_secret_present": False, "production_credential_issued": False,
        }
        row = {**body, "credential_fingerprint_sha256": _sha(body)}
        self.credentials[row["credential_handle"]] = row
        self._event("credential.handle_registered", actor_id, {"credential_handle": row["credential_handle"]})
        return deepcopy(row)

    def register_package(self, *, actor_id: str, actor_role: str, manifest: Mapping[str, Any]) -> dict[str, Any]:
        self._authorize(actor_role, "policy.manage")
        if not isinstance(manifest, Mapping):
            raise ValueError("package manifest required")
        allowed = {"package_id", "name", "version", "publisher_id", "kind", "description", "interfaces", "permissions"}
        if set(manifest) - allowed:
            raise DeveloperPolicyViolation("package manifest contains executable or unsupported fields")
        _reject_secrets(manifest, "package manifest")
        version = _required(manifest.get("version"), "version", 40)
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?", version, re.I):
            raise ValueError("semantic package version required")
        package_id = re.sub(r"[^a-z0-9._-]", "-", _required(manifest.get("package_id"), "package id", 120).lower())
        if package_id in self.packages:
            raise DeveloperPolicyViolation("package id already registered")
        kind = _required(manifest.get("kind"), "package kind", 32).upper()
        if kind not in PACKAGE_KINDS:
            raise DeveloperPolicyViolation("unsupported package kind")
        body = {
            "schema": "musitu.axiom.developer-package.v1", "package_id": package_id,
            "name": _required(manifest.get("name"), "package name"), "version": version,
            "publisher_id": _required(manifest.get("publisher_id"), "publisher id"), "kind": kind,
            "description": str(manifest.get("description", ""))[:500],
            "interfaces": _exact(manifest.get("interfaces", []), INTERFACES, "interfaces"),
            "requested_permissions": _exact(manifest.get("permissions", []), PACKAGE_PERMISSIONS, "permissions"),
            "network_permissions": [], "external_code_included": False, "remote_binding_claimed": False,
            "organization_id": self.organization_id, "created_at": _now(), "platform_mode": PLATFORM_MODE,
            "mcp_policy": MCP_POLICY, "a2a_policy": A2A_POLICY, "package_execution_policy": PACKAGE_EXECUTION_POLICY,
        }
        row = {**body, "package_sha256": _sha(body)}
        self.packages[package_id] = row
        self._event("package.registered", actor_id, {"package_id": package_id, "package_sha256": row["package_sha256"]})
        return deepcopy(row)

    def prepare_install(self, *, actor_id: str, actor_role: str, package_id: str, granted_permissions: Sequence[str]) -> dict[str, Any]:
        self._authorize(actor_role, "policy.manage")
        package_id = _required(package_id, "package_id")
        package = self.packages.get(package_id)
        if package is None:
            raise DeveloperPolicyViolation("package not found")
        granted = _exact(granted_permissions, PACKAGE_PERMISSIONS, "install permissions")
        if not set(granted).issubset(package["requested_permissions"]):
            raise DeveloperPolicyViolation("install grants exceed package request")
        body = {
            "schema": "musitu.axiom.marketplace-install-preview.v1", "organization_id": self.organization_id,
            "actor_id": _required(actor_id, "actor_id"), "package_id": package_id,
            "package_sha256": package["package_sha256"], "granted_permissions": granted,
            "status": "AWAITING_EXACT_CONFIRMATION", "marketplace_policy": MARKETPLACE_POLICY,
        }
        return {**body, "preview_sha256": _sha(body)}

    def apply_install(self, *, actor_id: str, actor_role: str, package_id: str, granted_permissions: Sequence[str], expected_preview_sha256: str) -> dict[str, Any]:
        preview = self.prepare_install(actor_id=actor_id, actor_role=actor_role, package_id=package_id, granted_permissions=granted_permissions)
        if expected_preview_sha256 != preview["preview_sha256"]:
            raise DeveloperApprovalRequired("stale or altered package install preview")
        body = {
            "schema": "musitu.axiom.marketplace-install.v1", "organization_id": self.organization_id,
            "package_id": package_id, "package_sha256": preview["package_sha256"],
            "granted_permissions": preview["granted_permissions"], "preview_sha256": preview["preview_sha256"],
            "status": "ACTIVE_LOCAL_PREVIEW", "installed_by": actor_id, "installed_at": _now(),
            "execution_enabled": False, "external_code_executed": False,
        }
        row = {**body, "install_sha256": _sha(body)}
        self.installs[package_id] = row
        self._event("package.installed_local_preview", actor_id, {"package_id": package_id, "install_sha256": row["install_sha256"]})
        self._receipt("PACKAGE_INSTALL_LOCAL_PREVIEW", actor_id, {"package_id": package_id, "preview_sha256": preview["preview_sha256"]})
        return deepcopy(row)

    def declare_webhook(self, *, actor_id: str, actor_role: str, label: str, endpoint: str, events: Sequence[str]) -> dict[str, Any]:
        self._authorize(actor_role, "policy.manage")
        _reject_secrets({"label": label, "endpoint": endpoint, "events": events}, "webhook declaration")
        parsed = urlsplit(_required(endpoint, "webhook endpoint", 500))
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.netloc:
            raise DeveloperPolicyViolation("webhook endpoint must be credential-free HTTPS without query or fragment")
        body = {
            "schema": "musitu.axiom.webhook-declaration.v1", "webhook_id": f"webhook:{uuid.uuid4()}",
            "organization_id": self.organization_id, "label": _required(label, "webhook label"), "endpoint": endpoint,
            "events": _exact(events, WEBHOOK_EVENTS, "webhook events"), "created_at": _now(),
            "webhook_policy": WEBHOOK_POLICY, "network_policy": NETWORK_POLICY,
            "delivery_enabled": False, "delivery_attempt_count": 0,
        }
        row = {**body, "webhook_sha256": _sha(body)}
        self.webhooks[row["webhook_id"]] = row
        self._event("webhook.declared_no_delivery", actor_id, {"webhook_id": row["webhook_id"]})
        return deepcopy(row)

    def preview_webhook(self, *, actor_id: str, actor_role: str, webhook_id: str, event_name: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._authorize(actor_role, "policy.manage")
        hook = self.webhooks.get(webhook_id)
        if hook is None or event_name not in hook["events"]:
            raise DeveloperPolicyViolation("webhook event not granted")
        _reject_secrets(payload, "webhook fixture")
        payload_sha = _sha(payload)
        signature = _sha({"webhook_sha256": hook["webhook_sha256"], "event_name": event_name, "payload_sha256": payload_sha, "delivery_enabled": False})
        return self._receipt("WEBHOOK_SIGNED_FIXTURE_NO_DELIVERY", actor_id, {"webhook_id": webhook_id, "event_name": event_name, "payload_sha256": payload_sha, "fixture_signature_sha256": signature, "delivery_enabled": False})

    def sdk_bundle(self, *, actor_id: str, actor_role: str, package_id: str, credential_handle: str) -> dict[str, Any]:
        self._authorize(actor_role, "analysis.read")
        if package_id not in self.installs or credential_handle not in self.credentials:
            raise DeveloperPolicyViolation("installed package and symbolic credential handle required")
        binding = {"package_id": package_id, "credential_handle": credential_handle, "transport": "LOCAL_PREVIEW_ONLY", "network_policy": NETWORK_POLICY}
        return {
            "schema": "musitu.axiom.sdk-bundle.v1", "binding": binding, "binding_sha256": _sha(binding),
            "python": f"AxiomLocalPreview(package_id={package_id!r}, credential_handle={credential_handle!r})",
            "javascript": {"constructor": "AxiomLocalPreview", "packageId": package_id, "credentialHandle": credential_handle},
            "mcp": {"protocol": "2026-07-28", "transport": "IN_PROCESS_STATELESS_LOCAL_PREVIEW", "remote_binding": False},
            "a2a": {"schema": "musitu.axiom.a2a-card.local.v1", "package_id": package_id, "external_endpoint": None},
        }

    def conformance(self, *, actor_role: str, package_id: str) -> dict[str, Any]:
        self._authorize(actor_role, "audit.read")
        package = self.packages.get(package_id)
        install = self.installs.get(package_id)
        errors: list[str] = []
        if package is None:
            return {"status": "FAIL", "errors": ["package_missing"]}
        package_body = {key: value for key, value in package.items() if key != "package_sha256"}
        if _sha(package_body) != package["package_sha256"]:
            errors.append("package_hash")
        if package["network_permissions"] or package["external_code_included"] or package["remote_binding_claimed"]:
            errors.append("package_isolation")
        if install is None:
            errors.append("install_missing")
        else:
            install_body = {key: value for key, value in install.items() if key != "install_sha256"}
            if _sha(install_body) != install["install_sha256"]:
                errors.append("install_hash")
            if not set(install["granted_permissions"]).issubset(package["requested_permissions"]):
                errors.append("permission_escalation")
            if install["execution_enabled"] or install["external_code_executed"]:
                errors.append("unexpected_execution")
        return {
            "schema": "musitu.axiom.developer-conformance.v1", "status": "FAIL" if errors else "PASS", "errors": errors,
            "package_id": package_id, "interfaces": package["interfaces"], "network_policy": NETWORK_POLICY,
            "platform_mode": PLATFORM_MODE, "mcp_conformance": "MCP_2026_LOCAL_DESCRIPTOR_VALID" if "mcp.2026" in package["interfaces"] else "NOT_REQUESTED",
            "a2a_conformance": "A2A_LOCAL_CARD_VALID" if "a2a.v1" in package["interfaces"] else "NOT_REQUESTED",
            "webhook_conformance": "DECLARATION_ONLY_NO_DELIVERY" if "webhook.v1" in package["interfaces"] else "NOT_REQUESTED",
            "least_privilege_verified": "permission_escalation" not in errors,
            "isolation_verified": not {"package_isolation", "unexpected_execution"}.intersection(errors),
            "production_api_key_issued": False, "remote_mcp_binding_claimed": False,
            "outbound_webhook_delivery_claimed": False, "untrusted_package_code_executed": False,
        }

    def verify(self) -> dict[str, Any]:
        errors: list[str] = []
        previous = None
        for index, event in enumerate(self.events):
            body = {key: value for key, value in event.items() if key != "event_sha256"}
            if event["sequence"] != index or event["previous_event_sha256"] != previous or _sha(body) != event["event_sha256"]:
                errors.append(f"event_chain:{index}")
            previous = event["event_sha256"]
        for rows, field, identity in ((self.credentials, "credential_fingerprint_sha256", "credential_handle"), (self.packages, "package_sha256", "package_id"), (self.installs, "install_sha256", "package_id"), (self.webhooks, "webhook_sha256", "webhook_id"), (self.receipts, "receipt_sha256", "receipt_id")):
            for row in rows.values():
                body = {key: value for key, value in row.items() if key != field}
                if _sha(body) != row[field]:
                    errors.append(f"{field}:{row[identity]}")
        return {"schema": "musitu.axiom.developer-integrity.v1", "status": "FAIL" if errors else "PASS", "errors": sorted(set(errors)), "event_count": len(self.events), "network_policy": NETWORK_POLICY}


__all__ = [
    "A2A_POLICY", "CREDENTIAL_POLICY", "DeveloperApprovalRequired", "DeveloperPlatformError",
    "DeveloperPlatformRegistry", "DeveloperPolicyViolation", "MARKETPLACE_POLICY", "MCP_POLICY",
    "NETWORK_POLICY", "PACKAGE_EXECUTION_POLICY", "PLATFORM_MODE", "WEBHOOK_POLICY",
]

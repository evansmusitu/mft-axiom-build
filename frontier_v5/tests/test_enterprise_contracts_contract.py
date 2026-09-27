#!/usr/bin/env python3
"""Frozen REV-004 contract for enterprise procurement and licensing activation.

This contract composes with the existing verified enterprise identity and workspace
licensing stores. Passing proves repository-local procurement/contract-state
behavior at Evidence Level 2 only. It does not prove a legally executed customer
agreement, production procurement acceptance, negotiated pricing, or an SLA.
"""
from __future__ import annotations

import inspect
import re
import tempfile
from pathlib import Path

from frontier_v5.runtime.enterprise_identity import EnterpriseIdentityStore
from frontier_v5.runtime.workspace_licensing import (
    LicensingAuthorizationError,
    WorkspaceLicensingStore,
)

try:
    from frontier_v5.runtime.enterprise_contracts import (
        ContractAuthorizationError,
        ContractConflict,
        ContractError,
        ContractStateError,
        EnterpriseContractStore,
    )
except ModuleNotFoundError as exc:
    if exc.name == "frontier_v5.runtime.enterprise_contracts":
        raise AssertionError("REV-004 enterprise-contract procurement behavior is missing") from exc
    raise

ROOT = Path(__file__).resolve().parents[2]
PACKET_DIR = ROOT / "frontier_v5" / "enterprise_contracts"
REQUIRED_DOCS = {
    "order_form": PACKET_DIR / "ORDER_FORM_TEMPLATE.md",
    "sow": PACKET_DIR / "SOW_TEMPLATE.md",
    "security_appendix": PACKET_DIR / "SECURITY_APPENDIX.md",
    "procurement_checklist": PACKET_DIR / "PROCUREMENT_CHECKLIST.md",
}
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def expect_error(fn, exc=Exception, contains: str = "") -> None:
    try:
        fn()
    except exc as err:
        if contains and contains.casefold() not in str(err).casefold():
            raise AssertionError(f"expected {contains!r}, got {err!r}") from err
        return
    raise AssertionError(f"expected {exc.__name__}")


def setup_identity(path: Path) -> EnterpriseIdentityStore:
    identity = EnterpriseIdentityStore(path)
    for principal, email in (
        ("owner", "owner@acme.example"),
        ("analyst", "analyst@acme.example"),
        ("other-owner", "owner@other.example"),
    ):
        identity.register_user(principal, email, email_verified=True)
    identity.bootstrap_organization("org-acme", "Acme", "owner")
    identity.add_domain("owner", "org-acme", "acme.example")
    identity.verify_domain("owner", "org-acme", "acme.example", evidence_sha256="a" * 64)
    identity.create_workspace("owner", "org-acme", "ws-finance", "Finance")
    identity.add_membership("owner", "org-acme", "analyst", "analyst")

    identity.bootstrap_organization("org-other", "Other", "other-owner")
    identity.add_domain("other-owner", "org-other", "other.example")
    identity.verify_domain(
        "other-owner", "org-other", "other.example", evidence_sha256="b" * 64
    )
    identity.create_workspace("other-owner", "org-other", "ws-other", "Other")
    return identity


def assert_packet_boundary() -> None:
    for name, path in REQUIRED_DOCS.items():
        assert path.is_file(), f"REV-004 procurement document missing: {name}"
        text = path.read_text(encoding="utf-8")
        lowered = text.casefold()
        assert "template" in lowered or "checklist" in lowered
        assert "not a legally executed agreement" in lowered
        assert "do not invent" in lowered
        assert "price" in lowered and "sla" in lowered
        assert "payment card" in lowered
        # Repository templates may discuss commercial fields but may not bake in
        # concrete prices, discounts, or uptime promises.
        assert re.search(r"(?:usd|eur|gbp)\s*[0-9]", text, re.I) is None
        assert re.search(r"\$\s*[0-9]", text) is None
        assert re.search(r"\b[0-9]+(?:\.[0-9]+)?%\s*(?:discount|uptime|availability)", text, re.I) is None


def main() -> None:
    assert_packet_boundary()

    # The contract authority must not accept payment-card or invented commercial
    # promise fields in its public method signatures.
    forbidden_params = {"card", "card_number", "cvv", "price", "discount", "sla", "uptime"}
    for method_name in (
        "create_contract",
        "record_procurement_evidence",
        "execute_contract",
        "suspend_contract",
        "onboarding_evidence",
        "procurement_packet",
    ):
        method = getattr(EnterpriseContractStore, method_name)
        params = {name.casefold() for name in inspect.signature(method).parameters}
        assert not (params & forbidden_params), f"forbidden commercial input on {method_name}"

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        identity = setup_identity(root / "identity.sqlite3")
        licensing = WorkspaceLicensingStore(root / "licensing.sqlite3", identity)
        contracts = EnterpriseContractStore(
            root / "contracts.sqlite3",
            identity=identity,
            licensing=licensing,
            packet_dir=PACKET_DIR,
        )

        # No contract means no licensing activation. This proves the new layer
        # controls commercial activation instead of bypassing the existing store.
        expect_error(
            lambda: licensing.create_invitation(
                "owner",
                "org-acme",
                invitation_id="precontract",
                principal_id="analyst",
                workspace_id="ws-finance",
                expires_at_epoch=500,
                idempotency_key="precontract-1",
                now_epoch=100,
            ),
            LicensingAuthorizationError,
            "active licensing plan",
        )

        # Tenant managers only; analysts and cross-tenant owners cannot author the
        # procurement contract for another organization.
        for actor in ("analyst", "other-owner"):
            expect_error(
                lambda actor=actor: contracts.create_contract(
                    actor,
                    "org-acme",
                    contract_id=f"bad-{actor}",
                    plan_id="enterprise-annual",
                    seat_limit=25,
                    pooled_units_limit=10000,
                    billing_reference="procurement:acme-2026",
                    support_process_reference="support:enterprise-standard",
                    idempotency_key=f"bad-{actor}-1",
                    now_epoch=110,
                ),
                ContractAuthorizationError,
                "workspace.manage",
            )

        created = contracts.create_contract(
            "owner",
            "org-acme",
            contract_id="contract-acme-2026",
            plan_id="enterprise-annual",
            seat_limit=25,
            pooled_units_limit=10000,
            billing_reference="procurement:acme-2026",
            support_process_reference="support:enterprise-standard",
            idempotency_key="contract-create-1",
            now_epoch=120,
        )
        assert created["created"] is True
        assert created["contract"]["status"] == "draft"
        repeated = contracts.create_contract(
            "owner",
            "org-acme",
            contract_id="contract-acme-2026",
            plan_id="enterprise-annual",
            seat_limit=25,
            pooled_units_limit=10000,
            billing_reference="procurement:acme-2026",
            support_process_reference="support:enterprise-standard",
            idempotency_key="contract-create-1",
            now_epoch=121,
        )
        assert repeated["created"] is False
        expect_error(
            lambda: contracts.create_contract(
                "owner",
                "org-acme",
                contract_id="contract-acme-2026",
                plan_id="enterprise-annual",
                seat_limit=30,
                pooled_units_limit=10000,
                billing_reference="procurement:acme-2026",
                support_process_reference="support:enterprise-standard",
                idempotency_key="contract-create-1",
                now_epoch=122,
            ),
            ContractConflict,
            "idempotency",
        )

        # Draft/incomplete procurement state must never activate entitlement.
        expect_error(
            lambda: contracts.execute_contract(
                "owner",
                "org-acme",
                "contract-acme-2026",
                execution_evidence_sha256="e" * 64,
                idempotency_key="execute-too-early",
                now_epoch=130,
            ),
            ContractStateError,
            "procurement",
        )
        expect_error(
            lambda: licensing.create_invitation(
                "owner",
                "org-acme",
                invitation_id="still-precontract",
                principal_id="analyst",
                workspace_id="ws-finance",
                expires_at_epoch=500,
                idempotency_key="still-precontract-1",
                now_epoch=131,
            ),
            LicensingAuthorizationError,
            "active licensing plan",
        )

        # Every required procurement artifact is evidence-hash bound. No opaque
        # boolean can mark a checklist item complete without evidence.
        required = contracts.required_procurement_items()
        assert set(required) == {
            "order_form",
            "sow",
            "security_appendix",
            "support_process",
            "privacy_data_handling",
            "authorized_approval",
        }
        for index, item in enumerate(required, start=1):
            result = contracts.record_procurement_evidence(
                "owner",
                "org-acme",
                "contract-acme-2026",
                item=item,
                evidence_sha256=f"{index:064x}",
                idempotency_key=f"procurement-{index}",
                now_epoch=140 + index,
            )
            assert result["item"] == item
            assert HEX64.fullmatch(result["evidence_sha256"])

        packet = contracts.procurement_packet("owner", "org-acme", "contract-acme-2026")
        assert packet["complete"] is True
        assert packet["missing_items"] == []
        assert set(packet["documents"]) == set(REQUIRED_DOCS)
        for metadata in packet["documents"].values():
            assert HEX64.fullmatch(metadata["sha256"])
            assert metadata["path"].startswith("frontier_v5/enterprise_contracts/")

        # Invalid evidence and unknown checklist items fail closed.
        expect_error(
            lambda: contracts.record_procurement_evidence(
                "owner",
                "org-acme",
                "contract-acme-2026",
                item="invented-approval",
                evidence_sha256="f" * 64,
                idempotency_key="bad-item",
                now_epoch=150,
            ),
            ContractError,
            "item",
        )
        expect_error(
            lambda: contracts.record_procurement_evidence(
                "owner",
                "org-acme",
                "contract-acme-2026",
                item="order_form",
                evidence_sha256="not-a-digest",
                idempotency_key="bad-digest",
                now_epoch=151,
            ),
            ContractError,
            "sha256",
        )

        executed = contracts.execute_contract(
            "owner",
            "org-acme",
            "contract-acme-2026",
            execution_evidence_sha256="e" * 64,
            idempotency_key="execute-1",
            now_epoch=160,
        )
        assert executed["status"] == "executed"
        plan = licensing.plan_summary("org-acme")
        assert plan["plan_id"] == "enterprise-annual"
        assert plan["seat_limit"] == 25
        assert plan["pooled_units_limit"] == 10000
        assert plan["status"] == "active"

        # A dry-run onboarding envelope must bind contract, entitlement, admin,
        # support, procurement and audit evidence without exposing payment data or
        # inventing negotiated commercial promises.
        evidence = contracts.onboarding_evidence("owner", "org-acme", "contract-acme-2026")
        assert evidence["contract_status"] == "executed"
        assert evidence["entitlement"]["status"] == "active"
        assert evidence["admin_principal_id"] == "owner"
        assert evidence["support_process_reference"] == "support:enterprise-standard"
        assert evidence["procurement_complete"] is True
        assert evidence["contract_audit_chain_valid"] is True
        assert evidence["licensing_audit_chain_valid"] is True
        assert HEX64.fullmatch(evidence["execution_evidence_sha256"])
        serialized = repr(evidence).casefold()
        for forbidden in ("card_number", "cvv", "guaranteed uptime", "discount_percent"):
            assert forbidden not in serialized

        # Suspending the commercial contract must suspend the already-existing
        # entitlement rather than leaving a plan active after contract revocation.
        suspended = contracts.suspend_contract(
            "owner",
            "org-acme",
            "contract-acme-2026",
            reason_reference="procurement:suspension-approved",
            idempotency_key="suspend-1",
            now_epoch=170,
        )
        assert suspended["status"] == "suspended"
        assert licensing.plan_summary("org-acme")["status"] == "suspended"
        assert contracts.verify_audit_chain("org-acme") is True
        assert licensing.verify_audit_chain("org-acme") is True

        # Tenant isolation: an owner in another org cannot read or mutate Acme's
        # contract evidence.
        expect_error(
            lambda: contracts.procurement_packet(
                "other-owner", "org-acme", "contract-acme-2026"
            ),
            ContractAuthorizationError,
            "workspace.manage",
        )

        contracts.close()
        licensing.close()
        identity.close()

    print("MUSITU_AXIOM_FRONTIER_ENTERPRISE_CONTRACTS_PASS")


if __name__ == "__main__":
    main()

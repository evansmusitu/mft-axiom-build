#!/usr/bin/env python3
"""Red/green enterprise identity, domain policy, RBAC and audit contract."""
from __future__ import annotations

from pathlib import Path
import tempfile

from frontier_v5.runtime.enterprise_identity import (
    EnterpriseAuthorizationError,
    EnterpriseIdentityError,
    EnterpriseIdentityStore,
)


def expect_error(fn, exc=Exception, contains: str = "") -> None:
    try:
        fn()
    except exc as err:
        if contains and contains not in str(err):
            raise AssertionError(f"expected {contains!r}, got {err!r}") from err
        return
    raise AssertionError(f"expected {exc.__name__}")


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        db_path = Path(td) / "enterprise-identity.db"
        store = EnterpriseIdentityStore(db_path)

        # Bootstrap creates the first organization and owner atomically. Domain
        # restriction is active only after the domain is explicitly verified.
        store.register_user("alice", "alice@acme.example", email_verified=True)
        store.bootstrap_organization("org-acme", "Acme", "alice")
        store.add_domain("alice", "org-acme", "ACME.EXAMPLE")
        store.verify_domain("alice", "org-acme", "acme.example", evidence_sha256="a" * 64)
        assert store.organization("org-acme")["status"] == "active"
        assert store.domains("org-acme") == [{"domain": "acme.example", "verified": True}]

        # Owner can create workspaces. Workspace and membership decisions are
        # always organization-bound.
        store.create_workspace("alice", "org-acme", "ws-fpa", "FP&A")
        assert store.authorize("alice", "org-acme", "workspace.manage", workspace_id="ws-fpa")

        store.register_user("bob", "bob@acme.example", email_verified=True)
        store.add_membership("alice", "org-acme", "bob", "analyst")
        assert store.authorize("bob", "org-acme", "analysis.execute", workspace_id="ws-fpa")
        assert store.authorize("bob", "org-acme", "analysis.read", workspace_id="ws-fpa")
        expect_error(lambda: store.authorize("bob", "org-acme", "member.manage"), EnterpriseAuthorizationError, "permission")

        # Verified-domain policy fails closed: wrong-domain and unverified-email
        # principals cannot be admitted to a restricted organization.
        store.register_user("eve", "eve@evil.example", email_verified=True)
        expect_error(lambda: store.add_membership("alice", "org-acme", "eve", "viewer"), EnterpriseAuthorizationError, "domain")
        store.register_user("charlie", "charlie@acme.example", email_verified=False)
        expect_error(lambda: store.add_membership("alice", "org-acme", "charlie", "viewer"), EnterpriseAuthorizationError, "verified email")

        # Invalid role or privilege-escalation attempts fail closed.
        expect_error(lambda: store.add_membership("alice", "org-acme", "bob", "superadmin"), EnterpriseIdentityError, "role")
        store.set_role("alice", "org-acme", "bob", "admin")
        assert store.authorize("bob", "org-acme", "workspace.manage")
        expect_error(lambda: store.set_role("bob", "org-acme", "bob", "owner"), EnterpriseAuthorizationError, "owner")

        # The last owner cannot be demoted, suspended or removed. This prevents
        # accidental administrative lockout and self-service privilege games.
        expect_error(lambda: store.set_role("alice", "org-acme", "alice", "admin"), EnterpriseIdentityError, "last owner")
        expect_error(lambda: store.set_membership_status("alice", "org-acme", "alice", "suspended"), EnterpriseIdentityError, "last owner")

        # Cross-tenant isolation is explicit, including guessed workspace IDs.
        store.register_user("owner2", "owner@other.example", email_verified=True)
        store.bootstrap_organization("org-other", "Other", "owner2")
        store.add_domain("owner2", "org-other", "other.example")
        store.verify_domain("owner2", "org-other", "other.example", evidence_sha256="b" * 64)
        store.create_workspace("owner2", "org-other", "ws-secret", "Secret")
        expect_error(lambda: store.authorize("bob", "org-acme", "analysis.read", workspace_id="ws-secret"), EnterpriseAuthorizationError, "tenant")
        expect_error(lambda: store.authorize("bob", "org-other", "analysis.read", workspace_id="ws-secret"), EnterpriseAuthorizationError, "membership")

        # Membership revocation is immediate and denial is the default.
        store.set_membership_status("alice", "org-acme", "bob", "suspended")
        expect_error(lambda: store.authorize("bob", "org-acme", "analysis.read"), EnterpriseAuthorizationError, "membership")
        store.set_membership_status("alice", "org-acme", "bob", "active")
        assert store.authorize("bob", "org-acme", "analysis.read")

        # Organization suspension denies every ordinary permission.
        store.set_organization_status("alice", "org-acme", "suspended")
        expect_error(lambda: store.authorize("alice", "org-acme", "analysis.read"), EnterpriseAuthorizationError, "organization")
        store.set_organization_status("alice", "org-acme", "active", allow_suspended_actor=True)

        # Every administrative mutation is hash-chained. Normal export verifies;
        # direct database tampering is detected rather than silently trusted.
        exported = store.audit_export("alice", "org-acme")
        assert exported["events"] and exported["chain_valid"] is True
        assert store.verify_audit_chain("org-acme") is True
        store._db.execute("UPDATE enterprise_audit SET payload_json='{}' WHERE org_id=? AND sequence=(SELECT MIN(sequence) FROM enterprise_audit WHERE org_id=?)", ("org-acme", "org-acme"))
        store._db.commit()
        assert store.verify_audit_chain("org-acme") is False

        store.close()

    print("MUSITU_AXIOM_FRONTIER_ENTERPRISE_IDENTITY_CONTRACT_PASS")


if __name__ == "__main__":
    main()

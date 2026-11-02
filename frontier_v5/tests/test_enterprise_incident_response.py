#!/usr/bin/env python3
"""Behavior contract for Frontier enterprise incident-response governance."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

try:
    from frontier_v5.runtime.incident_response import (
        EnterpriseIncidentManager,
        IncidentAuthorizationError,
        IncidentClosureError,
        IncidentInputError,
        IncidentNotFoundError,
    )
except ModuleNotFoundError as exc:  # explicit red phase
    raise AssertionError("enterprise incident-response runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def prepare_roles(mgr, tenant: str, incident: str, now: int) -> None:
    for role, principal in (
        ("incident_commander", "ic-1"),
        ("technical_lead", "tech-1"),
        ("communications_lead", "comms-1"),
    ):
        mgr.assign_role(
            tenant, incident, role=role, principal_id=principal,
            actor="owner", authorized=True, now_epoch=now,
        )


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "incidents.sqlite3"
        mgr = EnterpriseIncidentManager(db_path)

        expect_raises(
            IncidentInputError,
            lambda: mgr.open_incident(
                "org-a", "bad-sev", incident_type="provider_outage",
                severity="SEV9", reporter="monitor", summary="invalid",
                now_epoch=100,
            ),
            "severity",
        )

        token = mgr.open_incident(
            "org-a", "inc-token", incident_type="compromised_token",
            severity="SEV1", reporter="security-monitor",
            summary="Synthetic token compromise tabletop", now_epoch=100,
        )
        assert token["status"] == "detected"
        assert token["severity"] == "SEV1"

        expect_raises(
            IncidentAuthorizationError,
            lambda: mgr.assign_role(
                "org-a", "inc-token", role="incident_commander",
                principal_id="attacker", actor="viewer", authorized=False,
                now_epoch=101,
            ),
            "authorized",
        )
        prepare_roles(mgr, "org-a", "inc-token", 102)

        expect_raises(
            IncidentInputError,
            lambda: mgr.record_evidence(
                "org-a", "inc-token", evidence_id="ev-bad", actor="tech-1",
                evidence_type="token-log", source_ref="auth/log/fixture",
                sha256="not-a-digest", captured_epoch=103, now_epoch=103,
            ),
            "sha256",
        )
        ev = mgr.record_evidence(
            "org-a", "inc-token", evidence_id="ev-token", actor="tech-1",
            evidence_type="token-log", source_ref="auth/log/fixture",
            sha256="a" * 64, captured_epoch=103, now_epoch=103,
        )
        assert ev["sha256"] == "a" * 64
        mgr.record_containment(
            "org-a", "inc-token", action_id="contain-token",
            action_type="revoke_token", actor="tech-1",
            summary="Revoked synthetic compromised credential", now_epoch=104,
        )
        action = mgr.add_corrective_action(
            "org-a", "inc-token", action_id="act-token",
            owner="security", priority="critical", due_epoch=150,
            summary="Rotate affected synthetic credential family", now_epoch=105,
        )
        assert action["status"] == "open"

        expect_raises(
            IncidentClosureError,
            lambda: mgr.close_incident(
                "org-a", "inc-token", actor="ic-1", authorized=True,
                now_epoch=110,
            ),
            "postmortem",
        )
        mgr.record_postmortem(
            "org-a", "inc-token", actor="ic-1",
            root_cause="Synthetic credential exposure fixture",
            lessons="Revoke and rotate credentials immediately",
            now_epoch=111,
        )
        expect_raises(
            IncidentClosureError,
            lambda: mgr.close_incident(
                "org-a", "inc-token", actor="ic-1", authorized=True,
                now_epoch=112,
            ),
            "critical",
        )
        mgr.resolve_corrective_action(
            "org-a", "inc-token", action_id="act-token",
            actor="security", resolution="Rotation verified", now_epoch=113,
        )
        closed_token = mgr.close_incident(
            "org-a", "inc-token", actor="ic-1", authorized=True,
            now_epoch=114,
        )
        assert closed_token["status"] == "closed"

        # Data-leak tabletop: closure is blocked by an overdue notification
        # obligation until a sent timestamp is recorded.
        mgr.open_incident(
            "org-a", "inc-leak", incident_type="data_leak", severity="SEV0",
            reporter="dlp-monitor", summary="Synthetic data leak tabletop",
            now_epoch=200,
        )
        prepare_roles(mgr, "org-a", "inc-leak", 201)
        mgr.record_evidence(
            "org-a", "inc-leak", evidence_id="ev-leak", actor="tech-1",
            evidence_type="data-flow", source_ref="storage/fixture",
            sha256="b" * 64, captured_epoch=202, now_epoch=202,
        )
        mgr.record_containment(
            "org-a", "inc-leak", action_id="contain-leak",
            action_type="isolate_data_path", actor="tech-1",
            summary="Isolated synthetic affected path", now_epoch=203,
        )
        notice = mgr.create_notification_obligation(
            "org-a", "inc-leak", notification_id="notice-customer",
            audience="customer", owner="comms-1", due_epoch=210,
            rationale="Synthetic affected-customer notification exercise",
            now_epoch=204,
        )
        assert notice["status"] == "pending"
        report = mgr.incident_report("org-a", "inc-leak", now_epoch=211)
        assert report["overdue_notifications"] == 1
        mgr.record_postmortem(
            "org-a", "inc-leak", actor="ic-1",
            root_cause="Synthetic access-control failure fixture",
            lessons="Enforce least privilege and notification timers",
            now_epoch=212,
        )
        expect_raises(
            IncidentClosureError,
            lambda: mgr.close_incident(
                "org-a", "inc-leak", actor="ic-1", authorized=True,
                now_epoch=213,
            ),
            "notification",
        )
        mgr.mark_notification_sent(
            "org-a", "inc-leak", notification_id="notice-customer",
            actor="comms-1", sent_epoch=214, now_epoch=214,
        )
        assert mgr.close_incident(
            "org-a", "inc-leak", actor="ic-1", authorized=True,
            now_epoch=215,
        )["status"] == "closed"

        # Provider-outage tabletop requires a failover/degrade containment record.
        mgr.open_incident(
            "org-b", "inc-provider", incident_type="provider_outage",
            severity="SEV2", reporter="uptime-monitor",
            summary="Synthetic provider outage tabletop", now_epoch=300,
        )
        prepare_roles(mgr, "org-b", "inc-provider", 301)
        mgr.record_evidence(
            "org-b", "inc-provider", evidence_id="ev-provider", actor="tech-1",
            evidence_type="provider-status", source_ref="provider/fixture",
            sha256="c" * 64, captured_epoch=302, now_epoch=302,
        )
        mgr.record_containment(
            "org-b", "inc-provider", action_id="contain-provider",
            action_type="failover_or_degrade", actor="tech-1",
            summary="Synthetic failover executed", now_epoch=303,
        )
        mgr.record_postmortem(
            "org-b", "inc-provider", actor="ic-1",
            root_cause="Synthetic upstream provider failure",
            lessons="Maintain tested degraded-mode path", now_epoch=304,
        )
        assert mgr.close_incident(
            "org-b", "inc-provider", actor="ic-1", authorized=True,
            now_epoch=305,
        )["status"] == "closed"

        # Cross-tenant reads fail closed and audit chains are isolated.
        expect_raises(
            IncidentNotFoundError,
            lambda: mgr.incident_report("org-a", "inc-provider", now_epoch=306),
            "not found",
        )
        assert mgr.verify_audit_chain("org-a") is True
        assert mgr.verify_audit_chain("org-b") is True

        raw = sqlite3.connect(db_path)
        raw.execute(
            "UPDATE incident_audit SET payload_json='{}' WHERE tenant_id='org-a' AND sequence=(SELECT min(sequence) FROM incident_audit WHERE tenant_id='org-a')"
        )
        raw.commit()
        raw.close()
        assert mgr.verify_audit_chain("org-a") is False
        assert mgr.verify_audit_chain("org-b") is True
        mgr.close()

    print("MUSITU_AXIOM_FRONTIER_ENTERPRISE_INCIDENT_RESPONSE_PASS")


if __name__ == "__main__":
    main()

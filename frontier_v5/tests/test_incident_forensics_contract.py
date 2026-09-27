#!/usr/bin/env python3
"""OPS-013 behavior contract for evidence-preserving incident forensics."""
from __future__ import annotations

from copy import deepcopy
import tempfile
from pathlib import Path

from frontier_v5.runtime.incident_response import (
    EnterpriseIncidentManager,
    IncidentAuthorizationError,
)


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        mgr = EnterpriseIncidentManager(Path(tmp) / "incidents.sqlite3")
        mgr.open_incident(
            "org-a",
            "inc-forensics",
            incident_type="data_leak",
            severity="SEV1",
            reporter="monitor",
            summary="Synthetic incident for forensic export",
            now_epoch=100,
        )
        mgr.assign_role(
            "org-a",
            "inc-forensics",
            role="incident_commander",
            principal_id="ic-1",
            actor="owner",
            authorized=True,
            now_epoch=101,
        )
        mgr.record_evidence(
            "org-a",
            "inc-forensics",
            evidence_id="ev-log",
            actor="analyst-1",
            evidence_type="audit-log",
            source_ref="logs/synthetic.jsonl",
            sha256="a" * 64,
            captured_epoch=102,
            now_epoch=103,
        )

        # A separate tenant may reuse the same incident ID; its state must never
        # appear in org-a's forensic package.
        mgr.open_incident(
            "org-b",
            "inc-forensics",
            incident_type="provider_outage",
            severity="SEV2",
            reporter="monitor-b",
            summary="Other tenant synthetic incident",
            now_epoch=104,
        )

        if not hasattr(mgr, "export_forensic_snapshot") or not hasattr(
            mgr, "verify_forensic_snapshot"
        ):
            raise AssertionError("OPS-013 incident forensic snapshot/export behavior is missing")

        expect_raises(
            IncidentAuthorizationError,
            lambda: mgr.export_forensic_snapshot(
                "org-a",
                "inc-forensics",
                actor="viewer",
                authorized=False,
                now_epoch=110,
            ),
            "authorized",
        )

        bundle = mgr.export_forensic_snapshot(
            "org-a",
            "inc-forensics",
            actor="forensics-1",
            authorized=True,
            now_epoch=110,
        )
        assert bundle["schema"] == "musitu.axiom.incident-forensics.v1"
        assert bundle["tenant_id"] == "org-a"
        assert bundle["incident_id"] == "inc-forensics"
        assert bundle["exported_by"] == "forensics-1"
        assert bundle["exported_epoch"] == 110
        assert bundle["state"]["incident"]["summary"] == "Synthetic incident for forensic export"
        assert len(bundle["state"]["evidence"]) == 1
        assert bundle["state"]["evidence"][0]["evidence_id"] == "ev-log"
        assert bundle["state"]["evidence"][0]["sha256"] == "a" * 64
        assert all(
            row.get("tenant_id") == "org-a"
            for rows in bundle["state"].values()
            for row in (rows if isinstance(rows, list) else [rows] if isinstance(rows, dict) else [])
            if "tenant_id" in row
        )
        assert len(bundle["state_sha256"]) == 64
        assert len(bundle["bundle_sha256"]) == 64

        custody = bundle["chain_of_custody"]
        assert custody["evidence_count"] == 1
        assert custody["evidence_manifest"] == [
            {
                "evidence_id": "ev-log",
                "sha256": "a" * 64,
                "captured_epoch": 102,
                "recorded_epoch": 103,
                "recorded_by": "analyst-1",
                "source_ref": "logs/synthetic.jsonl",
            }
        ]
        assert custody["audit_event_count"] >= 4
        assert len(custody["export_event_sha256"]) == 64
        assert custody["export_event_sha256"] == custody["tenant_chain_tip_sha256"]
        assert mgr.verify_forensic_snapshot(bundle) is True

        tampered_state = deepcopy(bundle)
        tampered_state["state"]["incident"]["summary"] = "tampered"
        assert mgr.verify_forensic_snapshot(tampered_state) is False

        tampered_custody = deepcopy(bundle)
        tampered_custody["chain_of_custody"]["evidence_manifest"][0]["sha256"] = "b" * 64
        assert mgr.verify_forensic_snapshot(tampered_custody) is False

        mgr.close()

    print("MUSITU_AXIOM_FRONTIER_INCIDENT_FORENSICS_PASS")


if __name__ == "__main__":
    main()

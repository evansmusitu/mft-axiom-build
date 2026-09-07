#!/usr/bin/env python3
"""RED/green contract for explicit persistent planning and replanning.

Passing this contract is Level-2 functional evidence only. It does not claim a
production planner deployment, model quality, or autonomous authority.
"""
from __future__ import annotations

from pathlib import Path
import tempfile

from frontier_v5.runtime.persistent_planner import (
    PlanConflict,
    PlanNotFound,
    PlannerStore,
    ReplanRequired,
    TerminatedPlan,
)


def expect_error(fn, exc=Exception):
    try:
        fn()
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


def node(node_id, action, *, deps=(), preconditions=None, side_effecting=False):
    return {
        "node_id": node_id,
        "action": action,
        "dependencies": list(deps),
        "preconditions": dict(preconditions or {}),
        "side_effecting": side_effecting,
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "planner.db"
        store = PlannerStore(db)

        # Explicit acyclic plan graph with premises/preconditions and a bounded
        # termination contract.
        created = store.create_plan(
            "tenant-a",
            goal="Produce an evidence-backed company analysis",
            premises={"data_fresh": "yes", "provider_health": "up"},
            nodes=[
                node("retrieve", "retrieve_sources", preconditions={"data_fresh": "yes"}),
                node("analyze", "analyze_company", deps=("retrieve",)),
                node("publish", "publish_report", deps=("analyze",), side_effecting=True),
            ],
            plan_key="analysis-001",
            max_replans=4,
        )
        assert created["created"] is True
        plan_id = created["plan_id"]
        duplicate = store.create_plan(
            "tenant-a",
            goal="Produce an evidence-backed company analysis",
            premises={"data_fresh": "yes", "provider_health": "up"},
            nodes=[
                node("retrieve", "retrieve_sources", preconditions={"data_fresh": "yes"}),
                node("analyze", "analyze_company", deps=("retrieve",)),
                node("publish", "publish_report", deps=("analyze",), side_effecting=True),
            ],
            plan_key="analysis-001",
            max_replans=4,
        )
        assert duplicate == {"plan_id": plan_id, "created": False}
        expect_error(
            lambda: store.create_plan(
                "tenant-a", "Different goal", {}, [node("x", "x")], "analysis-001", 4
            ),
            PlanConflict,
        )

        # Dependencies and premises gate execution deterministically.
        assert [n["node_id"] for n in store.ready_nodes("tenant-a", plan_id)] == ["retrieve"]
        expect_error(lambda: store.start_node("tenant-a", plan_id, "analyze"), PlanConflict)
        store.start_node("tenant-a", plan_id, "retrieve")
        store.complete_node("tenant-a", plan_id, "retrieve", {"sources": 8})
        assert [n["node_id"] for n in store.ready_nodes("tenant-a", plan_id)] == ["analyze"]

        # Tool failure makes replanning mandatory and records why; failed work
        # cannot simply be continued under stale assumptions.
        store.start_node("tenant-a", plan_id, "analyze")
        assert store.fail_node(
            "tenant-a", plan_id, "analyze", "TOOL_FAILURE", {"tool": "primary-analyzer"}
        ) == "REPLAN_REQUIRED"
        expect_error(lambda: store.ready_nodes("tenant-a", plan_id), ReplanRequired)
        before = store.get_plan("tenant-a", plan_id)
        assert before["revision"] == 0
        replanned = store.apply_replan(
            "tenant-a",
            plan_id,
            expected_revision=0,
            trigger="TOOL_FAILURE",
            rationale="Primary analyzer failed; use isolated fallback analyzer",
            retire_nodes=["analyze"],
            replacement_nodes=[
                node("analyze-fallback", "analyze_company_fallback", deps=("retrieve",)),
            ],
            dependency_rewrites={"publish": ["analyze-fallback"]},
        )
        assert replanned["revision"] == 1 and replanned["status"] == "ACTIVE"
        assert replanned["last_replan"]["trigger"] == "TOOL_FAILURE"
        assert "Primary analyzer failed" in replanned["last_replan"]["rationale"]
        assert [n["node_id"] for n in store.ready_nodes("tenant-a", plan_id)] == ["analyze-fallback"]

        store.start_node("tenant-a", plan_id, "analyze-fallback")
        store.complete_node("tenant-a", plan_id, "analyze-fallback", {"finding": "ok"})
        assert [n["node_id"] for n in store.ready_nodes("tenant-a", plan_id)] == ["publish"]

        # Side effects are reserved under a stable idempotency token. A replan
        # must preserve completed side effects and must not allow them to be
        # retired/replayed under a conflicting request.
        store.start_node("tenant-a", plan_id, "publish")
        effect = store.reserve_effect(
            "tenant-a", plan_id, "publish", "report-v1", {"destination": "workspace"}
        )
        repeated = store.reserve_effect(
            "tenant-a", plan_id, "publish", "report-v1", {"destination": "workspace"}
        )
        assert repeated["created"] is False and repeated["effect_token"] == effect["effect_token"]
        expect_error(
            lambda: store.reserve_effect(
                "tenant-a", plan_id, "publish", "report-v1", {"destination": "other"}
            ),
            PlanConflict,
        )
        store.complete_effect(
            "tenant-a", plan_id, "publish", "report-v1", effect["effect_token"], {"written": True}
        )
        store.complete_node("tenant-a", plan_id, "publish", {"report": "done"})
        assert store.get_plan("tenant-a", plan_id)["status"] == "SUCCEEDED"
        expect_error(
            lambda: store.apply_replan(
                "tenant-a", plan_id, 1, "GOAL_CHANGE", "try to replay completed publish",
                ["publish"], [node("publish2", "publish_report", deps=("analyze-fallback",), side_effecting=True)], {}
            ),
            PlanConflict,
        )

        # Restart persistence: graph, revisions, effect records and event-chain
        # evidence survive process death/reopen.
        store.close()
        store = PlannerStore(db)
        persisted = store.get_plan("tenant-a", plan_id)
        assert persisted["status"] == "SUCCEEDED" and persisted["revision"] == 1
        assert persisted["effects"][0]["status"] == "DONE"
        assert store.verify_history("tenant-a", plan_id) is True
        expect_error(lambda: store.get_plan("tenant-b", plan_id), PlanNotFound)

        # Stale premise forces a replan before any dependent step can run.
        p2 = store.create_plan(
            "tenant-a", "Refresh market brief", {"market_open": "yes"},
            [node("fetch", "fetch_market", preconditions={"market_open": "yes"}),
             node("brief", "write_brief", deps=("fetch",))],
            "brief-001", 3,
        )["plan_id"]
        assert store.update_premise("tenant-a", p2, "market_open", "no", "market closed") == "REPLAN_REQUIRED"
        expect_error(lambda: store.ready_nodes("tenant-a", p2), ReplanRequired)
        p2r = store.apply_replan(
            "tenant-a", p2, 0, "STALE_PREMISE", "Market closed; switch to close-data path",
            ["fetch"], [node("fetch-close", "fetch_close_data")], {"brief": ["fetch-close"]}
        )
        assert p2r["revision"] == 1

        # A changed goal is explicit, revisioned and auditable rather than
        # silently mutating the active plan.
        assert store.request_goal_change(
            "tenant-a", p2, "Produce a close-of-day market brief", "User changed scope"
        ) == "REPLAN_REQUIRED"
        p2r2 = store.apply_replan(
            "tenant-a", p2, 1, "GOAL_CHANGE", "Adopt the newly requested close-of-day goal",
            [], [], {}, new_goal="Produce a close-of-day market brief"
        )
        assert p2r2["revision"] == 2
        assert p2r2["goal"] == "Produce a close-of-day market brief"

        # Dependency outage is a first-class replan trigger.
        assert store.require_replan(
            "tenant-a", p2, "DEPENDENCY_OUTAGE", {"dependency": "market-data-primary"}
        ) == "REPLAN_REQUIRED"
        p2r3 = store.apply_replan(
            "tenant-a", p2, 2, "DEPENDENCY_OUTAGE", "Primary feed unavailable; use verified backup",
            ["fetch-close"], [node("fetch-backup", "fetch_backup_data")], {"brief": ["fetch-backup"]}
        )
        assert p2r3["revision"] == 3

        # Replan limits are termination rules: exceeding the declared bound
        # fails closed instead of looping forever.
        assert store.require_replan("tenant-a", p2, "TOOL_FAILURE", {"tool": "backup"}) == "REPLAN_REQUIRED"
        terminated = store.apply_replan(
            "tenant-a", p2, 3, "TOOL_FAILURE", "No further approved path",
            ["fetch-backup"], [], {}
        )
        assert terminated["status"] == "TERMINATED"
        expect_error(lambda: store.ready_nodes("tenant-a", p2), TerminatedPlan)

        # Event-chain tampering must be visible.
        p3 = store.create_plan("tenant-a", "Integrity", {}, [node("one", "one")], "integrity", 1)["plan_id"]
        assert store.verify_history("tenant-a", p3) is True
        store.db.execute("UPDATE plan_events SET payload_json='{}' WHERE plan_id=? AND sequence=0", (p3,))
        store.db.commit()
        assert store.verify_history("tenant-a", p3) is False
        store.close()

    print("MUSITU_AXIOM_FRONTIER_PERSISTENT_PLANNER_PASS")


if __name__ == "__main__":
    main()

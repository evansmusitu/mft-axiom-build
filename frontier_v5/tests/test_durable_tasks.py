#!/usr/bin/env python3
"""Red/green contract for durable, resumable Frontier task execution.

The test intentionally exercises process restart, stale leases, retries,
cancellation, scheduled recurrence, tenant isolation, effect idempotency tokens,
and tamper detection. Passing this test is Level-2 functional evidence only; it
does not claim a production task service exists until a live deployment is
separately verified.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile

from frontier_v5.runtime.durable_tasks import (
    CorruptTaskState,
    DurableTaskStore,
    LeaseError,
    TaskConflict,
    TaskNotFound,
)


class Clock:
    def __init__(self) -> None:
        self.value = datetime(2026, 9, 6, 20, 0, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.value

    def advance(self, **kwargs) -> None:
        self.value += timedelta(**kwargs)


def expect_error(fn, exc=Exception):
    try:
        fn()
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


def main() -> None:
    clock = Clock()
    with tempfile.TemporaryDirectory() as td:
        db_path = Path(td) / "durable-tasks.db"
        store = DurableTaskStore(db_path, now=clock)

        # Idempotent submission is exact for tenant+workflow+idempotency key.
        first = store.submit(
            "tenant-a", "research", {"company": "ACME"}, "request-001", max_attempts=3
        )
        duplicate = store.submit(
            "tenant-a", "research", {"company": "ACME"}, "request-001", max_attempts=3
        )
        assert first["created"] is True
        assert duplicate == {"task_id": first["task_id"], "created": False}
        expect_error(
            lambda: store.submit(
                "tenant-a", "research", {"company": "DIFFERENT"}, "request-001", max_attempts=3
            ),
            TaskConflict,
        )

        # Active leases cannot be stolen. Checkpoints and effect reservations
        # survive process restart. The effect token is stable so downstream
        # systems that honor idempotency keys can avoid duplicate side effects.
        claim = store.claim("tenant-a", "worker-1", lease_seconds=10, workflow="research")
        assert claim is not None and claim.attempt == 1
        assert store.claim("tenant-a", "worker-2", lease_seconds=10, workflow="research") is None
        checkpoint = store.checkpoint(
            "tenant-a", claim.task_id, "worker-1", "retrieval-complete", {"sources": 4}
        )
        assert checkpoint["sequence"] == 0
        effect = store.reserve_effect(
            "tenant-a", claim.task_id, "worker-1", "notify-owner", {"channel": "email"}
        )
        repeated_effect = store.reserve_effect(
            "tenant-a", claim.task_id, "worker-1", "notify-owner", {"channel": "email"}
        )
        assert repeated_effect["created"] is False
        assert repeated_effect["effect_token"] == effect["effect_token"]
        store.complete_effect(
            "tenant-a",
            claim.task_id,
            "worker-1",
            "notify-owner",
            effect["effect_token"],
            {"accepted": True},
        )
        store.close()

        # Simulate process death. The old worker's lease expires; a replacement
        # can reclaim the same task and continue from the durable checkpoint.
        clock.advance(seconds=11)
        store = DurableTaskStore(db_path, now=clock)
        recovered = store.claim("tenant-a", "worker-2", lease_seconds=10, workflow="research")
        assert recovered is not None
        assert recovered.task_id == claim.task_id and recovered.attempt == 2
        assert store.latest_checkpoint("tenant-a", claim.task_id)["payload"] == {"sources": 4}
        result_sha = store.complete(
            "tenant-a", claim.task_id, "worker-2", {"status": "done", "sources": 4}
        )
        assert len(result_sha) == 64
        final = store.get("tenant-a", claim.task_id)
        assert final["status"] == "SUCCEEDED" and final["attempt"] == 2
        assert store.verify_history("tenant-a", claim.task_id) is True
        evidence = store.evidence("tenant-a", claim.task_id)
        assert evidence["history_integrity"] is True
        assert evidence["checkpoint_count"] == 1
        assert evidence["effects"][0]["status"] == "DONE"

        # A different tenant gets a not-found result rather than resource
        # existence disclosure.
        expect_error(lambda: store.get("tenant-b", claim.task_id), TaskNotFound)

        # Queued cancellation is terminal; running cancellation is cooperative
        # and remains fail closed if the worker dies before acknowledging it.
        cancelled = store.submit("tenant-a", "cancel-queued", {}, "cancel-q")["task_id"]
        assert store.cancel("tenant-a", cancelled) == "CANCELLED"
        assert store.claim("tenant-a", "worker-x", workflow="cancel-queued") is None

        running_cancel = store.submit("tenant-a", "cancel-running", {}, "cancel-r")["task_id"]
        running_claim = store.claim("tenant-a", "worker-c", lease_seconds=5, workflow="cancel-running")
        assert running_claim is not None
        assert store.cancel("tenant-a", running_cancel) == "CANCEL_REQUESTED"
        clock.advance(seconds=6)
        # Claim performs expired-cancellation cleanup but never hands the task
        # to another worker.
        assert store.claim("tenant-a", "worker-d", workflow="cancel-running") is None
        assert store.get("tenant-a", running_cancel)["status"] == "CANCELLED"

        # Retry/backoff is durable and honors max attempts.
        retry_task = store.submit(
            "tenant-a", "retry-workflow", {"n": 1}, "retry-001", max_attempts=2
        )["task_id"]
        retry_claim = store.claim("tenant-a", "worker-r1", lease_seconds=10, workflow="retry-workflow")
        assert retry_claim is not None
        assert store.fail(
            "tenant-a", retry_task, "worker-r1", {"code": "TEMPORARY"}, retryable=True, backoff_seconds=5
        ) == "RETRY"
        assert store.claim("tenant-a", "worker-r2", workflow="retry-workflow") is None
        clock.advance(seconds=5)
        retry_claim_2 = store.claim("tenant-a", "worker-r2", lease_seconds=10, workflow="retry-workflow")
        assert retry_claim_2 is not None and retry_claim_2.attempt == 2
        assert store.fail(
            "tenant-a", retry_task, "worker-r2", {"code": "STILL_BROKEN"}, retryable=True
        ) == "FAILED"
        assert store.get("tenant-a", retry_task)["status"] == "FAILED"

        # Recurring schedules enqueue one durable, idempotent occurrence at a
        # time and can be disabled without deleting history.
        assert store.create_schedule(
            "tenant-a", "hourly-report", "scheduled-report", {"portfolio": "P1"}, 3600,
            next_run_at=clock(),
        )["created"] is True
        due = store.enqueue_due_schedules("tenant-a")
        assert len(due) == 1
        scheduled_task = due[0]["task_id"]
        assert store.get("tenant-a", scheduled_task)["workflow"] == "scheduled-report"
        assert store.enqueue_due_schedules("tenant-a") == []
        store.set_schedule_enabled("tenant-a", "hourly-report", False)
        clock.advance(hours=2)
        assert store.enqueue_due_schedules("tenant-a") == []

        # Corrupted checkpoints are detected rather than silently resumed.
        corrupt = store.submit("tenant-a", "corruption", {}, "corrupt-001")["task_id"]
        corrupt_claim = store.claim("tenant-a", "worker-z", lease_seconds=10, workflow="corruption")
        assert corrupt_claim is not None
        store.checkpoint("tenant-a", corrupt, "worker-z", "step-1", {"value": 42})
        store.db.execute("UPDATE checkpoints SET payload_json='{}' WHERE task_id=?", (corrupt,))
        store.db.commit()
        expect_error(lambda: store.latest_checkpoint("tenant-a", corrupt), CorruptTaskState)

        # Event-chain tampering is independently detectable.
        history_task = store.submit("tenant-a", "history", {}, "history-001")["task_id"]
        assert store.verify_history("tenant-a", history_task) is True
        store.db.execute(
            "UPDATE events SET payload_json='{}' WHERE task_id=? AND sequence=0", (history_task,)
        )
        store.db.commit()
        assert store.verify_history("tenant-a", history_task) is False

        store.close()

    print("MUSITU_AXIOM_FRONTIER_DURABLE_TASKS_PASS")


if __name__ == "__main__":
    main()

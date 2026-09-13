#!/usr/bin/env python3
from __future__ import annotations

from copy import deepcopy

from frontier_v5.runtime.pwa_resilience import DeviceNetworkMatrixGate, LocalOfflineQueue, OfflineActionRejected, PWAResilienceError


def expect(error, fn, contains: str) -> None:
    try:
        fn()
    except error as exc:
        assert contains in str(exc), (contains, str(exc))
    else:
        raise AssertionError(f"expected {error.__name__}")


def main() -> None:
    queue = LocalOfflineQueue(device_id="browser-device")
    preview = queue.prepare(kind="LOCAL_PROJECT_REFRESH", payload={"project_id": "project-1", "reason": "offline refresh"})
    expect(OfflineActionRejected, lambda: queue.enqueue(kind="LOCAL_PROJECT_REFRESH", payload={"project_id": "project-1", "reason": "changed"}, expected_preview_sha256=preview["preview_sha256"]), "stale or altered")
    action = queue.enqueue(kind="LOCAL_PROJECT_REFRESH", payload={"project_id": "project-1", "reason": "offline refresh"}, expected_preview_sha256=preview["preview_sha256"])
    deferred = queue.replay(action_id=action["action_id"], expected_action_sha256=action["action_sha256"], online=False)
    assert deferred["status"] == "DEFERRED_OFFLINE"
    receipt = queue.replay(action_id=action["action_id"], expected_action_sha256=action["action_sha256"], online=True)
    assert receipt["status"] == "COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT"
    assert receipt["external_side_effect"] is False
    replay = queue.replay(action_id=action["action_id"], expected_action_sha256=queue.actions[action["action_id"]]["action_sha256"], online=True)
    assert replay == receipt
    assert queue.verify()["status"] == "PASS"

    expect(OfflineActionRejected, lambda: queue.prepare(kind="EXTERNAL_WEBHOOK_DELIVERY", payload={"reason": "send"}), "not allow-listed")
    expect(OfflineActionRejected, lambda: queue.prepare(kind="LOCAL_PROJECT_REFRESH", payload={"project_id": "p", "reason": "api_key=sk_deadbeefdeadbeef"}), "secret-like")
    expect(OfflineActionRejected, lambda: queue.prepare(kind="LOCAL_PROJECT_REFRESH", payload={"project_id": "p", "reason": "refresh", "url": "https://example.test"}), "unsupported")
    tampered = deepcopy(queue.actions[action["action_id"]])
    queue.actions[action["action_id"]]["payload"]["reason"] = "tampered"
    assert queue.verify()["status"] == "FAIL"
    queue.actions[action["action_id"]] = tampered
    assert queue.verify()["status"] == "PASS"

    rows = [
        {"scenario": "mobile_constrained", "viewport_width": 390, "viewport_height": 844, "cpu_slowdown": 4, "latency_ms": 400, "downlink_kbps": 400, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False},
        {"scenario": "tablet_constrained", "viewport_width": 768, "viewport_height": 1024, "cpu_slowdown": 4, "latency_ms": 300, "downlink_kbps": 700, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False},
        {"scenario": "offline_reload", "viewport_width": 390, "viewport_height": 844, "cpu_slowdown": 4, "latency_ms": 0, "downlink_kbps": 0, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False},
        {"scenario": "reconnect_queue", "viewport_width": 390, "viewport_height": 844, "cpu_slowdown": 4, "latency_ms": 400, "downlink_kbps": 400, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False},
    ]
    matrix = DeviceNetworkMatrixGate().evaluate(rows)
    assert matrix["status"] == "IMPLEMENTATION_PASS_REAL_DEVICE_REQUIRED"
    assert matrix["implementation_ready"] is True
    assert matrix["phase14_qualification_allowed"] is False
    assert matrix["authenticated_real_device_present"] is False
    assert matrix["real_device_certification_claimed"] is False

    missing = DeviceNetworkMatrixGate().evaluate(rows[:-1])
    assert missing["status"] == "FAIL" and "reconnect_queue" in missing["missing_scenarios"]
    bad = deepcopy(rows)
    bad[0]["external_origin_authenticated"] = True
    expect(PWAResilienceError, lambda: DeviceNetworkMatrixGate().evaluate(bad), "emulated device")
    print("MUSITU_AXIOM_INTERFACE_PHASE14_PWA_RESILIENCE_PASS")


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
"""Fail-closed computer/browser execution substrate for MUSITU Axiom Frontier v5.

Phase 8 is deliberately scoped to a visible, deterministic local browser sandbox.
It provides action previews, explicit per-action approval, pause/stop/resume,
takeover, tamper-evident receipts, reversible local actions, domain/network policy,
restricted clipboard, permission-scoped credential handles and retrieved-content
prompt-injection quarantine. It does NOT claim arbitrary external-site execution,
OS-level computer control, hidden privileged browser sessions, plaintext secret
handling, or production isolation/certification.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse
import hashlib
import json
import re

from .retrieval_security import RetrievedContentFirewall, normalize_retrieved_text


class ComputerExecutionError(RuntimeError):
    """Base Phase-8 computer/browser execution failure."""


class ComputerPolicyViolation(ComputerExecutionError):
    """Requested operation violates the explicit sandbox/policy contract."""


class ComputerApprovalRequired(ComputerExecutionError):
    """Action cannot execute until its exact preview digest is approved."""


_ALLOWED_ACTIONS = frozenset({"observe", "navigate", "click", "type", "scroll"})
_REVERSIBLE_ACTIONS = frozenset({"navigate", "click", "type", "scroll"})
_SECRET_RX = re.compile(
    r"(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]",
    re.I,
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any, limit: int = 2000) -> str:
    return str(value if value is not None else "").replace("\x00", " ").strip()[:limit]


def _safe_host(url: str) -> str:
    parsed = urlparse(_clean(url, 2048))
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ComputerPolicyViolation("only explicit http/https targets with hostnames are allowed")
    if parsed.username or parsed.password:
        raise ComputerPolicyViolation("credentials in URLs are forbidden")
    return parsed.hostname.lower().rstrip(".")


def _is_domain_allowed(host: str, allowed_domains: Sequence[str]) -> bool:
    host = host.lower().rstrip(".")
    for raw in allowed_domains:
        candidate = raw.lower().strip().rstrip(".")
        if host == candidate:
            return True
    return False


class ComputerExecutionLedger:
    """Deterministic, visible local browser sandbox with fail-closed authority."""

    SCHEMA = "musitu.axiom.computer-execution.v1"
    EVIDENCE_SCHEMA = "musitu.axiom.computer-execution-evidence.v1"
    SANDBOX_MODE = "VISIBLE_LOCAL_DOCUMENT_SANDBOX_NO_EXTERNAL_NETWORK"
    NETWORK_MODE = "DENY_BY_DEFAULT_NO_RUNTIME_FETCH"
    CLIPBOARD_MODE = "SESSION_LOCAL_TEXT_ONLY_NO_SYSTEM_CLIPBOARD"
    CREDENTIAL_MODE = "SYMBOLIC_HANDLE_ONLY_NO_PLAINTEXT_SECRET_ACCESS"

    def __init__(
        self,
        *,
        session_id: str,
        project_id: str,
        actor_id: str,
        allowed_domains: Sequence[str],
        credential_scopes: Mapping[str, Sequence[str]] | None = None,
        started_at: str | None = None,
    ) -> None:
        session_id, project_id, actor_id = (_clean(session_id, 180), _clean(project_id, 180), _clean(actor_id, 180))
        domains = sorted({_clean(x, 253).lower().rstrip(".") for x in allowed_domains if _clean(x, 253)})
        if not session_id or not project_id or not actor_id or not domains:
            raise ValueError("session_id, project_id, actor_id and at least one allowed domain are required")
        self.actions: dict[str, dict[str, Any]] = {}
        self.receipts: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._clipboard: str | None = None
        self.credential_scopes = {
            _clean(handle, 180): tuple(sorted({_clean(d, 253).lower().rstrip(".") for d in domains if _clean(d, 253)}))
            for handle, domains in dict(credential_scopes or {}).items()
            if _clean(handle, 180)
        }
        at = started_at or _utcnow()
        self.session: dict[str, Any] = {
            "schema": self.SCHEMA,
            "session_id": session_id,
            "project_id": project_id,
            "actor_id": actor_id,
            "status": "ACTIVE",
            "takeover": False,
            "visible_surface_required": True,
            "hidden_privileged_session": False,
            "sandbox_mode": self.SANDBOX_MODE,
            "network_policy": self.NETWORK_MODE,
            "allowed_domains": domains,
            "clipboard_policy": self.CLIPBOARD_MODE,
            "credential_policy": self.CREDENTIAL_MODE,
            "current_url": None,
            "current_title": None,
            "current_step": "READY",
            "prompt_injection_quarantined": False,
            "prompt_injection_flags": [],
            "page_text_sha256": None,
            "sandbox_state": {"fields": {}, "clicks": {}, "scroll_y": 0},
            "started_at": at,
            "ended_at": None,
        }
        self._event("session.started", {"sandbox_mode": self.SANDBOX_MODE}, at=at)

    def _event(self, kind: str, payload: Mapping[str, Any] | None = None, *, at: str | None = None) -> dict[str, Any]:
        at = at or _utcnow()
        previous = self.events[-1]["event_sha256"] if self.events else None
        body = {
            "schema": "musitu.axiom.computer-event.v1",
            "event_id": f"{self.session['session_id']}:evt:{len(self.events)}",
            "sequence": len(self.events),
            "session_id": self.session["session_id"],
            "project_id": self.session["project_id"],
            "actor_id": self.session["actor_id"],
            "kind": _clean(kind, 100),
            "at": at,
            "payload": deepcopy(dict(payload or {})),
            "previous_event_sha256": previous,
        }
        event = {**body, "event_sha256": _sha(body)}
        self.events.append(event)
        return deepcopy(event)

    def _require_live(self) -> None:
        if self.session["status"] == "STOPPED":
            raise ComputerExecutionError("session is stopped")

    def _require_agent_control(self) -> None:
        self._require_live()
        if self.session["status"] != "ACTIVE":
            raise ComputerExecutionError("session must be active")
        if self.session["takeover"]:
            raise ComputerExecutionError("user takeover is active")

    def _validate_target(self, url: str) -> tuple[str, str]:
        clean_url = _clean(url, 2048)
        host = _safe_host(clean_url)
        if not _is_domain_allowed(host, self.session["allowed_domains"]):
            raise ComputerPolicyViolation(f"domain not allowed: {host}")
        return clean_url, host

    def load_document(self, *, url: str, title: str, retrieved_text: str, at: str | None = None) -> dict[str, Any]:
        """Observe supplied browser document bytes/text without doing any network fetch."""
        self._require_live()
        clean_url, host = self._validate_target(url)
        normalized = normalize_retrieved_text(retrieved_text)
        flags = list(RetrievedContentFirewall.scan(normalized))
        self.session["current_url"] = clean_url
        self.session["current_title"] = _clean(title, 300) or host
        self.session["current_step"] = "PAGE_OBSERVED"
        self.session["page_text_sha256"] = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        self.session["prompt_injection_flags"] = flags
        self.session["prompt_injection_quarantined"] = bool(flags)
        self._event(
            "page.observed",
            {
                "host": host,
                "page_text_sha256": self.session["page_text_sha256"],
                "prompt_injection_flags": flags,
                "retrieved_instruction_authority": "DATA_ONLY",
                "network_fetch_performed": False,
            },
            at=at,
        )
        if flags:
            self._event("policy.blocked", {"reason": "PROMPT_INJECTION_QUARANTINE", "flags": flags}, at=at)
        return {
            "url": clean_url,
            "host": host,
            "title": self.session["current_title"],
            "prompt_injection_flags": flags,
            "quarantined": bool(flags),
            "retrieved_instruction_authority": "DATA_ONLY",
            "network_fetch_performed": False,
        }

    def acknowledge_quarantine(self, *, actor_id: str, at: str | None = None) -> None:
        """Human may clear quarantine after inspection; embedded instructions still remain data-only."""
        self._require_live()
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("only the session actor may clear quarantine")
        if not self.session["prompt_injection_quarantined"]:
            return
        flags = list(self.session["prompt_injection_flags"])
        self.session["prompt_injection_quarantined"] = False
        self._event("quarantine.acknowledged", {"flags": flags, "authority_remains": "DATA_ONLY"}, at=at)

    def propose_action(
        self,
        *,
        action_id: str,
        action_type: str,
        target: str = "",
        value: Any = None,
        credential_handle: str | None = None,
        at: str | None = None,
    ) -> dict[str, Any]:
        self._require_agent_control()
        action_id, action_type, target = _clean(action_id, 180), _clean(action_type, 40).lower(), _clean(target, 2048)
        if not action_id or action_id in self.actions:
            raise ComputerExecutionError("action_id must be unique and non-empty")
        if action_type not in _ALLOWED_ACTIONS:
            raise ComputerPolicyViolation("unsupported or consequential action type")
        if self.session["prompt_injection_quarantined"] and action_type != "observe":
            raise ComputerPolicyViolation("page is quarantined for prompt injection; execution blocked")
        host = _safe_host(self.session["current_url"]) if self.session["current_url"] else None
        if action_type == "navigate":
            _, host = self._validate_target(target)
        if action_type == "type" and credential_handle:
            self.authorize_credential_handle(credential_handle, url=self.session["current_url"] or "")
            preview_value = f"credential-handle:{_clean(credential_handle, 180)}"
        else:
            preview_value = _clean(value, 2000) if value is not None else None
            if preview_value and _SECRET_RX.search(preview_value):
                raise ComputerPolicyViolation("plaintext secret-like material is forbidden; use a scoped credential handle")
        body = {
            "schema": "musitu.axiom.computer-action.v1",
            "action_id": action_id,
            "session_id": self.session["session_id"],
            "action_type": action_type,
            "target": target,
            "host": host,
            "preview_value": preview_value,
            "credential_handle": _clean(credential_handle, 180) if credential_handle else None,
            "approval_required": action_type != "observe",
            "status": "PROPOSED" if action_type != "observe" else "OBSERVED",
            "reversible": action_type in _REVERSIBLE_ACTIONS,
            "created_at": at or _utcnow(),
        }
        action = {**body, "action_sha256": _sha(body)}
        self.actions[action_id] = action
        self.session["current_step"] = "ACTION_PREVIEW"
        self._event(
            "action.proposed",
            {
                "action_id": action_id,
                "action_type": action_type,
                "action_sha256": action["action_sha256"],
                "approval_required": action["approval_required"],
            },
            at=at,
        )
        return deepcopy(action)

    def approve_action(
        self,
        *,
        action_id: str,
        actor_id: str,
        expected_action_sha256: str,
        rationale: str = "explicit action approval",
        at: str | None = None,
    ) -> dict[str, Any]:
        self._require_live()
        action = self.actions.get(_clean(action_id, 180))
        if not action:
            raise ComputerExecutionError("action not found")
        if action["status"] != "PROPOSED":
            raise ComputerExecutionError("action is not awaiting approval")
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("approval actor mismatch")
        if expected_action_sha256 != action["action_sha256"]:
            raise ComputerPolicyViolation("stale or altered action preview")
        at = at or _utcnow()
        receipt_body = {
            "schema": "musitu.axiom.computer-approval-receipt.v1",
            "receipt_id": f"approval:{action_id}",
            "session_id": self.session["session_id"],
            "action_id": action_id,
            "action_sha256": action["action_sha256"],
            "actor_id": self.session["actor_id"],
            "decision": "APPROVED",
            "rationale_sha256": _sha(_clean(rationale, 1000)),
            "created_at": at,
        }
        receipt = {**receipt_body, "receipt_sha256": _sha(receipt_body)}
        action["status"] = "APPROVED"
        action["approval_receipt_id"] = receipt["receipt_id"]
        self.receipts[receipt["receipt_id"]] = receipt
        self.session["current_step"] = "ACTION_APPROVED"
        self._event(
            "approval.granted",
            {"action_id": action_id, "receipt_id": receipt["receipt_id"], "receipt_sha256": receipt["receipt_sha256"]},
            at=at,
        )
        return deepcopy(receipt)

    def execute_action(self, action_id: str, *, at: str | None = None) -> dict[str, Any]:
        self._require_agent_control()
        action = self.actions.get(_clean(action_id, 180))
        if not action:
            raise ComputerExecutionError("action not found")
        if action["approval_required"] and action["status"] != "APPROVED":
            raise ComputerApprovalRequired("exact action preview must be approved before execution")
        if action["status"] == "OBSERVED":
            return deepcopy(action)
        if self.session["prompt_injection_quarantined"]:
            raise ComputerPolicyViolation("prompt-injection quarantine blocks execution")
        before = deepcopy(self.session["sandbox_state"])
        before_url = self.session["current_url"]
        self._snapshots[action_id] = {"sandbox_state": before, "current_url": before_url, "current_title": self.session["current_title"]}
        kind = action["action_type"]
        if kind == "navigate":
            target, _ = self._validate_target(action["target"])
            self.session["current_url"] = target
            self.session["current_title"] = target
        elif kind == "click":
            key = action["target"] or "default"
            clicks = self.session["sandbox_state"]["clicks"]
            clicks[key] = int(clicks.get(key, 0)) + 1
        elif kind == "type":
            key = action["target"] or "default"
            self.session["sandbox_state"]["fields"][key] = action["preview_value"]
        elif kind == "scroll":
            try:
                amount = int(action["preview_value"] or 0)
            except (TypeError, ValueError) as exc:
                raise ComputerPolicyViolation("scroll amount must be an integer") from exc
            self.session["sandbox_state"]["scroll_y"] = amount
        else:
            raise ComputerPolicyViolation("unsupported execution action")
        action["status"] = "COMPLETED"
        at = at or _utcnow()
        action["completed_at"] = at
        action["result_sha256"] = _sha({"url": self.session["current_url"], "sandbox_state": self.session["sandbox_state"]})
        receipt_body = {
            "schema": "musitu.axiom.computer-action-receipt.v1",
            "receipt_id": f"action:{action_id}",
            "session_id": self.session["session_id"],
            "action_id": action_id,
            "action_sha256": action["action_sha256"],
            "approval_receipt_id": action.get("approval_receipt_id"),
            "before_state_sha256": _sha({"url": before_url, "sandbox_state": before}),
            "after_state_sha256": action["result_sha256"],
            "reversible": action["reversible"],
            "network_request_performed": False,
            "hidden_privileged_session": False,
            "created_at": at,
        }
        receipt = {**receipt_body, "receipt_sha256": _sha(receipt_body)}
        self.receipts[receipt["receipt_id"]] = receipt
        self.session["current_step"] = "ACTION_COMPLETED"
        self._event(
            "action.completed",
            {
                "action_id": action_id,
                "receipt_id": receipt["receipt_id"],
                "receipt_sha256": receipt["receipt_sha256"],
                "reversible": action["reversible"],
            },
            at=at,
        )
        return deepcopy(receipt)

    def rollback(self, action_id: str, *, actor_id: str, at: str | None = None) -> dict[str, Any]:
        self._require_live()
        action = self.actions.get(_clean(action_id, 180))
        if not action or action["status"] != "COMPLETED":
            raise ComputerExecutionError("completed action required for rollback")
        if not action["reversible"] or action_id not in self._snapshots:
            raise ComputerPolicyViolation("action has no supported rollback")
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("rollback actor mismatch")
        snapshot = deepcopy(self._snapshots[action_id])
        self.session["sandbox_state"] = snapshot["sandbox_state"]
        self.session["current_url"] = snapshot["current_url"]
        self.session["current_title"] = snapshot["current_title"]
        action["status"] = "ROLLED_BACK"
        at = at or _utcnow()
        receipt_body = {
            "schema": "musitu.axiom.computer-rollback-receipt.v1",
            "receipt_id": f"rollback:{action_id}",
            "session_id": self.session["session_id"],
            "action_id": action_id,
            "actor_id": self.session["actor_id"],
            "restored_state_sha256": _sha({"url": self.session["current_url"], "sandbox_state": self.session["sandbox_state"]}),
            "created_at": at,
        }
        receipt = {**receipt_body, "receipt_sha256": _sha(receipt_body)}
        self.receipts[receipt["receipt_id"]] = receipt
        self.session["current_step"] = "ACTION_ROLLED_BACK"
        self._event("action.rolled_back", {"action_id": action_id, "receipt_id": receipt["receipt_id"]}, at=at)
        return deepcopy(receipt)

    def pause(self, *, actor_id: str, at: str | None = None) -> None:
        self._require_live()
        if self.session["status"] != "ACTIVE" or self.session["takeover"]:
            raise ComputerExecutionError("active non-takeover session required")
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("actor mismatch")
        self.session["status"] = "PAUSED"
        self.session["current_step"] = "PAUSED"
        self._event("session.paused", {}, at=at)

    def resume(self, *, actor_id: str, at: str | None = None) -> None:
        self._require_live()
        if self.session["status"] != "PAUSED" or self.session["takeover"]:
            raise ComputerExecutionError("paused non-takeover session required")
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("actor mismatch")
        self.session["status"] = "ACTIVE"
        self.session["current_step"] = "RESUMED"
        self._event("session.resumed", {}, at=at)

    def takeover(self, *, actor_id: str, at: str | None = None) -> None:
        self._require_live()
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("actor mismatch")
        self.session["takeover"] = True
        self.session["status"] = "PAUSED"
        self.session["current_step"] = "USER_TAKEOVER"
        self._event("takeover.started", {"agent_execution_enabled": False}, at=at)

    def release_takeover(self, *, actor_id: str, at: str | None = None) -> None:
        self._require_live()
        if not self.session["takeover"]:
            raise ComputerExecutionError("takeover is not active")
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("actor mismatch")
        self.session["takeover"] = False
        self.session["status"] = "ACTIVE"
        self.session["current_step"] = "TAKEOVER_RELEASED"
        self._event("takeover.ended", {"agent_execution_enabled": True}, at=at)

    def stop(self, *, actor_id: str, at: str | None = None) -> None:
        self._require_live()
        if _clean(actor_id, 180) != self.session["actor_id"]:
            raise ComputerPolicyViolation("actor mismatch")
        at = at or _utcnow()
        self.session["status"] = "STOPPED"
        self.session["takeover"] = False
        self.session["current_step"] = "STOPPED"
        self.session["ended_at"] = at
        self._clipboard = None
        self._event("session.stopped", {"clipboard_cleared": True}, at=at)

    def copy_to_restricted_clipboard(self, text: str, *, at: str | None = None) -> str:
        self._require_live()
        value = _clean(text, 4096)
        if not value:
            raise ValueError("clipboard text required")
        if _SECRET_RX.search(value):
            raise ComputerPolicyViolation("secret-like material cannot enter restricted clipboard")
        self._clipboard = value
        digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
        self._event("clipboard.copied", {"content_sha256": digest, "length": len(value)}, at=at)
        return digest

    def paste_from_restricted_clipboard(self) -> str:
        self._require_agent_control()
        if self._clipboard is None:
            raise ComputerExecutionError("restricted clipboard is empty")
        return self._clipboard

    def authorize_credential_handle(self, handle: str, *, url: str) -> dict[str, str]:
        handle = _clean(handle, 180)
        if handle not in self.credential_scopes:
            raise ComputerPolicyViolation("credential handle not granted")
        _, host = self._validate_target(url)
        if host not in self.credential_scopes[handle]:
            raise ComputerPolicyViolation("credential handle is outside its domain scope")
        return {"handle": handle, "host": host, "plaintext_secret_exposed": "false"}

    def verify_integrity(self) -> dict[str, Any]:
        errors: list[str] = []
        previous = None
        for i, event in enumerate(self.events):
            body = {k: v for k, v in event.items() if k != "event_sha256"}
            if event["sequence"] != i or event["previous_event_sha256"] != previous:
                errors.append(f"event_chain:{i}")
            if _sha(body) != event["event_sha256"]:
                errors.append(f"event_hash:{i}")
            previous = event["event_sha256"]
        for action_id, action in self.actions.items():
            immutable = {
                k: action[k]
                for k in [
                    "schema", "action_id", "session_id", "action_type", "target", "host", "preview_value",
                    "credential_handle", "approval_required", "reversible", "created_at"
                ]
            }
            original_body = {**immutable, "status": "PROPOSED" if action["approval_required"] else "OBSERVED"}
            if _sha(original_body) != action["action_sha256"]:
                errors.append(f"action_hash:{action_id}")
        for receipt_id, receipt in self.receipts.items():
            body = {k: v for k, v in receipt.items() if k != "receipt_sha256"}
            if _sha(body) != receipt["receipt_sha256"]:
                errors.append(f"receipt_hash:{receipt_id}")
        if self.session["hidden_privileged_session"] is not False:
            errors.append("hidden_privileged_session")
        if self.session["sandbox_mode"] != self.SANDBOX_MODE or self.session["network_policy"] != self.NETWORK_MODE:
            errors.append("sandbox_boundary")
        result = {
            "schema": "musitu.axiom.computer-integrity.v1",
            "status": "FAIL" if errors else "PASS",
            "session_id": self.session["session_id"],
            "errors": sorted(set(errors)),
        }
        result["integrity_sha256"] = _sha(result)
        return result

    def evidence_bundle(self) -> dict[str, Any]:
        bundle = {
            "schema": self.EVIDENCE_SCHEMA,
            "qualification_scope": "VISIBLE_LOCAL_BROWSER_SANDBOX_SECURITY_AND_CONTROL_SUBSTRATE",
            "session": deepcopy(self.session),
            "actions": deepcopy(list(self.actions.values())),
            "receipts": deepcopy(list(self.receipts.values())),
            "events": deepcopy(self.events),
            "integrity": self.verify_integrity(),
            "claim_boundaries": {
                "arbitrary_external_site_execution_claimed": False,
                "os_level_computer_control_claimed": False,
                "production_isolation_certified": False,
                "real_external_network_execution_claimed": False,
                "hidden_privileged_browser_session": False,
                "plaintext_secret_access_claimed": False,
            },
        }
        bundle["bundle_sha256"] = _sha(bundle)
        return bundle


__all__ = [
    "ComputerApprovalRequired",
    "ComputerExecutionError",
    "ComputerExecutionLedger",
    "ComputerPolicyViolation",
]

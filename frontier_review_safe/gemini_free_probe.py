from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.error import HTTPError
from urllib.request import Request, urlopen


SCHEMA = "musitu.axiom.gemini-provider-metadata-probe.v2"
DEFAULT_MODEL = "gemini-3.8-flash"
PROBE_TEXT = "Return exactly MUSITU_GEMINI_PROVIDER_PROBE_OK and nothing else."
EXPECTED_TEXT = "MUSITU_GEMINI_PROVIDER_PROBE_OK"
INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
REQUEST_ID_HEADERS = ("x-request-id", "x-goog-request-id")
SAFE_RESPONSE_HEADERS = frozenset({
    "content-type",
    "date",
    "server",
    "x-request-id",
    "x-goog-request-id",
})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _header_map(headers: Any) -> dict[str, str]:
    try:
        items = headers.items()
    except Exception:
        return {}
    out: dict[str, str] = {}
    for key, value in items:
        if not isinstance(key, str):
            continue
        normalized = key.casefold()
        if normalized in SAFE_RESPONSE_HEADERS:
            out[normalized] = str(value)
    return dict(sorted(out.items()))


def _provider_request_id(headers: Mapping[str, str]) -> str | None:
    for name in REQUEST_ID_HEADERS:
        value = headers.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _interaction_text(payload: Mapping[str, Any]) -> str:
    steps = payload.get("steps", [])
    if not isinstance(steps, list):
        return ""
    values: list[str] = []
    for step in steps:
        if not isinstance(step, Mapping) or step.get("type") != "model_output":
            continue
        content = step.get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, Mapping) and item.get("type") == "text" and isinstance(item.get("text"), str):
                values.append(item["text"])
    return "".join(values).strip()


def _safe_error_details(body: bytes) -> tuple[str | None, str]:
    """Return provider error status and a non-secret diagnostic category.

    The raw body is hash-bound separately. We intentionally do not persist the
    provider's free-form message because it can evolve or unexpectedly echo
    project/account details.
    """
    try:
        parsed = json.loads(body.decode("utf-8"))
        error = parsed.get("error", {}) if isinstance(parsed, Mapping) else {}
        status = error.get("status") if isinstance(error, Mapping) else None
        message = error.get("message") if isinstance(error, Mapping) else ""
    except Exception:
        return None, "unparseable_provider_error"
    status_text = status if isinstance(status, str) and status.strip() else None
    message_text = message.casefold() if isinstance(message, str) else ""
    if "project has been denied access" in message_text:
        category = "project_access_denied"
    elif "caller does not have permission" in message_text:
        category = "caller_permission_denied"
    elif "api key" in message_text and "permission" in message_text:
        category = "api_key_permission_denied"
    elif "reported as leaked" in message_text:
        category = "api_key_blocked_as_leaked"
    elif status_text == "PERMISSION_DENIED":
        category = "permission_denied_unspecified"
    elif status_text == "UNAUTHENTICATED":
        category = "authentication_failed"
    else:
        category = "provider_error_other"
    return status_text, category


def run_probe(
    *,
    api_key: str,
    model: str = DEFAULT_MODEL,
    timeout_seconds: int = 45,
    opener: Callable[..., Any] = urlopen,
) -> dict[str, Any]:
    if not isinstance(api_key, str) or not api_key.strip():
        raise ValueError("GEMINI_API_KEY is required")
    if not isinstance(model, str) or not model.strip() or model != model.strip():
        raise ValueError("model must be a canonical non-empty string")

    request_payload = {"model": model, "input": PROBE_TEXT}
    request_bytes = _canonical_bytes(request_payload)
    request_sha256 = _sha256_bytes(request_bytes)
    request = Request(
        INTERACTIONS_ENDPOINT,
        data=request_bytes,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "Api-Revision": "2026-05-20",
            "User-Agent": "MUSITU-Axiom-Level5-Provider-Probe/2.0",
        },
    )
    started_at = _now()
    try:
        with opener(request, timeout=timeout_seconds) as response:
            status_code = int(getattr(response, "status", 200))
            safe_headers = _header_map(getattr(response, "headers", {}))
            body = response.read()
    except HTTPError as exc:
        body = exc.read()
        provider_error_status, provider_error_category = _safe_error_details(body)
        return {
            "schema": SCHEMA,
            "status": "HTTP_ERROR",
            "provider_org": "Google",
            "product": "Gemini Interactions API",
            "requested_model": model,
            "access_mode": "api_free_tier",
            "started_at": started_at,
            "completed_at": _now(),
            "http_status": int(exc.code),
            "request_sha256": request_sha256,
            "error_body_sha256": _sha256_bytes(body),
            "provider_error_status": provider_error_status,
            "provider_error_category": provider_error_category,
            "level5_identity_ready": False,
            "level5_admissibility": "NOT_ADMISSIBLE_PROVIDER_CALL_FAILED",
            "claim_authority": "NONE",
            "reasons": ["provider_call_failed", provider_error_category],
        }

    completed_at = _now()
    raw_response_sha256 = _sha256_bytes(body)
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = {}

    interaction_id = payload.get("id") if isinstance(payload, Mapping) else None
    model_version = payload.get("model") if isinstance(payload, Mapping) else None
    interaction_status = payload.get("status") if isinstance(payload, Mapping) else None
    provider_request_id = _provider_request_id(safe_headers)
    text = _interaction_text(payload) if isinstance(payload, Mapping) else ""
    response_matches_probe = text == EXPECTED_TEXT

    reasons: list[str] = []
    if not isinstance(interaction_id, str) or not interaction_id.strip():
        reasons.append("provider_response_id_missing")
        interaction_id = None
    if not isinstance(model_version, str) or not model_version.strip():
        reasons.append("provider_model_version_missing")
        model_version = None
    if provider_request_id is None:
        reasons.append("provider_request_id_missing")
    if interaction_status != "completed":
        reasons.append("interaction_not_completed")
    if not response_matches_probe:
        reasons.append("probe_response_mismatch")

    receipt_envelope = {
        "http_status": status_code,
        "safe_response_headers": safe_headers,
        "interaction_id": interaction_id,
        "interaction_status": interaction_status,
        "model_version": model_version,
        "raw_response_sha256": raw_response_sha256,
    }
    level5_identity_ready = bool(provider_request_id and interaction_id and model_version)
    provider_call_valid = bool(
        200 <= status_code < 300
        and interaction_id
        and model_version
        and interaction_status == "completed"
        and response_matches_probe
    )

    return {
        "schema": SCHEMA,
        "status": "PASS" if provider_call_valid else "FAIL",
        "provider_org": "Google",
        "product": "Gemini Interactions API",
        "requested_model": model,
        "provider_model_version": model_version,
        "access_mode": "api_free_tier",
        "started_at": started_at,
        "completed_at": completed_at,
        "http_status": status_code,
        "request_sha256": request_sha256,
        "raw_response_sha256": raw_response_sha256,
        "provider_receipt_hash": _sha256_bytes(_canonical_bytes(receipt_envelope)),
        "provider_request_id": provider_request_id,
        "provider_response_id": interaction_id,
        "interaction_status": interaction_status,
        "safe_response_headers": safe_headers,
        "response_matches_probe": response_matches_probe,
        "level5_identity_ready": level5_identity_ready,
        "level5_admissibility": (
            "PROVIDER_IDENTITY_READY_NOT_ATTESTED"
            if level5_identity_ready
            else "NOT_ADMISSIBLE_PROVIDER_IDENTITY_INCOMPLETE"
        ),
        "claim_authority": "NONE",
        "reasons": sorted(set(reasons)),
    }


def _write(path: str | Path, payload: Mapping[str, Any]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(dict(payload), indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe Gemini Interactions API provider metadata without emitting credentials.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        payload = {
            "schema": SCHEMA,
            "status": "BLOCKED",
            "provider_org": "Google",
            "product": "Gemini Interactions API",
            "requested_model": args.model,
            "access_mode": "api_free_tier",
            "level5_identity_ready": False,
            "level5_admissibility": "NOT_ADMISSIBLE_MISSING_API_KEY",
            "claim_authority": "NONE",
            "reasons": ["GEMINI_API_KEY_missing"],
        }
        _write(args.output, payload)
        print(json.dumps(payload, sort_keys=True))
        return 3

    payload = run_probe(api_key=api_key, model=args.model)
    _write(args.output, payload)
    public_summary = {
        "status": payload["status"],
        "provider_org": payload["provider_org"],
        "requested_model": payload["requested_model"],
        "provider_model_version": payload.get("provider_model_version"),
        "provider_error_status": payload.get("provider_error_status"),
        "provider_error_category": payload.get("provider_error_category"),
        "provider_request_id_present": bool(payload.get("provider_request_id")),
        "provider_response_id_present": bool(payload.get("provider_response_id")),
        "level5_identity_ready": payload["level5_identity_ready"],
        "level5_admissibility": payload["level5_admissibility"],
        "reasons": payload["reasons"],
        "output": str(args.output),
    }
    print(json.dumps(public_summary, sort_keys=True))
    return 0 if payload["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

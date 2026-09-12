from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Mapping
import unicodedata
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SCHEMA = "musitu.axiom.anthropic-provider-metadata-probe.v1"
DEFAULT_MODEL = "claude-fable-5-1"
PROBE_TEXT = "Return exactly MUSITU_CLAUDE_PROVIDER_PROBE_OK and nothing else."
EXPECTED_TEXT = "MUSITU_CLAUDE_PROVIDER_PROBE_OK"
SAFE_HEADERS = frozenset({"content-type", "date", "request-id", "anthropic-organization-id", "anthropic-workspace-id"})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _canonical_api_key(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("ANTHROPIC_API_KEY must be a string")
    normalized = "".join(
        ch for ch in value
        if not ch.isspace() and unicodedata.category(ch) not in {"Cf", "Cc"}
    )
    if not normalized:
        raise ValueError("ANTHROPIC_API_KEY is required")
    try:
        normalized.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValueError("ANTHROPIC_API_KEY contains unsupported non-ASCII characters") from exc
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in normalized):
        raise ValueError("ANTHROPIC_API_KEY contains unsupported characters")
    return normalized


def _header_map(headers: Any) -> dict[str, str]:
    try:
        items = headers.items()
    except Exception:
        return {}
    out: dict[str, str] = {}
    for key, value in items:
        if isinstance(key, str) and key.casefold() in SAFE_HEADERS:
            out[key.casefold()] = str(value)
    return dict(sorted(out.items()))


def _response_text(payload: Mapping[str, Any]) -> str:
    content = payload.get("content", [])
    if not isinstance(content, list):
        return ""
    return "".join(str(item.get("text", "")) for item in content if isinstance(item, Mapping) and item.get("type") == "text").strip()


def _safe_error_classification(raw: bytes) -> tuple[str | None, str]:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None, "unparseable_provider_error"
    error = payload.get("error", {}) if isinstance(payload, Mapping) else {}
    error_type = error.get("type") if isinstance(error, Mapping) and isinstance(error.get("type"), str) else None
    message = str(error.get("message", "")).casefold() if isinstance(error, Mapping) else ""
    if any(term in message for term in ("credit", "billing", "payment", "spend limit", "usage limit")):
        category = "credit_or_billing_limit"
    elif any(term in message for term in ("model", "not available", "not found", "access")):
        category = "model_or_access_restriction"
    elif "max_tokens" in message or "token" in message:
        category = "token_configuration_invalid"
    elif any(term in message for term in ("temperature", "top_p", "top_k", "sampling")):
        category = "sampling_configuration_invalid"
    elif any(term in message for term in ("api key", "authentication", "unauthorized")):
        category = "authentication_problem"
    elif error_type == "invalid_request_error":
        category = "invalid_request_other"
    else:
        category = "provider_error_other"
    return error_type, category


def run_probe(*, api_key: str, model: str = DEFAULT_MODEL, timeout_seconds: int = 45, opener=urlopen) -> dict[str, Any]:
    key = _canonical_api_key(api_key)
    # Fable 5.1 uses adaptive thinking. Low effort minimizes free-credit use while
    # 1024 max output tokens avoids an artificially tiny cap on thinking + answer.
    body_obj = {
        "model": model,
        "max_tokens": 1024,
        "output_config": {"effort": "low"},
        "messages": [{"role": "user", "content": PROBE_TEXT}],
    }
    body = _canonical_bytes(body_obj)
    request_sha256 = _sha256_bytes(body)
    req = Request("https://api.anthropic.com/v1/messages", data=body, method="POST", headers={
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "user-agent": "MUSITU-Axiom-Level5-Provider-Probe/1.4",
    })
    started_at = _now()
    try:
        with opener(req, timeout=timeout_seconds) as response:
            status = int(getattr(response, "status", 200))
            headers = _header_map(getattr(response, "headers", {}))
            raw = response.read()
    except HTTPError as exc:
        raw = exc.read()
        headers = _header_map(getattr(exc, "headers", {}))
        request_id = headers.get("request-id")
        error_type, error_category = _safe_error_classification(raw)
        return {
            "schema": SCHEMA, "status": "HTTP_ERROR", "provider_org": "Anthropic", "product": "Claude API",
            "requested_model": model, "access_mode": "api_free_credit", "started_at": started_at, "completed_at": _now(),
            "http_status": int(exc.code), "request_sha256": request_sha256, "error_body_sha256": _sha256_bytes(raw),
            "provider_error_type": error_type, "provider_error_category": error_category,
            "provider_request_id": request_id, "provider_response_id": None, "level5_identity_ready": False,
            "level5_admissibility": "NOT_ADMISSIBLE_PROVIDER_CALL_FAILED", "claim_authority": "NONE",
            "reasons": ["provider_call_failed", error_category] + ([] if request_id else ["provider_request_id_missing"]),
        }

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        payload = {}
    message_id = payload.get("id") if isinstance(payload, Mapping) else None
    model_version = payload.get("model") if isinstance(payload, Mapping) else None
    request_id = headers.get("request-id")
    text = _response_text(payload) if isinstance(payload, Mapping) else ""
    reasons: list[str] = []
    if not isinstance(request_id, str) or not request_id.strip():
        reasons.append("provider_request_id_missing")
        request_id = None
    if not isinstance(message_id, str) or not message_id.strip():
        reasons.append("provider_response_id_missing")
        message_id = None
    if not isinstance(model_version, str) or not model_version.strip():
        reasons.append("provider_model_version_missing")
        model_version = None
    if text != EXPECTED_TEXT:
        reasons.append("probe_response_mismatch")
    raw_hash = _sha256_bytes(raw)
    receipt = {"http_status": status, "safe_response_headers": headers, "message_id": message_id, "model_version": model_version, "raw_response_sha256": raw_hash}
    identity_ready = bool(request_id and message_id and model_version)
    call_valid = bool(200 <= status < 300 and message_id and model_version and text == EXPECTED_TEXT)
    return {
        "schema": SCHEMA, "status": "PASS" if call_valid else "FAIL", "provider_org": "Anthropic", "product": "Claude API",
        "requested_model": model, "provider_model_version": model_version, "access_mode": "api_free_credit",
        "started_at": started_at, "completed_at": _now(), "http_status": status, "request_sha256": request_sha256,
        "raw_response_sha256": raw_hash, "provider_receipt_hash": _sha256_bytes(_canonical_bytes(receipt)),
        "provider_request_id": request_id, "provider_response_id": message_id, "safe_response_headers": headers,
        "response_matches_probe": text == EXPECTED_TEXT, "level5_identity_ready": identity_ready,
        "level5_admissibility": "PROVIDER_IDENTITY_READY_NOT_ATTESTED" if identity_ready else "NOT_ADMISSIBLE_PROVIDER_IDENTITY_INCOMPLETE",
        "claim_authority": "NONE", "reasons": sorted(set(reasons)),
    }


def _write(path: str | Path, payload: Mapping[str, Any]) -> None:
    Path(path).write_text(json.dumps(dict(payload), indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    raw_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not raw_key:
        payload = {"schema": SCHEMA, "status": "BLOCKED", "provider_org": "Anthropic", "product": "Claude API", "requested_model": args.model, "access_mode": "api_free_credit", "level5_identity_ready": False, "level5_admissibility": "NOT_ADMISSIBLE_MISSING_API_KEY", "claim_authority": "NONE", "reasons": ["ANTHROPIC_API_KEY_missing"]}
        _write(args.output, payload)
        print(json.dumps(payload, sort_keys=True))
        return 3
    try:
        payload = run_probe(api_key=raw_key, model=args.model)
    except ValueError as exc:
        payload = {"schema": SCHEMA, "status": "BLOCKED", "provider_org": "Anthropic", "product": "Claude API", "requested_model": args.model, "access_mode": "api_free_credit", "level5_identity_ready": False, "level5_admissibility": "NOT_ADMISSIBLE_INVALID_API_KEY_ENCODING", "claim_authority": "NONE", "reasons": [str(exc)]}
    _write(args.output, payload)
    print(json.dumps({"status": payload["status"], "provider_org": payload["provider_org"], "requested_model": payload["requested_model"], "provider_model_version": payload.get("provider_model_version"), "provider_request_id_present": bool(payload.get("provider_request_id")), "provider_response_id_present": bool(payload.get("provider_response_id")), "provider_error_type": payload.get("provider_error_type"), "provider_error_category": payload.get("provider_error_category"), "level5_identity_ready": payload["level5_identity_ready"], "level5_admissibility": payload["level5_admissibility"], "reasons": payload["reasons"], "output": args.output}, sort_keys=True))
    return 0 if payload["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

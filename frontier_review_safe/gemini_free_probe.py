from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


SCHEMA = "musitu.axiom.gemini-provider-metadata-probe.v1"
DEFAULT_MODEL = "gemini-3.8-flash"
PROBE_TEXT = "Return exactly MUSITU_GEMINI_PROVIDER_PROBE_OK and nothing else."
EXPECTED_TEXT = "MUSITU_GEMINI_PROVIDER_PROBE_OK"
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


def _response_text(payload: Mapping[str, Any]) -> str:
    try:
        candidates = payload.get("candidates", [])
        first = candidates[0]
        content = first.get("content", {})
        parts = content.get("parts", [])
    except Exception:
        return ""
    values: list[str] = []
    for part in parts:
        if isinstance(part, Mapping) and isinstance(part.get("text"), str):
            values.append(part["text"])
    return "".join(values).strip()


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

    request_payload = {
        "contents": [{"role": "user", "parts": [{"text": PROBE_TEXT}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 32},
    }
    request_bytes = _canonical_bytes(request_payload)
    request_sha256 = _sha256_bytes(request_bytes)
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        + quote(model, safe="-._")
        + ":generateContent"
    )
    request = Request(
        endpoint,
        data=request_bytes,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "User-Agent": "MUSITU-Axiom-Level5-Provider-Probe/1.0",
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
        return {
            "schema": SCHEMA,
            "status": "HTTP_ERROR",
            "provider_org": "Google",
            "product": "Gemini API",
            "requested_model": model,
            "access_mode": "api_free_tier",
            "started_at": started_at,
            "completed_at": _now(),
            "http_status": int(exc.code),
            "request_sha256": request_sha256,
            "error_body_sha256": _sha256_bytes(body),
            "level5_identity_ready": False,
            "level5_admissibility": "NOT_ADMISSIBLE_PROVIDER_CALL_FAILED",
            "reasons": ["provider_call_failed"],
        }

    completed_at = _now()
    raw_response_sha256 = _sha256_bytes(body)
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = {}

    response_id = payload.get("responseId") if isinstance(payload, Mapping) else None
    model_version = payload.get("modelVersion") if isinstance(payload, Mapping) else None
    provider_request_id = _provider_request_id(safe_headers)
    text = _response_text(payload) if isinstance(payload, Mapping) else ""
    response_matches_probe = text == EXPECTED_TEXT

    reasons: list[str] = []
    if not isinstance(response_id, str) or not response_id.strip():
        reasons.append("provider_response_id_missing")
        response_id = None
    if not isinstance(model_version, str) or not model_version.strip():
        reasons.append("provider_model_version_missing")
        model_version = None
    if provider_request_id is None:
        reasons.append("provider_request_id_missing")
    if not response_matches_probe:
        reasons.append("probe_response_mismatch")

    receipt_envelope = {
        "http_status": status_code,
        "safe_response_headers": safe_headers,
        "response_id": response_id,
        "model_version": model_version,
        "raw_response_sha256": raw_response_sha256,
    }
    level5_identity_ready = bool(provider_request_id and response_id and model_version)
    provider_call_valid = bool(200 <= status_code < 300 and response_id and model_version and response_matches_probe)

    return {
        "schema": SCHEMA,
        "status": "PASS" if provider_call_valid else "FAIL",
        "provider_org": "Google",
        "product": "Gemini API",
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
        "provider_response_id": response_id,
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
    parser = argparse.ArgumentParser(description="Probe Gemini API provider metadata without emitting credentials.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        payload = {
            "schema": SCHEMA,
            "status": "BLOCKED",
            "provider_org": "Google",
            "product": "Gemini API",
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

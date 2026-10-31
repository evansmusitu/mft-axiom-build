import json
import urllib.request
from math import isfinite
from typing import Any, Callable
from .core import IntegrationGate

def _unique_json_properties(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Fail closed if a remote response contains ambiguous duplicate keys."""
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate_json_key")
        value[key] = item
    return value


def _reject_json_constant(token: str) -> None:
    raise ValueError("nonstandard_json_constant")


def _finite_json_float(token: str) -> float:
    value = float(token)
    if not isfinite(value):
        raise ValueError("nonfinite_json_number")
    return value


def _parse_remote_response(raw: bytes) -> dict[str, Any]:
    """Permit only unambiguous RFC 8259 JSON objects at the remote boundary."""
    try:
        value = json.loads(raw.decode("utf-8"),
            object_pairs_hook=_unique_json_properties,
            parse_constant=_reject_json_constant,
            parse_float=_finite_json_float)
    except (ValueError, UnicodeError):
        raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID") from None
    if not isinstance(value, dict):
        raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
    return value

def _encode_request(payload: dict[str, Any]) -> bytes:
    # Never transmit nonstandard JSON with an authorization bearer token.
    try:
        return json.dumps(payload, separators=(",", ":"), sort_keys=True,
                          allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        raise RuntimeError("AXIOM_REQUEST_INVALID") from None


class AxiomComputeExecutor:
    def __init__(self, endpoint: str, bearer_token: str, timeout: float = 10.0) -> None:
        self.endpoint=endpoint
        self.bearer_token=bearer_token
        self.timeout=timeout

    def __call__(self, request: dict[str,Any]) -> dict[str,Any]:
        request_id=str(request["request_id"])
        payload={
            "operation":request["operation"],
            "args":request.get("args") or {},
        }
        body=_encode_request(payload)
        outbound=urllib.request.Request(
            self.endpoint,
            data=body,
            headers={
                "Authorization":"Bearer "+self.bearer_token,
                "Content-Type":"application/json",
                "Accept":"application/json",
                "X-musitu-request-id":request_id,
                "User-Agent":"MUSITU-Connect/1.0",
            },
            method="POST",
        )
        response=urllib.request.urlopen(outbound,timeout=self.timeout)
        decoded=_parse_remote_response(response.read())
        if not isinstance(decoded,dict):
            raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
        returned_request_id=decoded.get("request_id")
        if returned_request_id is not None and returned_request_id!=request_id:
            raise RuntimeError("AXIOM_REQUEST_ID_MISMATCH")
        if decoded.get("ok") is False:
            raise RuntimeError("AXIOM_REMOTE_ERROR")
        return decoded

class AxiomMcpExecutor:
    def __init__(self, endpoint: str, bearer_token: str, timeout: float = 10.0) -> None:
        self.endpoint=endpoint
        self.bearer_token=bearer_token
        self.timeout=timeout

    def __call__(self, request: dict[str,Any]) -> dict[str,Any]:
        request_id=str(request["request_id"])
        payload={
            "jsonrpc":"2.0",
            "id":request_id,
            "method":"tools/call",
            "params":{
                "name":"musitu_axiom_execute",
                "arguments":{
                    "operation":request["operation"],
                    "args":request.get("args") or {}
                }
            }
        }
        body=_encode_request(payload)
        outbound=urllib.request.Request(
            self.endpoint,
            data=body,
            headers={
                "Authorization":"Bearer "+self.bearer_token,
                "Content-Type":"application/json",
                "Accept":"application/json",
                "X-musitu-request-id":request_id,
                "User-Agent":"MUSITU-Connect/1.0"
            },
            method="POST"
        )
        response=urllib.request.urlopen(outbound,timeout=self.timeout)
        decoded=_parse_remote_response(response.read())
        if decoded.get("jsonrpc") != "2.0":
            raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
        if decoded.get("id") != request_id:
            raise RuntimeError("AXIOM_REQUEST_ID_MISMATCH")
        if "error" in decoded:
            if "result" in decoded:
                raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
            raise RuntimeError("AXIOM_REMOTE_ERROR")
        result=decoded.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
        if "isError" in result and not isinstance(result["isError"], bool):
            raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
        if result.get("isError") is True:
            raise RuntimeError("AXIOM_REMOTE_ERROR")
        structured=result.get("structuredContent")
        if not isinstance(structured, dict):
            raise RuntimeError("AXIOM_REMOTE_RESPONSE_INVALID")
        structured_request_id=structured.get("request_id")
        if structured_request_id is not None and structured_request_id!=request_id:
            raise RuntimeError("AXIOM_REQUEST_ID_MISMATCH")
        return structured

class AxiomGateway:
    def __init__(self, gate: IntegrationGate, executor: Callable[...,Any] | None = None) -> None:
        self.gate=gate; self.executor=executor

    def execute(self, request: dict[str,Any]) -> Any:
        self.gate.assert_open()
        if self.executor is None:
            raise RuntimeError("AXIOM_EXECUTOR_NOT_CONFIGURED")
        outbound=dict(request)
        run_id=str(outbound.get("run_id") or "").strip()
        canonical_sha256=str(outbound.get("canonical_sha256") or "").strip().lower()
        if run_id and canonical_sha256:
            outbound.setdefault("request_id",f"MUSITU-CONNECT-{run_id}-{canonical_sha256[:16]}")
        return self.executor(outbound)

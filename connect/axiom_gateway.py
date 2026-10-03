import json
import urllib.request
from typing import Any, Callable
from .core import IntegrationGate

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
        body=json.dumps(payload,separators=(",",":"),sort_keys=True).encode("utf-8")
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
        decoded=json.loads(response.read().decode("utf-8"))
        result=decoded["result"]
        if result.get("isError") is True:
            raise RuntimeError("AXIOM_REMOTE_ERROR")
        return result["structuredContent"]

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

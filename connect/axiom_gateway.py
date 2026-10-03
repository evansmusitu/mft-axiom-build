from typing import Any, Callable
from .core import IntegrationGate

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

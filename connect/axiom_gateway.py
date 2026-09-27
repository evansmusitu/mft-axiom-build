from typing import Any, Callable
from .core import IntegrationGate

class AxiomGateway:
    def __init__(self, gate: IntegrationGate, executor: Callable[...,Any] | None = None) -> None:
        self.gate=gate; self.executor=executor
    def execute(self, request: dict[str,Any]) -> Any:
        self.gate.assert_open()
        if self.executor is None: raise RuntimeError("AXIOM_EXECUTOR_NOT_CONFIGURED")
        return self.executor(request)

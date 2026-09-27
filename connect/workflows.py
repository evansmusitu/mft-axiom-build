from typing import Any, Callable
from .core import IntegrationGate

class DurableWorkflowBoundary:
    def __init__(self, gate: IntegrationGate | None = None) -> None:
        self.gate=gate or IntegrationGate()
    def submit(self, workflow_id:str, action:Callable[[],Any]) -> Any:
        if not workflow_id.strip(): raise ValueError("workflow_id_required")
        # Durable execution is supplied by the qualified workflow engine. Until then,
        # submission is deliberately fail-closed rather than silently executing inline.
        raise RuntimeError("WORKFLOW_ENGINE_NOT_QUALIFIED")

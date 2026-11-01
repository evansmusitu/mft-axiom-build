from typing import Any, Callable

from .core import IntegrationGate


WorkflowExecutor = Callable[[str, Callable[[], Any]], Any]


class DurableWorkflowBoundary:
    """Fail-closed workflow boundary that delegates only to a qualified executor."""

    def __init__(
        self,
        gate: IntegrationGate | None = None,
        *,
        qualified: bool | None = None,
        executor: WorkflowExecutor | None = None,
    ) -> None:
        if gate is not None and qualified is not None:
            raise ValueError("workflow_qualification_source_ambiguous")
        self.qualified = gate.allowed if gate is not None else bool(qualified)
        self.executor = executor

    def submit(self, workflow_id: str, action: Callable[[], Any]) -> Any:
        if not workflow_id.strip():
            raise ValueError("workflow_id_required")
        if not self.qualified or self.executor is None:
            raise RuntimeError("WORKFLOW_ENGINE_NOT_QUALIFIED")
        return self.executor(workflow_id, action)


class TemporalWorkflowBoundary:
    """Qualified durable-workflow boundary backed by a Temporal client."""

    def __init__(self, client: Any, gate: IntegrationGate | None = None) -> None:
        self.client=client
        self.gate=gate or IntegrationGate()

    async def execute(
        self,
        workflow: Any,
        argument: Any,
        *,
        workflow_id: str,
        task_queue: str,
    ) -> Any:
        if not workflow_id.strip():
            raise ValueError("workflow_id_required")
        if not task_queue.strip():
            raise ValueError("task_queue_required")
        if not self.gate.allowed:
            raise RuntimeError("WORKFLOW_ENGINE_NOT_QUALIFIED: " + self.gate.reason)
        return await self.client.execute_workflow(
            workflow,
            argument,
            id=workflow_id,
            task_queue=task_queue,
        )

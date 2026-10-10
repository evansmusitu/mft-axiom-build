from datetime import timedelta

from temporalio import workflow


@workflow.defn
class MiningRunDurabilityWorkflow:
    """Minimal deterministic workflow used to prove worker-loss recovery."""

    def __init__(self) -> None:
        self.phase = "CREATED"

    @workflow.query
    def current_phase(self) -> str:
        return self.phase

    @workflow.run
    async def run(self, run_id: str) -> str:
        self.phase = "WAITING_AFTER_FIRST_WORKER"
        await workflow.sleep(timedelta(seconds=2))
        self.phase = "COMPLETED_AFTER_RECOVERY"
        return run_id

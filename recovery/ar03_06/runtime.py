"""Integrated AR-03--AR-06 local candidate runtime."""

from __future__ import annotations

from pathlib import Path

from .common import IntegrityError, safe_arithmetic, sha256_text
from .fabric import AdapterBinding, UnifiedToolFabric
from .graph import ProjectWorkGraph
from .identity import IdentityService
from .kernel import DurableTaskKernel
from .store import CandidateStore


class CandidateRuntime:
    """Compose identity, graph, kernel, and tool fabric over one durable store."""

    def __init__(self, database, *, secret_key: bytes):
        self.database = Path(database)
        self.store = CandidateStore(self.database)
        self.identity = IdentityService(self.store, secret_key=secret_key)
        self.graph = ProjectWorkGraph(self.store, self.identity)
        self.fabric = UnifiedToolFabric()
        self.fabric.bind(
            AdapterBinding.local_candidate(
                lane="quantitative",
                adapter_id="bounded-arithmetic-candidate",
                operations={"arithmetic.evaluate"},
                adapter=self._evaluate_arithmetic,
            )
        )
        self.kernel = DurableTaskKernel(self.store, self.fabric, self.identity)
        self._closed = False

    @staticmethod
    def _evaluate_arithmetic(invocation):
        return {"value": safe_arithmetic(invocation.arguments.get("expression"))}

    def onboard(self, email, password, organization_name):
        registration = self.identity.signup(email, password, organization_name)
        session = self.identity.login(email, password)
        return {
            **registration,
            "session_token": session["session_token"],
            "session_id": session["session_id"],
            "manual_database_provisioning_required": False,
            "candidate_only": True,
            "formal_gate_earned": False,
        }

    def submit_arithmetic(
        self,
        session_token,
        project_id,
        expression,
        *,
        idempotency_key,
    ):
        context = self.identity.authenticate(session_token)
        self.identity.require_entitlement(context, "axiom.safe_task.execute")
        task = self.kernel.create_task(
            context,
            project_id,
            [
                {
                    "operation": "arithmetic.evaluate",
                    "args": {"expression": expression},
                    "idempotency_key": "bounded-arithmetic",
                    "cost_units": 1,
                }
            ],
            budget_max=1,
            idempotency_key=idempotency_key,
        )
        if task["state"] not in {"SUCCEEDED", "FAILED", "CANCELLED", "BUDGET_EXHAUSTED"}:
            task = self.kernel.run_until_blocked(
                context, task["task_id"], "candidate-runtime", self.fabric
            )
        result = None
        artifact_id = None
        if task["state"] == "SUCCEEDED":
            output = task["steps"][0]["output"]
            if not isinstance(output, dict) or "value" not in output:
                raise IntegrityError("arithmetic result is missing from the durable step")
            result = output["value"]
            artifact_id = "artifact_" + sha256_text(task["task_id"])[:32]
            if self.graph.get_entity(context, project_id, artifact_id) is None:
                self.graph.put_entity(
                    context,
                    project_id,
                    entity_id=artifact_id,
                    entity_type="ARTIFACT",
                    body={
                        "kind": "ARITHMETIC_RESULT",
                        "task_id": task["task_id"],
                        "expression": expression,
                        "result": result,
                    },
                    provenance={
                        "source": "AR05_DURABLE_TASK_KERNEL",
                        "step_id": task["steps"][0]["step_id"],
                        "invocation_id": task["steps"][0]["invocation_id"],
                        "operation": "arithmetic.evaluate",
                        "adapter_qualification": "LOCAL_CANDIDATE_EXECUTABLE",
                    },
                )
        return {
            "task_id": task["task_id"],
            "state": task["state"],
            "result": result,
            "artifact_id": artifact_id,
            "manual_database_provisioning_required": False,
            "candidate_only": True,
            "formal_gate_earned": False,
        }

    def close(self):
        if not self._closed:
            self.store.close()
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
        return False

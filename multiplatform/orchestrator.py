"""AXIOM-controlled frontier orchestration over the existing provider fabric.

This module is an isolated control-plane integration. AXIOM owns the orchestration
decision; provider adapters are subordinate execution backends. No provider is
considered qualified merely because an adapter exists, and no production endpoint
is reachable through this module.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from frontier_v5.runtime.circuit_breakers import CircuitBreakerFabric, CircuitBreakerPolicy
from frontier_v5.runtime.provider_fallback import (
    NoViableProviderError,
    ProviderDescriptor,
    ProviderFallbackRouter,
    ProviderRequest,
    ProviderResponse,
    ProviderTimeoutError,
)
from multiplatform.evaluation_runner import build as build_manifest
from multiplatform.providers.contracts import Invocation, InvocationResult, Provider


QualityScorer = Callable[[Mapping[str, Any], str, InvocationResult], float | None]


@dataclass(frozen=True)
class ProviderBinding:
    adapter: Any
    descriptor: ProviderDescriptor
    cost_per_1k_tokens: float = 0.0

    def __post_init__(self) -> None:
        if not isinstance(self.descriptor, ProviderDescriptor):
            raise TypeError("descriptor must be ProviderDescriptor")
        if self.descriptor.provider_id not in {p.value for p in Provider}:
            raise ValueError(f"unsupported provider contract identity: {self.descriptor.provider_id}")
        adapter_provider = getattr(self.adapter, "provider", None)
        if adapter_provider is not None:
            adapter_id = getattr(adapter_provider, "value", adapter_provider)
            if adapter_id != self.descriptor.provider_id:
                raise ValueError(
                    f"provider identity mismatch: adapter={adapter_id!r} descriptor={self.descriptor.provider_id!r}"
                )
        if isinstance(self.cost_per_1k_tokens, bool) or not isinstance(self.cost_per_1k_tokens, (int, float)):
            raise TypeError("cost_per_1k_tokens must be numeric")
        if self.cost_per_1k_tokens < 0:
            raise ValueError("cost_per_1k_tokens cannot be negative")


def _json_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_cases(path: str | Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict) or not value.get("case_id") or not value.get("prompt"):
            raise ValueError("each case must contain case_id and prompt")
        rows.append(value)
    return rows


def _contains_scalar(text: str, value: Any) -> bool:
    if isinstance(value, dict):
        return all(_contains_scalar(text, v) for v in value.values())
    if isinstance(value, list):
        return all(_contains_scalar(text, v) for v in value)
    if isinstance(value, bool):
        return ("true" if value else "false") in text.lower()
    if isinstance(value, float):
        forms = {str(value), f"{value:.6g}", f"{value:.4f}".rstrip("0").rstrip(".")}
        return any(item in text for item in forms)
    return str(value) in text


def default_quality_score(case: Mapping[str, Any], output_text: str, _: InvocationResult) -> float | None:
    """Score only the corpus modes that have deterministic expected answers.

    Rubric cases intentionally remain unscored unless a caller supplies an
    independent scorer. That prevents a heuristic from being promoted into a
    comparative quality claim.
    """
    if case.get("mode") != "known_answer":
        return None
    return 1.0 if _contains_scalar(output_text, case.get("expected")) else 0.0


def _extract_text(provider_id: str, data: Any) -> str:
    if isinstance(data, str):
        return data
    if not isinstance(data, dict):
        return str(data)
    if provider_id == "openai":
        if isinstance(data.get("output_text"), str):
            return data["output_text"]
        parts: list[str] = []
        for item in data.get("output", []):
            for block in item.get("content", []) if isinstance(item, dict) else []:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
        return "\n".join(parts)
    if provider_id == "anthropic":
        parts = [
            block["text"]
            for block in data.get("content", [])
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        ]
        return "\n".join(parts)
    if provider_id == "meta":
        try:
            return str(data["choices"][0]["message"]["content"])
        except Exception:
            pass
    return json.dumps(data, ensure_ascii=False, sort_keys=True, default=str)


class _BoundProvider:
    """Case-bound adapter presented to the existing policy router."""

    def __init__(
        self,
        binding: ProviderBinding,
        case: Mapping[str, Any],
        scorer: QualityScorer,
        mcp_url: str | None = None,
        require_approval: str = "never",
    ) -> None:
        self.descriptor = binding.descriptor
        self.binding = binding
        self.case = case
        self.scorer = scorer
        self.mcp_url = mcp_url
        self.require_approval = require_approval

    @property
    def provider_id(self) -> str:
        return self.descriptor.provider_id

    def execute(self, request: ProviderRequest) -> ProviderResponse:
        provider = Provider(self.provider_id)
        invocation = Invocation(
            case_id=str(self.case["case_id"]),
            provider=provider,
            tool_name=None,
            arguments={},
            timeout_ms=request.max_latency_ms,
            metadata={"prompt": str(self.case["prompt"])},
        )
        started = time.perf_counter()
        try:
            if self.mcp_url and self.provider_id in {"openai", "anthropic"} and hasattr(self.binding.adapter, "invoke_with_frontier_mcp"):
                invocation = Invocation(
                    case_id=invocation.case_id,
                    provider=invocation.provider,
                    tool_name=invocation.tool_name,
                    arguments=invocation.arguments,
                    timeout_ms=invocation.timeout_ms,
                    metadata={**invocation.metadata, "require_approval": self.require_approval},
                )
                result = self.binding.adapter.invoke_with_frontier_mcp(invocation, self.mcp_url)
            else:
                result = self.binding.adapter.invoke(invocation)
        except TimeoutError as exc:
            raise ProviderTimeoutError(str(exc)) from exc
        except Exception as exc:
            elapsed = int(max(0, round((time.perf_counter() - started) * 1000)))
            return ProviderResponse(
                provider_id=self.provider_id,
                output={"error_class": type(exc).__name__, "error": str(exc)},
                quality_score=0.0,
                latency_ms=elapsed,
                cost_units=0.0,
                policy_tags=frozenset(),
            )

        if not isinstance(result, InvocationResult):
            elapsed = int(max(0, round((time.perf_counter() - started) * 1000)))
            return ProviderResponse(
                provider_id=self.provider_id,
                output={"error": "INVALID_INVOCATION_RESULT"},
                quality_score=0.0,
                latency_ms=elapsed,
                cost_units=0.0,
                policy_tags=frozenset(),
            )

        text = _extract_text(self.provider_id, result.output)
        score = self.scorer(self.case, text, result)
        quality = 0.0 if score is None else float(score)
        if not 0.0 <= quality <= 1.0:
            raise ValueError("quality scorer must return None or a value from 0 to 1")

        total_tokens = result.usage.get("total_tokens") if isinstance(result.usage, Mapping) else None
        cost_units = self.descriptor.advertised_cost_units
        if isinstance(total_tokens, (int, float)) and not isinstance(total_tokens, bool):
            cost_units = float(total_tokens) / 1000.0 * self.binding.cost_per_1k_tokens

        latency = int(max(0, round(result.latency_ms or (time.perf_counter() - started) * 1000)))
        tags = frozenset({"successful_execution"}) if result.status == "ok" else frozenset()
        return ProviderResponse(
            provider_id=self.provider_id,
            output={
                "text": text,
                "status": result.status,
                "error_class": result.error_class,
                "usage": dict(result.usage),
                "trace": dict(result.trace),
            },
            quality_score=quality,
            latency_ms=latency,
            cost_units=cost_units,
            policy_tags=tags,
        )


def default_breakers(provider_ids: Sequence[str]) -> CircuitBreakerFabric:
    policy = CircuitBreakerPolicy(
        failure_threshold=2,
        failure_window_seconds=60,
        open_seconds=30,
        probe_lease_seconds=10,
        recovery_successes=1,
        timeout_penalty=10,
        error_penalty=20,
        success_reward=5,
        minimum_health_score=20,
    )
    return CircuitBreakerFabric({provider_id: policy for provider_id in provider_ids})


class AxiomFrontierOrchestrator:
    """AXIOM-owned closed-loop control plane for isolated frontier evaluation."""

    def __init__(
        self,
        providers: Mapping[str, ProviderBinding],
        breakers: CircuitBreakerFabric | None = None,
    ) -> None:
        if len(providers) < 2:
            raise ValueError("at least two provider bindings are required")
        self.providers = dict(providers)
        self.breakers = breakers or default_breakers(tuple(self.providers))

    def run_case(
        self,
        case: Mapping[str, Any],
        *,
        preferred_provider: str,
        min_quality: float = 0.0,
        max_latency_ms: int = 30_000,
        max_cost_units: float = 100.0,
        available_scopes: frozenset[str] = frozenset(),
        jurisdiction: str = "global",
        required_policy_tags: frozenset[str] = frozenset(),
        quality_scorer: QualityScorer = default_quality_score,
        mcp_url: str | None = None,
        require_approval: str = "never",
        now_epoch: float | None = None,
    ) -> dict[str, Any]:
        if preferred_provider not in self.providers:
            raise ValueError(f"preferred provider is not configured: {preferred_provider}")
        if min_quality < 0 or min_quality > 1:
            raise ValueError("min_quality must be from 0 to 1")
        if max_latency_ms < 0 or max_cost_units < 0:
            raise ValueError("latency and cost budgets must be non-negative")
        if require_approval not in {"always", "never"}:
            raise ValueError("require_approval must be 'always' or 'never'")
        if mcp_url is not None and not mcp_url.startswith("https://"):
            raise ValueError("mcp_url must use HTTPS")
        if mcp_url is not None and mcp_url.rstrip("/") == "https://mcp.mftintelligence.com/mcp":
            raise ValueError("PRODUCTION_ENDPOINT_FORBIDDEN")

        request = ProviderRequest(
            domain=str(case.get("category", "general")),
            modality="text",
            available_scopes=available_scopes,
            jurisdiction=jurisdiction,
            min_quality=float(min_quality),
            max_latency_ms=int(max_latency_ms),
            max_cost_units=float(max_cost_units),
            required_policy_tags=frozenset({"successful_execution", *required_policy_tags}),
        )
        current_epoch = float(time.time() if now_epoch is None else now_epoch)
        bindings = [
            _BoundProvider(binding, case, quality_scorer, mcp_url=mcp_url, require_approval=require_approval)
            for binding in self.providers.values()
        ]
        router = ProviderFallbackRouter(bindings, self.breakers)

        try:
            result = router.execute(
                request,
                preferred=preferred_provider,
                request_id=f'axiom-{case["case_id"]}',
                now_epoch=current_epoch,
            )
        except NoViableProviderError as exc:
            return {
                "schema": "musitu.axiom.orchestration-result.v1",
                "orchestrator": "MUSITU_AXIOM",
                "case_id": case["case_id"],
                "status": "blocked",
                "provider": None,
                "mode": "fail_closed",
                "passed": False,
                "quality_score": None,
                "quality_source": "NOT_AVAILABLE",
                "output": "",
                "attempts": [],
                "error": str(exc),
                "evidence_sha256": _json_sha256({"case": case, "error": str(exc)}),
                "routing_feedback": {
                    "preferred_provider": preferred_provider,
                    "accepted_provider": None,
                    "min_quality_preserved": float(min_quality),
                    "regret_signal": True,
                    "reason": "no_viable_provider",
                    "promotion_status": "OBSERVATION_ONLY",
                },
            }

        payload = result.response.output if isinstance(result.response.output, dict) else {}
        output_text = str(payload.get("text", payload))
        passed: bool | None
        if case.get("mode") == "known_answer":
            passed = _contains_scalar(output_text, case.get("expected"))
        else:
            passed = None
        quality_source = "deterministic_known_answer" if case.get("mode") == "known_answer" else "caller_scorer_or_unscored"

        attempts = [{"provider_id": item.provider_id, "outcome": item.outcome} for item in result.attempts]
        accepted = result.provider_id
        regret = accepted != preferred_provider or passed is False
        evidence_body = {
            "orchestrator": "MUSITU_AXIOM",
            "case_id": case["case_id"],
            "preferred_provider": preferred_provider,
            "accepted_provider": accepted,
            "mode": result.mode,
            "min_quality": float(min_quality),
            "attempts": attempts,
            "output_sha256": _json_sha256(output_text),
            "quality_score": result.response.quality_score,
            "quality_source": quality_source,
            "latency_ms": result.response.latency_ms,
            "cost_units": result.response.cost_units,
        }
        return {
            "schema": "musitu.axiom.orchestration-result.v1",
            "orchestrator": "MUSITU_AXIOM",
            "case_id": case["case_id"],
            "status": "accepted",
            "provider": accepted,
            "mode": result.mode,
            "passed": passed,
            "quality_score": result.response.quality_score,
            "quality_source": quality_source,
            "output": output_text,
            "attempts": attempts,
            "evidence_sha256": _json_sha256(evidence_body),
            "routing_feedback": {
                "preferred_provider": preferred_provider,
                "accepted_provider": accepted,
                "min_quality_preserved": float(min_quality),
                "regret_signal": regret,
                "reason": "preferred_accepted" if accepted == preferred_provider and not regret else "preferred_rejected_or_regret",
                "promotion_status": "OBSERVATION_ONLY",
            },
        }

    def run_cases(
        self,
        cases_path: str | Path,
        *,
        preferred_provider: str,
        max_cases: int | None = None,
        min_quality: float = 0.0,
        max_latency_ms: int = 30_000,
        max_cost_units: float = 100.0,
        quality_scorer: QualityScorer = default_quality_score,
        mcp_url: str | None = None,
        require_approval: str = "never",
    ) -> dict[str, Any]:
        cases = load_cases(cases_path)
        if max_cases is not None:
            cases = cases[:max_cases]
        rows = [
            self.run_case(
                case,
                preferred_provider=preferred_provider,
                min_quality=min_quality,
                max_latency_ms=max_latency_ms,
                max_cost_units=max_cost_units,
                quality_scorer=quality_scorer,
                mcp_url=mcp_url,
                require_approval=require_approval,
            )
            for case in cases
        ]
        manifest = build_manifest(
            "axiom-orchestrator",
            "controller",
            rows,
            str(cases_path),
            constraints={
                "orchestrator": "MUSITU_AXIOM",
                "preferred_provider": preferred_provider,
                "min_quality": min_quality,
                "max_latency_ms": max_latency_ms,
                "max_cost_units": max_cost_units,
                "scored_cases": "known_answer_only_unless_external_scorer_supplied",
            },
        )
        body = {
            "schema": "musitu.axiom.orchestrated-evaluation.v1",
            "orchestrator": "MUSITU_AXIOM",
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "manifest": manifest,
        }
        return {**body, "manifest_sha256": _json_sha256(body)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", default="multiplatform/cases/cases.jsonl")
    parser.add_argument("--out", required=True)
    parser.add_argument("--preferred-provider", required=True)
    parser.add_argument("--max-cases", type=int, default=None)
    parser.add_argument("--min-quality", type=float, default=0.0)
    parser.add_argument("--max-latency-ms", type=int, default=30_000)
    parser.add_argument("--max-cost-units", type=float, default=100.0)
    args = parser.parse_args()
    raise SystemExit("LIVE_PROVIDER_BINDINGS_MUST_BE_SUPPLIED_BY_HOST")


if __name__ == "__main__":
    main()

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Protocol, Sequence

class Provider(str, Enum):
    AXIOM = "axiom"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    META = "meta"
    GOOGLE = "google"
    XAI = "xai"

@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    input_schema: Mapping[str, Any]
    output_schema: Mapping[str, Any] | None = None
    annotations: Mapping[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class Invocation:
    case_id: str
    provider: Provider
    tool_name: str | None
    arguments: Mapping[str, Any]
    timeout_ms: int = 30_000
    metadata: Mapping[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class InvocationResult:
    provider: Provider
    case_id: str
    status: str
    output: Any = None
    error_class: str | None = None
    latency_ms: float | None = None
    usage: Mapping[str, Any] = field(default_factory=dict)
    trace: Mapping[str, Any] = field(default_factory=dict)

class ProviderAdapter(Protocol):
    provider: Provider
    def discover_tools(self) -> Sequence[ToolDef]: ...
    def invoke(self, invocation: Invocation) -> InvocationResult: ...

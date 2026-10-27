from dataclasses import dataclass
from typing import Any, Mapping

@dataclass(frozen=True)
class CanonicalEnvelope:
    contract: str
    domain: str
    records: tuple[Mapping[str,Any], ...]
    source: str = "unknown"
    provenance: str = "unsealed"

@dataclass(frozen=True)
class IntegrationGate:
    allowed: bool = False
    reason: str = "independent infrastructure qualification required"

    def assert_open(self) -> None:
        if not self.allowed:
            raise RuntimeError("AXIOM_INTEGRATION_BLOCKED: " + self.reason)

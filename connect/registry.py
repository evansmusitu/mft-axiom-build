from dataclasses import dataclass
from typing import Any

@dataclass(frozen=True)
class AdapterSpec:
    name: str
    domain: str
    version: str
    metadata: dict[str,Any] | None = None

class AdapterRegistry:
    def __init__(self) -> None:
        self._items: dict[str,AdapterSpec] = {}
    def register(self, spec: AdapterSpec) -> None:
        key=spec.name.strip().lower()
        if not key: raise ValueError('adapter_name_required')
        if key in self._items: raise ValueError('adapter_already_registered')
        self._items[key]=spec
    def get(self, name: str) -> AdapterSpec:
        try: return self._items[name.strip().lower()]
        except KeyError as exc: raise KeyError('adapter_not_found') from exc
    def list(self) -> list[AdapterSpec]:
        return sorted(self._items.values(), key=lambda x:(x.domain,x.name))

from dataclasses import dataclass
from typing import Any, Iterable, Callable

@dataclass(frozen=True)
class AdapterContract:
    name: str
    domain: str
    version: str
    normalize: Callable[[Iterable[dict[str,Any]]], Any]

class AdapterCatalog:
    def __init__(self) -> None: self._items: dict[str,AdapterContract]={}
    def register(self, contract: AdapterContract) -> None:
        key=contract.name.strip().lower()
        if not key: raise ValueError("adapter_name_required")
        if key in self._items: raise ValueError("adapter_already_registered")
        self._items[key]=contract
    def resolve(self,name:str) -> AdapterContract:
        try: return self._items[name.strip().lower()]
        except KeyError as exc: raise KeyError("adapter_not_found") from exc
    def domains(self) -> tuple[str,...]: return tuple(sorted({x.domain for x in self._items.values()}))

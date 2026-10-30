from __future__ import annotations

import re
from typing import Any, Mapping

_BLOCKED = (
    re.compile(r"checkout", re.I),
    re.compile(r"payment", re.I),
    re.compile(r"transfer", re.I),
    re.compile(r"withdraw", re.I),
    re.compile(r"deposit", re.I),
    re.compile(r"crypto", re.I),
    re.compile(r"wallet", re.I),
    re.compile(r"trade", re.I),
    re.compile(r"order", re.I),
    re.compile(r"liquidat", re.I),
    re.compile(r"send[_-]?money", re.I),
    re.compile(r"financial[_-]?transaction", re.I),
)

_BLOCKED_EXACT = frozenset({
    "search",
    "fetch",
    "musitu_axiom_capabilities",
    "musitu_axiom_plans",
    "musitu_axiom_recommend_plan",
    "musitu_axiom_start_checkout",
    "musitu_axiom_checkout_status",
    "musitu_axiom_execute",
})


def is_anthropic_operation_allowed(operation: Any) -> bool:
    value = str(operation or "")
    if not value or value in _BLOCKED_EXACT:
        return False
    return not any(pattern.search(value) for pattern in _BLOCKED)


def filter_tool_definition(tool: Mapping[str, Any]) -> bool:
    name = tool.get("name")
    if not is_anthropic_operation_allowed(name):
        return False
    metadata = tool.get("_meta")
    operation = metadata.get("musitu/operation") if isinstance(metadata, Mapping) else None
    if operation is not None and not is_anthropic_operation_allowed(operation):
        return False
    return True

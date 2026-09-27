from __future__ import annotations

import json
from pathlib import Path

from multiplatform.distribution.anthropic_policy import (
    is_anthropic_operation_allowed,
    filter_tool_definition,
)

ROOT = Path(__file__).resolve().parents[2]
PROFILE = ROOT / "distribution" / "anthropic" / "CLAUDE_PLUGIN_PROFILE.json"


def test_profile_is_fail_closed_for_endpoint_and_monetization():
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    assert profile["status"] == "READY_PENDING_ISOLATED_ENDPOINT"
    assert profile["endpoint"]["required"] is True
    assert profile["endpoint"]["production_forbidden"] is True
    assert "https://mcp.mftintelligence.com/mcp" in profile["endpoint"]["forbidden_exact"]
    assert "checkout" in profile["excluded_capability_classes"]
    assert "money_transfer" in profile["excluded_capability_classes"]


def test_financial_analysis_remains_allowed_but_transactions_do_not():
    assert is_anthropic_operation_allowed("finance.npv")
    assert is_anthropic_operation_allowed("statistics.regression")
    assert is_anthropic_operation_allowed("finance.monte_carlo_gbm")
    assert not is_anthropic_operation_allowed("finance.checkout")
    assert not is_anthropic_operation_allowed("broker.trade_order")
    assert not is_anthropic_operation_allowed("wallet.transfer")


def test_tool_filter_rejects_commerce_and_generic_executor():
    safe = {
        "name": "option_greeks",
        "description": "Compute option sensitivities.",
        "_meta": {"musitu/operation": "finance.greeks"},
    }
    commerce = {
        "name": "musitu_axiom_start_checkout",
        "description": "Create a checkout.",
    }
    generic = {
        "name": "musitu_axiom_execute",
        "description": "Execute arbitrary operations.",
    }
    assert filter_tool_definition(safe) is True
    assert filter_tool_definition(commerce) is False
    assert filter_tool_definition(generic) is False


if __name__ == "__main__":
    test_profile_is_fail_closed_for_endpoint_and_monetization()
    test_financial_analysis_remains_allowed_but_transactions_do_not()
    test_tool_filter_rejects_commerce_and_generic_executor()
    print("MUSITU_AXIOM_DISTRIBUTION_PROFILE_PASS")

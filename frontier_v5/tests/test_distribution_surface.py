from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE_SHA = "8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3"
DIST = ROOT / "frontier_v5" / "distribution"
CONSTITUTION = DIST / "DISTRIBUTION_CONSTITUTION.json"
CLAUDE = DIST / "providers" / "claude.json"

EXPECTED_OPERATIONS = {
    "finance.npv",
    "finance.compound",
    "finance.black_scholes",
    "finance.greeks",
    "finance.implied_vol",
    "finance.var_historical",
    "finance.var_parametric",
    "finance.cvar_historical",
    "finance.portfolio_metrics",
    "finance.returns",
    "finance.beta",
    "finance.drawdown",
    "finance.monte_carlo_gbm",
    "finance.bond_price",
    "finance.bond_yield",
    "finance.duration",
    "timeseries.rolling_volatility",
    "timeseries.moving_average",
    "timeseries.ewma",
    "statistics.regression",
    "statistics.correlation",
    "statistics.covariance",
    "statistics.describe",
    "statistics.quantile",
    "statistics.zscore",
    "optimization.linear_program",
    "optimization.quadratic",
    "numeric.least_squares",
    "numeric.interpolate",
    "verify.crosscheck",
}

FORBIDDEN_TOKENS = {
    "checkout",
    "billing.write",
    "payment",
    "transfer",
    "withdraw",
    "deposit",
    "trade",
    "order",
    "send_money",
}


class DistributionSurfaceTests(unittest.TestCase):
    def load_json(self, path: Path) -> dict:
        self.assertTrue(path.exists(), f"missing required distribution artifact: {path.relative_to(ROOT)}")
        return json.loads(path.read_text(encoding="utf-8"))

    def test_constitution_freezes_openai_surface(self) -> None:
        doc = self.load_json(CONSTITUTION)
        self.assertEqual(doc["source_frontier_sha"], BASE_SHA)
        self.assertEqual(doc["openai_surface"]["mutation_policy"], "FORBIDDEN")
        protected = set(doc["openai_surface"]["protected_paths"])
        self.assertEqual(
            protected,
            {"auth/", "mcp/", "submission/", "chatgpt-app-submission.json"},
        )

    def test_claude_profile_is_analysis_only_and_exact(self) -> None:
        profile = self.load_json(CLAUDE)
        self.assertEqual(profile["provider"], "claude")
        self.assertEqual(profile["oauth_scopes"], ["axiom.execute"])
        self.assertFalse(profile["generic_execute_exposed"])
        tools = profile["tools"]
        self.assertEqual(len(tools), 30)
        operations = {tool["operation"] for tool in tools}
        self.assertEqual(operations, EXPECTED_OPERATIONS)
        names = [tool["name"] for tool in tools]
        self.assertEqual(len(names), len(set(names)))
        for tool in tools:
            self.assertLessEqual(len(tool["name"]), 64)
            self.assertTrue(tool["title"].strip())
            ann = tool["annotations"]
            self.assertTrue(ann["readOnlyHint"])
            self.assertFalse(ann["destructiveHint"])
            self.assertFalse(ann["openWorldHint"])
        serialized = json.dumps(profile, sort_keys=True).lower()
        for token in FORBIDDEN_TOKENS:
            self.assertNotIn(token, serialized)

    def test_branch_has_no_frozen_surface_diff(self) -> None:
        # Executed in Actions with full checkout. A local environment without .git
        # may skip this specific repository-history assertion.
        if not (ROOT / ".git").exists():
            self.skipTest("git metadata unavailable")
        proc = subprocess.run(
            [
                "git",
                "diff",
                "--exit-code",
                BASE_SHA,
                "HEAD",
                "--",
                "auth/",
                "mcp/",
                "submission/",
                "chatgpt-app-submission.json",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)

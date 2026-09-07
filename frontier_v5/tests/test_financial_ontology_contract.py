#!/usr/bin/env python3
"""Behavioral contract for DEF-005 canonical financial ontology.

The contract exercises the public ontology seam rather than implementation
internals. It intentionally runs with the standard library only.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY_PATH = ROOT / "frontier_v5" / "ontology" / "FINANCIAL_ONTOLOGY.json"

try:
    from frontier_v5.runtime.financial_ontology import FinancialOntology, OntologyError
except ModuleNotFoundError as exc:
    raise AssertionError("DEF-005 canonical financial-ontology behavior is missing") from exc


def expect_error(fn, message: str) -> None:
    try:
        fn()
    except OntologyError:
        return
    raise AssertionError(message)


def write_mapping(path: Path, mapping: dict) -> None:
    path.write_text(json.dumps(mapping, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ontology = FinancialOntology.load(ONTOLOGY_PATH)

    required_kinds = {
        "entity",
        "instrument",
        "statement",
        "metric",
        "unit",
        "corporate_action",
        "portfolio",
        "risk",
    }
    assert required_kinds.issubset(ontology.kinds()), "canonical finance kinds are incomplete"

    assert ontology.resolve("Revenue") == "metric.revenue"
    assert ontology.resolve("total sales") == "metric.revenue"
    assert ontology.resolve("Common Stock") == "instrument.equity.common"
    assert ontology.resolve("market risk") == "risk.market"
    assert ontology.resolve("USD") == "unit.currency.usd"

    assert ontology.validate_measure("metric.revenue", "unit.currency.usd") is True
    assert ontology.validate_measure("metric.net_income", "unit.currency.usd") is True
    assert ontology.validate_measure("metric.net_margin", "unit.ratio.percent") is True
    expect_error(
        lambda: ontology.validate_measure("metric.revenue", "unit.ratio.percent"),
        "monetary metric accepted a ratio unit",
    )
    expect_error(
        lambda: ontology.validate_measure("metric.net_margin", "unit.currency.usd"),
        "ratio metric accepted a currency unit",
    )

    split = ontology.normalize_corporate_action("stock split", {"factor": 2})
    assert split == {"action_id": "corporate_action.stock_split", "factor": 2.0}
    expect_error(
        lambda: ontology.normalize_corporate_action("stock split", {"factor": 0}),
        "non-positive stock-split factor was accepted",
    )

    canonical = ontology.to_mapping()
    assert canonical["schema"] == "musitu.axiom.financial-ontology.v1"
    assert canonical["version"] == "1.0.0"
    for concept in canonical["concepts"]:
        assert concept["id"].startswith(concept["kind"] + ".")
        lineage = concept.get("lineage") or {}
        assert lineage.get("source"), f"missing lineage source for {concept['id']}"
        assert lineage.get("reference"), f"missing lineage reference for {concept['id']}"

    with tempfile.TemporaryDirectory(prefix="musitu-finance-ontology-") as tmp:
        tmpdir = Path(tmp)

        additive = copy.deepcopy(canonical)
        additive["version"] = "1.1.0"
        additive["concepts"].append(
            {
                "id": "metric.ebit",
                "kind": "metric",
                "label": "EBIT",
                "aliases": ["earnings before interest and taxes"],
                "dimension": "currency",
                "introduced_in": "1.1.0",
                "lineage": {
                    "source": "internal:musitu-financial-modeling",
                    "reference": "operating-profit semantic extension",
                },
            }
        )
        additive_path = tmpdir / "additive.json"
        write_mapping(additive_path, additive)
        newer = FinancialOntology.load(additive_path)
        newer.assert_backward_compatible(ontology)
        assert newer.resolve("EBIT") == "metric.ebit"

        removed = copy.deepcopy(additive)
        removed["concepts"] = [c for c in removed["concepts"] if c["id"] != "metric.revenue"]
        removed_path = tmpdir / "removed.json"
        write_mapping(removed_path, removed)
        removed_ontology = FinancialOntology.load(removed_path)
        expect_error(
            lambda: removed_ontology.assert_backward_compatible(ontology),
            "removing a canonical concept was considered backward compatible",
        )

        repurposed = copy.deepcopy(additive)
        for concept in repurposed["concepts"]:
            if concept["id"] == "metric.revenue":
                concept["dimension"] = "ratio"
                break
        repurposed_path = tmpdir / "repurposed.json"
        write_mapping(repurposed_path, repurposed)
        repurposed_ontology = FinancialOntology.load(repurposed_path)
        expect_error(
            lambda: repurposed_ontology.assert_backward_compatible(ontology),
            "changing the dimension of a canonical metric was considered compatible",
        )

        ambiguous = copy.deepcopy(canonical)
        for concept in ambiguous["concepts"]:
            if concept["id"] == "metric.net_income":
                concept["aliases"].append("total sales")
                break
        ambiguous_path = tmpdir / "ambiguous.json"
        write_mapping(ambiguous_path, ambiguous)
        expect_error(
            lambda: FinancialOntology.load(ambiguous_path),
            "ambiguous canonical alias was accepted",
        )

    print("MUSITU_AXIOM_FRONTIER_FINANCIAL_ONTOLOGY_PASS")


if __name__ == "__main__":
    main()

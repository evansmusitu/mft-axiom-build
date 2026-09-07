"""Canonical internal financial ontology for Frontier v5.

This module provides deterministic identifier/alias resolution, dimensional
unit validation, corporate-action normalization, provenance validation and a
fail-closed backward-compatibility check. It is repository-local semantic
infrastructure; it does not claim external standards certification.
"""
from __future__ import annotations

from copy import deepcopy
import json
import math
from pathlib import Path
import re
from typing import Any


class OntologyError(ValueError):
    """Raised when ontology data or use violates the semantic contract."""


_ID = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$")
_SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
_REQUIRED_KINDS = {
    "entity",
    "instrument",
    "statement",
    "metric",
    "unit",
    "corporate_action",
    "portfolio",
    "risk",
}


def _token(value: str) -> str:
    if not isinstance(value, str):
        raise OntologyError("ontology names must be strings")
    return " ".join(value.strip().casefold().split())


def _version(value: str) -> tuple[int, int, int]:
    match = _SEMVER.fullmatch(str(value))
    if not match:
        raise OntologyError(f"invalid ontology version: {value!r}")
    return tuple(int(part) for part in match.groups())


class FinancialOntology:
    """Validated canonical finance semantic registry."""

    def __init__(self, mapping: dict[str, Any]) -> None:
        self._mapping = deepcopy(mapping)
        self._concepts: dict[str, dict[str, Any]] = {}
        self._index: dict[str, str] = {}
        self._validate()

    @classmethod
    def load(cls, path: str | Path) -> "FinancialOntology":
        source = Path(path)
        if not source.is_file():
            raise OntologyError(f"ontology file missing: {source}")
        try:
            mapping = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise OntologyError(f"invalid ontology JSON: {source}") from exc
        if not isinstance(mapping, dict):
            raise OntologyError("ontology root must be an object")
        return cls(mapping)

    def _validate(self) -> None:
        if self._mapping.get("schema") != "musitu.axiom.financial-ontology.v1":
            raise OntologyError("unsupported financial ontology schema")
        _version(str(self._mapping.get("version") or ""))

        concepts = self._mapping.get("concepts")
        if not isinstance(concepts, list) or not concepts:
            raise OntologyError("ontology concepts must be a non-empty list")

        for raw in concepts:
            if not isinstance(raw, dict):
                raise OntologyError("each ontology concept must be an object")
            concept = deepcopy(raw)
            concept_id = concept.get("id")
            kind = concept.get("kind")
            label = concept.get("label")
            aliases = concept.get("aliases")
            introduced = concept.get("introduced_in")
            lineage = concept.get("lineage")

            if not isinstance(concept_id, str) or not _ID.fullmatch(concept_id):
                raise OntologyError(f"invalid canonical concept id: {concept_id!r}")
            if concept_id in self._concepts:
                raise OntologyError(f"duplicate canonical concept id: {concept_id}")
            if not isinstance(kind, str) or concept_id.split(".", 1)[0] != kind:
                raise OntologyError(f"concept id/kind mismatch: {concept_id}")
            if not isinstance(label, str) or not label.strip():
                raise OntologyError(f"missing label for {concept_id}")
            if not isinstance(aliases, list) or not all(isinstance(a, str) and a.strip() for a in aliases):
                raise OntologyError(f"aliases must be non-empty strings for {concept_id}")
            _version(str(introduced or ""))
            if not isinstance(lineage, dict) or not str(lineage.get("source") or "").strip() or not str(lineage.get("reference") or "").strip():
                raise OntologyError(f"lineage source/reference required for {concept_id}")

            if kind in {"metric", "unit"}:
                dimension = concept.get("dimension")
                if not isinstance(dimension, str) or not dimension.strip():
                    raise OntologyError(f"dimension required for {concept_id}")

            self._concepts[concept_id] = concept

        missing = _REQUIRED_KINDS - self.kinds()
        if missing:
            raise OntologyError(f"required finance kinds missing: {sorted(missing)}")

        for concept_id, concept in self._concepts.items():
            names = [concept_id, concept["label"], *concept["aliases"]]
            for name in names:
                token = _token(name)
                existing = self._index.get(token)
                if existing is not None and existing != concept_id:
                    raise OntologyError(
                        f"ambiguous ontology name {name!r}: {existing} vs {concept_id}"
                    )
                self._index[token] = concept_id

    def kinds(self) -> set[str]:
        return {str(c["kind"]) for c in self._concepts.values()}

    def resolve(self, name: str, *, kind: str | None = None) -> str:
        concept_id = self._index.get(_token(name))
        if concept_id is None:
            raise OntologyError(f"unknown ontology concept: {name!r}")
        concept = self._concepts[concept_id]
        if kind is not None and concept["kind"] != kind:
            raise OntologyError(
                f"ontology concept {concept_id} is {concept['kind']}, expected {kind}"
            )
        return concept_id

    def concept(self, name: str, *, kind: str | None = None) -> dict[str, Any]:
        return deepcopy(self._concepts[self.resolve(name, kind=kind)])

    def validate_measure(self, metric: str, unit: str) -> bool:
        metric_id = self.resolve(metric, kind="metric")
        unit_id = self.resolve(unit, kind="unit")
        metric_dimension = self._concepts[metric_id].get("dimension")
        unit_dimension = self._concepts[unit_id].get("dimension")
        if metric_dimension != unit_dimension:
            raise OntologyError(
                f"incompatible measure: {metric_id} ({metric_dimension}) with "
                f"{unit_id} ({unit_dimension})"
            )
        return True

    def normalize_corporate_action(
        self, action: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        action_id = self.resolve(action, kind="corporate_action")
        if not isinstance(payload, dict):
            raise OntologyError("corporate-action payload must be an object")
        if action_id == "corporate_action.stock_split":
            raw_factor = payload.get("factor")
            if isinstance(raw_factor, bool):
                raise OntologyError("stock-split factor must be numeric")
            try:
                factor = float(raw_factor)
            except (TypeError, ValueError) as exc:
                raise OntologyError("stock-split factor must be numeric") from exc
            if not math.isfinite(factor) or factor <= 0:
                raise OntologyError("stock-split factor must be finite and positive")
            return {"action_id": action_id, "factor": factor}
        raise OntologyError(f"unsupported corporate action normalization: {action_id}")

    def assert_backward_compatible(self, prior: "FinancialOntology") -> None:
        if not isinstance(prior, FinancialOntology):
            raise OntologyError("prior ontology must be FinancialOntology")
        current_version = _version(str(self._mapping["version"]))
        prior_version = _version(str(prior._mapping["version"]))
        if current_version < prior_version:
            raise OntologyError("ontology version cannot move backward")
        if current_version[0] != prior_version[0]:
            raise OntologyError("major-version changes require an explicit migration contract")

        for concept_id, old in prior._concepts.items():
            new = self._concepts.get(concept_id)
            if new is None:
                raise OntologyError(f"canonical concept removed: {concept_id}")
            if new.get("kind") != old.get("kind"):
                raise OntologyError(f"canonical concept kind changed: {concept_id}")
            if new.get("dimension") != old.get("dimension"):
                raise OntologyError(f"canonical concept dimension changed: {concept_id}")
            old_names = {_token(old["label"]), *(_token(a) for a in old["aliases"])}
            new_names = {_token(new["label"]), *(_token(a) for a in new["aliases"])}
            if not old_names.issubset(new_names):
                raise OntologyError(f"canonical names/aliases removed: {concept_id}")

    def to_mapping(self) -> dict[str, Any]:
        return deepcopy(self._mapping)

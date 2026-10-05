"""Claim/evidence integrity graph for MUSITU Axiom Frontier v5 Phase 4.

The graph is deliberately local and deterministic. It binds claims to immutable
source text with exact citation spans, preserves contradictory evidence, applies
explicit source controls and source-native freshness, and fails closed on broken
lineage or evidence. Retrieved content remains data-only authority.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import re
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

from .freshness import FreshnessDecision, FreshnessGuard, FreshnessObservation
from .retrieval_security import assess_retrieved_content

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_ALLOWED_STANCES = frozenset({"supports", "contradicts"})
_ALLOWED_VERIFICATION = frozenset({"UNVERIFIED", "SUPPORTED", "VERIFIED"})


class ClaimGraphError(RuntimeError):
    """Base fail-closed error for claim/evidence integrity violations."""


class SourceControlError(ClaimGraphError):
    pass


class CitationIntegrityError(ClaimGraphError):
    pass


class ClaimIntegrityError(ClaimGraphError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    raw = value if isinstance(value, str) else _canonical(value)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _text(value: Any, name: str, *, max_len: int = 20000) -> str:
    if not isinstance(value, str):
        raise ClaimGraphError(f"{name} must be string")
    value = value.strip()
    if not value:
        raise ClaimGraphError(f"{name} must be non-empty")
    if len(value) > max_len:
        raise ClaimGraphError(f"{name} exceeds maximum length")
    return value


def _timestamp(value: Any, name: str) -> str:
    text = _text(value, name, max_len=96)
    parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ClaimGraphError(f"{name} must include timezone")
    return text


def _domain(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SourceControlError("source URL must be absolute http(s)")
    return parsed.hostname.lower().rstrip(".")


def _domain_matches(host: str, rule: str) -> bool:
    rule = rule.lower().strip().lstrip(".").rstrip(".")
    return host == rule or host.endswith("." + rule)


@dataclass(frozen=True)
class SourceControls:
    allow_domains: tuple[str, ...] = ()
    deny_domains: tuple[str, ...] = ()
    source_types: tuple[str, ...] = ()
    start_as_of: str | None = None
    end_as_of: str | None = None

    def validate(self, *, url: str, source_type: str, as_of: str) -> str:
        host = _domain(url)
        if any(_domain_matches(host, rule) for rule in self.deny_domains):
            raise SourceControlError(f"source domain denied: {host}")
        if self.allow_domains and not any(_domain_matches(host, rule) for rule in self.allow_domains):
            raise SourceControlError(f"source domain not allow-listed: {host}")
        if self.source_types and source_type not in self.source_types:
            raise SourceControlError(f"source type not allowed: {source_type}")
        observed = datetime.fromisoformat(as_of[:-1] + "+00:00" if as_of.endswith("Z") else as_of)
        if self.start_as_of:
            start = datetime.fromisoformat(self.start_as_of[:-1] + "+00:00" if self.start_as_of.endswith("Z") else self.start_as_of)
            if observed < start:
                raise SourceControlError("source precedes allowed date window")
        if self.end_as_of:
            end = datetime.fromisoformat(self.end_as_of[:-1] + "+00:00" if self.end_as_of.endswith("Z") else self.end_as_of)
            if observed > end:
                raise SourceControlError("source exceeds allowed date window")
        return host


class ResearchClaimGraph:
    """Project-scoped research graph with exact citation integrity."""

    def __init__(
        self,
        *,
        project_id: str,
        freshness_guard: FreshnessGuard,
        source_controls: SourceControls | None = None,
    ) -> None:
        self.project_id = _text(project_id, "project_id", max_len=180)
        self.freshness_guard = freshness_guard
        self.source_controls = source_controls or SourceControls()
        self.sources: dict[str, dict[str, Any]] = {}
        self.claims: dict[str, dict[str, Any]] = {}
        self.citations: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []

    def _event(self, event_type: str, payload: Mapping[str, Any], at: str) -> None:
        previous = self.events[-1]["event_sha256"] if self.events else None
        body = {
            "project_id": self.project_id,
            "sequence": len(self.events),
            "event_type": event_type,
            "payload": dict(payload),
            "previous_sha256": previous,
            "created_at": _timestamp(at, "event timestamp"),
        }
        self.events.append({**body, "event_sha256": _sha(body)})

    def add_source(
        self,
        *,
        source_id: str,
        title: str,
        url: str,
        source_type: str,
        source_class: str,
        text: str,
        as_of: str,
        retrieved_at: str,
        now: str,
        expected_sha256: str | None = None,
    ) -> dict[str, Any]:
        source_id = _text(source_id, "source_id", max_len=180)
        if source_id in self.sources:
            raise ClaimGraphError("duplicate source_id")
        title = _text(title, "title", max_len=300)
        source_type = _text(source_type, "source_type", max_len=80)
        source_class = _text(source_class, "source_class", max_len=80)
        if not isinstance(text, str) or not text:
            raise ClaimGraphError("source text must be non-empty string")
        as_of = _timestamp(as_of, "as_of")
        retrieved_at = _timestamp(retrieved_at, "retrieved_at")
        now = _timestamp(now, "now")
        host = self.source_controls.validate(url=url, source_type=source_type, as_of=as_of)
        digest = _sha(text)
        if expected_sha256 is not None:
            supplied = str(expected_sha256).lower()
            if not _HEX64.fullmatch(supplied) or supplied != digest:
                raise CitationIntegrityError("source content SHA-256 mismatch")
        security = assess_retrieved_content(text)
        freshness: FreshnessDecision = self.freshness_guard.evaluate(
            FreshnessObservation(
                source_id=source_id,
                source_class=source_class,
                as_of=as_of,
                retrieved_at=retrieved_at,
                sha256=digest,
            ),
            now=now,
        )
        row = {
            "schema": "musitu.axiom.research-source.v1",
            "project_id": self.project_id,
            "source_id": source_id,
            "title": title,
            "url": url,
            "domain": host,
            "source_type": source_type,
            "source_class": source_class,
            "text": text,
            "content_sha256": digest,
            "as_of": as_of,
            "retrieved_at": retrieved_at,
            "freshness": freshness.evidence(),
            "instruction_authority": security.authority,
            "injection_flags": list(security.flags),
            "created_at": now,
        }
        self.sources[source_id] = row
        self._event("SOURCE_ADDED", {"source_id": source_id, "content_sha256": digest}, now)
        return json.loads(_canonical(row))

    def add_claim(
        self,
        *,
        claim_id: str,
        text: str,
        created_at: str,
        material: bool = True,
        confidence: float = 0.5,
        uncertainty: str = "",
        depends_on: Sequence[str] = (),
        requested_verification: str = "UNVERIFIED",
    ) -> dict[str, Any]:
        claim_id = _text(claim_id, "claim_id", max_len=180)
        if claim_id in self.claims:
            raise ClaimIntegrityError("duplicate claim_id")
        claim_text = _text(text, "claim text", max_len=12000)
        if type(material) is not bool:
            raise ClaimIntegrityError("material must be boolean")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
            raise ClaimIntegrityError("confidence must be between 0 and 1")
        deps = [str(x) for x in depends_on]
        if len(deps) != len(set(deps)):
            raise ClaimIntegrityError("duplicate claim dependency")
        if any(dep not in self.claims for dep in deps):
            raise ClaimIntegrityError("claim dependency must already exist in same project graph")
        if requested_verification not in _ALLOWED_VERIFICATION:
            raise ClaimIntegrityError("unknown verification status")
        # Verification is evidence-derived. A new material claim cannot self-promote.
        if material and requested_verification != "UNVERIFIED":
            raise ClaimIntegrityError("material claim cannot be pre-verified without citations")
        at = _timestamp(created_at, "created_at")
        row = {
            "schema": "musitu.axiom.research-claim.v1",
            "project_id": self.project_id,
            "claim_id": claim_id,
            "text": claim_text,
            "claim_sha256": _sha(claim_text),
            "material": material,
            "confidence": float(confidence),
            "uncertainty": str(uncertainty).strip(),
            "depends_on": deps,
            "verification_status": requested_verification,
            "created_at": at,
        }
        self.claims[claim_id] = row
        self._validate_acyclic()
        self._event("CLAIM_ADDED", {"claim_id": claim_id, "claim_sha256": row["claim_sha256"]}, at)
        return json.loads(_canonical(row))

    def add_citation(
        self,
        *,
        citation_id: str,
        claim_id: str,
        source_id: str,
        start: int,
        end: int,
        quote: str,
        stance: str,
        created_at: str,
        source_sha256: str | None = None,
    ) -> dict[str, Any]:
        citation_id = _text(citation_id, "citation_id", max_len=180)
        if citation_id in self.citations:
            raise CitationIntegrityError("duplicate citation_id")
        if claim_id not in self.claims:
            raise CitationIntegrityError("citation references missing claim")
        if source_id not in self.sources:
            raise CitationIntegrityError("citation references missing source")
        if stance not in _ALLOWED_STANCES:
            raise CitationIntegrityError("citation stance must support or contradict")
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int) or not isinstance(end, int):
            raise CitationIntegrityError("citation span must use integer offsets")
        source = self.sources[source_id]
        if start < 0 or end <= start or end > len(source["text"]):
            raise CitationIntegrityError("citation span out of bounds")
        expected_quote = source["text"][start:end]
        if quote != expected_quote:
            raise CitationIntegrityError("citation quote does not exactly match source span")
        if source_sha256 is not None and source_sha256 != source["content_sha256"]:
            raise CitationIntegrityError("citation source hash mismatch")
        at = _timestamp(created_at, "created_at")
        row = {
            "schema": "musitu.axiom.research-citation.v1",
            "project_id": self.project_id,
            "citation_id": citation_id,
            "claim_id": claim_id,
            "source_id": source_id,
            "source_sha256": source["content_sha256"],
            "start": start,
            "end": end,
            "quote": quote,
            "quote_sha256": _sha(quote),
            "stance": stance,
            "created_at": at,
        }
        self.citations[citation_id] = row
        self._event("CITATION_ADDED", {"citation_id": citation_id, "claim_id": claim_id, "source_id": source_id, "stance": stance}, at)
        self._derive_claim_status(claim_id)
        return json.loads(_canonical(row))

    def _claim_citations(self, claim_id: str) -> list[dict[str, Any]]:
        return sorted(
            (c for c in self.citations.values() if c["claim_id"] == claim_id),
            key=lambda c: (c["created_at"], c["citation_id"]),
        )

    def _derive_claim_status(self, claim_id: str) -> str:
        claim = self.claims[claim_id]
        citations = self._claim_citations(claim_id)
        supports = [c for c in citations if c["stance"] == "supports"]
        contradicts = [c for c in citations if c["stance"] == "contradicts"]
        if not supports:
            status = "UNVERIFIED"
        elif contradicts:
            status = "SUPPORTED"
        else:
            status = "VERIFIED"
        claim["verification_status"] = status
        return status

    def _validate_acyclic(self) -> None:
        visiting: set[str] = set()
        visited: set[str] = set()
        def visit(claim_id: str) -> None:
            if claim_id in visiting:
                raise ClaimIntegrityError("claim lineage cycle detected")
            if claim_id in visited:
                return
            visiting.add(claim_id)
            for dep in self.claims[claim_id]["depends_on"]:
                if dep not in self.claims:
                    raise ClaimIntegrityError("claim lineage contains missing dependency")
                visit(dep)
            visiting.remove(claim_id)
            visited.add(claim_id)
        for claim_id in self.claims:
            visit(claim_id)

    def verify_integrity(self) -> dict[str, Any]:
        errors: list[str] = []
        for source_id, source in self.sources.items():
            if _sha(source["text"]) != source["content_sha256"]:
                errors.append(f"source_hash:{source_id}")
        for citation_id, citation in self.citations.items():
            source = self.sources.get(citation["source_id"])
            claim = self.claims.get(citation["claim_id"])
            if source is None or claim is None:
                errors.append(f"missing_reference:{citation_id}")
                continue
            if citation["project_id"] != self.project_id or source["project_id"] != self.project_id or claim["project_id"] != self.project_id:
                errors.append(f"cross_project:{citation_id}")
                continue
            start, end = citation["start"], citation["end"]
            if start < 0 or end <= start or end > len(source["text"]):
                errors.append(f"span_bounds:{citation_id}")
                continue
            quote = source["text"][start:end]
            if quote != citation["quote"] or _sha(quote) != citation["quote_sha256"]:
                errors.append(f"quote_integrity:{citation_id}")
            if source["content_sha256"] != citation["source_sha256"]:
                errors.append(f"source_binding:{citation_id}")
        try:
            self._validate_acyclic()
        except ClaimIntegrityError as exc:
            errors.append(str(exc))
        missing_evidence: list[str] = []
        for claim_id, claim in self.claims.items():
            if _sha(claim["text"]) != claim["claim_sha256"]:
                errors.append(f"claim_hash:{claim_id}")
            citations = self._claim_citations(claim_id)
            supports = [c for c in citations if c["stance"] == "supports"]
            if claim["material"] and not supports:
                missing_evidence.append(claim_id)
            derived = self._derive_claim_status(claim_id)
            if claim["material"] and derived == "VERIFIED" and not supports:
                errors.append(f"unsupported_verified:{claim_id}")
        previous = None
        for index, event in enumerate(self.events):
            body = {k: event[k] for k in ("project_id", "sequence", "event_type", "payload", "previous_sha256", "created_at")}
            if event["sequence"] != index or event["previous_sha256"] != previous or _sha(body) != event["event_sha256"]:
                errors.append(f"event_chain:{index}")
                break
            previous = event["event_sha256"]
        output = {
            "schema": "musitu.axiom.research-integrity.v1",
            "project_id": self.project_id,
            "status": "PASS" if not errors else "FAIL",
            "source_count": len(self.sources),
            "claim_count": len(self.claims),
            "citation_count": len(self.citations),
            "missing_evidence_claim_ids": sorted(missing_evidence),
            "errors": sorted(errors),
            "event_chain_tip_sha256": previous,
        }
        output["integrity_sha256"] = _sha(output)
        return output

    def snapshot(self) -> dict[str, Any]:
        claims = []
        for claim_id in sorted(self.claims):
            claim = dict(self.claims[claim_id])
            citations = self._claim_citations(claim_id)
            claim["supporting_source_ids"] = sorted({c["source_id"] for c in citations if c["stance"] == "supports"})
            claim["contradicting_source_ids"] = sorted({c["source_id"] for c in citations if c["stance"] == "contradicts"})
            claim["citation_ids"] = [c["citation_id"] for c in citations]
            claim["unresolved_questions"] = ["Missing supporting evidence"] if claim["material"] and not claim["supporting_source_ids"] else []
            claims.append(claim)
        return {
            "schema": "musitu.axiom.research-claim-graph.v1",
            "project_id": self.project_id,
            "sources": [json.loads(_canonical(self.sources[k])) for k in sorted(self.sources)],
            "claims": claims,
            "citations": [json.loads(_canonical(self.citations[k])) for k in sorted(self.citations)],
            "integrity": self.verify_integrity(),
        }

    def report_view(self) -> dict[str, Any]:
        snap = self.snapshot()
        return {
            "project_id": self.project_id,
            "claims": snap["claims"],
            "integrity": snap["integrity"],
        }

    def evidence_map(self) -> dict[str, Any]:
        snap = self.snapshot()
        return {
            "project_id": self.project_id,
            "nodes": [
                *[{"id": s["source_id"], "kind": "source", "freshness": s["freshness"]} for s in snap["sources"]],
                *[{"id": c["claim_id"], "kind": "claim", "verification_status": c["verification_status"]} for c in snap["claims"]],
            ],
            "edges": [
                *[{"from": c["source_id"], "to": c["claim_id"], "relation": c["stance"], "citation_id": c["citation_id"]} for c in snap["citations"]],
                *[{"from": dep, "to": c["claim_id"], "relation": "depends_on"} for c in snap["claims"] for dep in c["depends_on"]],
            ],
            "integrity_sha256": snap["integrity"]["integrity_sha256"],
        }

    def timeline(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "events": json.loads(_canonical(self.events)),
            "integrity_sha256": self.verify_integrity()["integrity_sha256"],
        }


__all__ = [
    "CitationIntegrityError",
    "ClaimGraphError",
    "ClaimIntegrityError",
    "ResearchClaimGraph",
    "SourceControlError",
    "SourceControls",
]

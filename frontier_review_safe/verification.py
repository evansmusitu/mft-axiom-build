from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

from .core import sha256


@dataclass(frozen=True)
class VerificationPath:
    """One independently attributable verification route.

    ``origin`` identifies where the check actually runs. For local checks use
    ``local_process``. Provider/tool/human-review origins require a SHA-256
    provenance receipt so a label alone cannot manufacture independence.
    """

    verifier_id: str
    method: str
    independent_provider: str | None
    check: Callable[[Mapping[str, Any]], bool]
    origin: str = "local_process"
    provenance_hash: str | None = None
    requires_external_origin: bool = False


class IndependentVerifier:
    """Fail closed unless passing verification paths are genuinely independent."""

    @staticmethod
    def _valid_hash(value: str | None) -> bool:
        return bool(value) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())

    @staticmethod
    def _is_external(origin: str) -> bool:
        return bool(origin) and origin != "local_process"

    @classmethod
    def verify(
        cls,
        result: Mapping[str, Any],
        paths: Sequence[VerificationPath],
        minimum_independent_paths: int = 2,
        *,
        require_separate_origin: bool = False,
    ) -> dict[str, Any]:
        if minimum_independent_paths <= 0:
            raise ValueError("minimum_independent_paths must be positive")

        reasons: list[str] = []
        ids = [p.verifier_id for p in paths]
        origin_methods = [(p.origin, p.method) for p in paths]
        if len(ids) != len(set(ids)):
            reasons.append("duplicate_verifier_id")
        if len(origin_methods) != len(set(origin_methods)):
            reasons.append("duplicate_origin_method_path")

        rows: list[dict[str, Any]] = []
        providers: set[str] = set()
        passing_origins: set[str] = set()
        passing_methods: set[str] = set()
        external_pass = False

        for path in paths:
            path_reasons: list[str] = []
            if not path.verifier_id or not path.method or not path.origin:
                path_reasons.append("incomplete_verifier_identity")

            external = cls._is_external(path.origin)
            provenance_required = external or path.requires_external_origin or bool(path.independent_provider)
            if provenance_required and not cls._valid_hash(path.provenance_hash):
                path_reasons.append("external_provenance_missing_or_invalid")
            if path.requires_external_origin and not external:
                path_reasons.append("required_external_origin_missing")
            if path.independent_provider and not external:
                path_reasons.append("provider_declared_from_local_origin")

            try:
                ok = not path_reasons and bool(path.check(result))
                err = None
            except Exception as exc:
                ok = False
                err = type(exc).__name__

            rows.append({
                "verifier_id": path.verifier_id,
                "method": path.method,
                "origin": path.origin,
                "provider": path.independent_provider,
                "provenance_hash": path.provenance_hash,
                "pass": ok,
                "error": err,
                "reasons": path_reasons,
            })
            if ok:
                passing_origins.add(path.origin)
                passing_methods.add(path.method)
                if path.independent_provider:
                    providers.add(path.independent_provider)
                if external:
                    external_pass = True

        if len(paths) < minimum_independent_paths:
            reasons.append("insufficient_verification_paths")
        if len(passing_origins) < minimum_independent_paths:
            reasons.append("insufficient_independent_origins")
        if len(passing_methods) < minimum_independent_paths:
            reasons.append("insufficient_independent_methods")
        if any(not row["pass"] for row in rows):
            reasons.append("verification_path_failed")
        if require_separate_origin and not external_pass:
            reasons.append("separate_external_origin_required")

        passed = not reasons
        return {
            "verified": passed,
            "checks": rows,
            "independent_providers": sorted(providers),
            "independent_origins": sorted(passing_origins),
            "independent_methods": sorted(passing_methods),
            "reasons": sorted(set(reasons)),
            "result_sha256": sha256(result),
            "status": "PASS" if passed else "ESCALATE",
        }

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence
import unicodedata

from .core import FrontierSafetyError, parse_time, sha256


BASELINE_PROVIDER_CLASSES = frozenset({
    "general_agent",
    "research_agent",
    "coding_agent",
    "enterprise_agent",
    "multimodal_agent",
    "financial_data_stack",
    "specialist_financial_system",
})


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


def _canonical_provider_org(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and value == value.strip()
        and value == " ".join(value.split())
    )


def _provider_key(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


@dataclass(frozen=True)
class BaselineRegistration:
    registration_id: str
    provider_org: str
    provider_class: str
    product: str
    exact_version: str
    access_mode: str
    registered_at: str
    valid_until: str | None
    case_set_hash: str
    constraint_hash: str
    permissions_hash: str
    configuration_hash: str
    account_scope_hash: str
    capabilities: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        identities = (
            self.registration_id,
            self.product,
            self.exact_version,
            self.access_mode,
        )
        if any(not isinstance(value, str) or not value.strip() for value in identities):
            raise ValueError("complete baseline registration identity required")
        if not _canonical_provider_org(self.provider_org):
            raise ValueError("baseline provider_org must use canonical whitespace")
        if self.provider_class not in BASELINE_PROVIDER_CLASSES:
            raise ValueError("unsupported baseline provider class")
        registered = parse_time(self.registered_at)
        if self.valid_until is not None and parse_time(self.valid_until) <= registered:
            raise ValueError("baseline valid_until must be after registered_at")
        for value in (
            self.case_set_hash,
            self.constraint_hash,
            self.permissions_hash,
            self.configuration_hash,
            self.account_scope_hash,
        ):
            if not _valid_sha256(value):
                raise ValueError("baseline binding hashes must be SHA-256")
        if any(not isinstance(capability, str) or not capability.strip() for capability in self.capabilities):
            raise ValueError("baseline capabilities must be non-empty strings")
        if len(self.capabilities) != len(set(self.capabilities)):
            raise ValueError("duplicate baseline capabilities")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


@dataclass(frozen=True)
class BaselineRegistry:
    schema: str
    version: str
    created_at: str
    registrations: tuple[BaselineRegistration, ...]

    def __post_init__(self) -> None:
        if self.schema != "musitu.axiom.baseline-registry.v1":
            raise ValueError("unsupported baseline registry schema")
        if not isinstance(self.version, str) or not self.version.strip() or not self.registrations:
            raise ValueError("versioned non-empty baseline registry required")
        parse_time(self.created_at)
        ids = [r.registration_id for r in self.registrations]
        if len(ids) != len(set(ids)):
            raise FrontierSafetyError("duplicate baseline registration id")
        fingerprints = [r.fingerprint for r in self.registrations]
        if len(fingerprints) != len(set(fingerprints)):
            raise FrontierSafetyError("duplicate baseline registration content")

    @property
    def fingerprint(self) -> str:
        return sha256({
            "schema": self.schema,
            "version": self.version,
            "created_at": self.created_at,
            "registrations": [asdict(r) for r in sorted(self.registrations, key=lambda x: x.registration_id)],
        })

    def by_id(self, registration_id: str) -> BaselineRegistration:
        rows = [r for r in self.registrations if r.registration_id == registration_id]
        if len(rows) != 1:
            raise FrontierSafetyError("baseline registration id not found uniquely")
        return rows[0]

    def validate_run_binding(
        self,
        registration_id: str,
        registration_hash: str,
        *,
        provider_org: str,
        product: str,
        exact_version: str,
        access_mode: str,
        executed_at: str,
        case_set_hash: str,
        constraint_hash: str,
        permissions_hash: str,
        configuration_hash: str,
        account_scope_hash: str,
    ) -> dict[str, Any]:
        reasons: list[str] = []
        try:
            registration = self.by_id(registration_id)
        except FrontierSafetyError:
            return {"status": "FAIL", "reasons": ["baseline_registration_not_found"]}
        if registration_hash != registration.fingerprint:
            reasons.append("baseline_registration_hash_mismatch")
        if provider_org != registration.provider_org:
            reasons.append("baseline_provider_org_mismatch")
        if product != registration.product:
            reasons.append("baseline_product_mismatch")
        if exact_version != registration.exact_version:
            reasons.append("baseline_exact_version_mismatch")
        if access_mode != registration.access_mode:
            reasons.append("baseline_access_mode_mismatch")
        if case_set_hash != registration.case_set_hash:
            reasons.append("baseline_case_set_mismatch")
        if constraint_hash != registration.constraint_hash:
            reasons.append("baseline_constraint_mismatch")
        if permissions_hash != registration.permissions_hash:
            reasons.append("baseline_permissions_mismatch")
        if configuration_hash != registration.configuration_hash:
            reasons.append("baseline_configuration_mismatch")
        if account_scope_hash != registration.account_scope_hash:
            reasons.append("baseline_account_scope_mismatch")
        executed = parse_time(executed_at)
        if executed < parse_time(registration.registered_at):
            reasons.append("baseline_run_predates_registration")
        if registration.valid_until is not None and executed >= parse_time(registration.valid_until):
            reasons.append("baseline_registration_expired")
        return {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": sorted(set(reasons)),
            "registration_id": registration.registration_id,
            "registration_sha256": registration.fingerprint,
            "provider_org": registration.provider_org,
            "provider_class": registration.provider_class,
        }

    def coverage(
        self,
        *,
        required_provider_orgs: Sequence[str] = (),
        required_provider_classes: Sequence[str] = (),
    ) -> dict[str, Any]:
        providers = {_provider_key(r.provider_org) for r in self.registrations}
        classes = {r.provider_class for r in self.registrations}
        reasons: list[str] = []

        try:
            required_org_values = tuple(required_provider_orgs)
        except TypeError:
            required_org_values = ()
            reasons.append("invalid_required_provider_orgs")
        if any(not _canonical_provider_org(value) for value in required_org_values):
            reasons.append("invalid_required_provider_orgs")
            required_orgs: set[str] = set()
        else:
            required_orgs = {_provider_key(value) for value in required_org_values}

        try:
            required_class_values = tuple(required_provider_classes)
        except TypeError:
            required_class_values = ()
            reasons.append("invalid_required_provider_classes")
        required_classes = {str(x) for x in required_class_values}
        missing_orgs = sorted(required_orgs - providers)
        missing_classes = sorted(required_classes - classes)
        if missing_orgs:
            reasons.append("baseline_provider_org_coverage_incomplete")
        if missing_classes:
            reasons.append("baseline_provider_class_coverage_incomplete")
        reasons = sorted(set(reasons))
        return {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            "provider_orgs": sorted(providers),
            "provider_classes": sorted(classes),
            "missing_provider_orgs": missing_orgs,
            "missing_provider_classes": missing_classes,
            "registry_sha256": self.fingerprint,
        }

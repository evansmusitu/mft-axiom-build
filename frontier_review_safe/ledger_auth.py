from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import hashlib
import hmac

from .core import FrontierSafetyError, canonical, parse_time
from .evaluation import DecisionProvenanceLedger


@dataclass(frozen=True)
class DecisionLedgerSeal:
    """Authenticated checkpoint for a verified decision ledger.

    The HMAC key is deliberately absent. It must be supplied from an external
    runtime secret store whenever a seal is created or verified.
    """

    key_id: str
    sealed_at: str
    ledger_fingerprint: str
    event_count: int
    terminal_event_sha256: str | None
    mac_sha256: str

    def __post_init__(self) -> None:
        if not self.key_id:
            raise ValueError("key_id required")
        parse_time(self.sealed_at)
        for value in (self.ledger_fingerprint, self.mac_sha256):
            if len(value) != 64 or any(c not in "0123456789abcdef" for c in value.lower()):
                raise ValueError("seal fingerprints must be SHA-256 hex")
        if self.terminal_event_sha256 is not None and (
            len(self.terminal_event_sha256) != 64
            or any(c not in "0123456789abcdef" for c in self.terminal_event_sha256.lower())
        ):
            raise ValueError("terminal event hash must be SHA-256 hex")
        if self.event_count < 0:
            raise ValueError("event_count cannot be negative")


class DecisionLedgerAuthenticator:
    """HMAC-authenticates an already verified decision ledger.

    Hash chaining remains useful for local corruption detection. This layer
    closes a stronger attack: an actor who can rewrite the whole ledger and
    recompute every ordinary SHA-256 link still cannot forge a previously
    issued seal without the external HMAC key.
    """

    DOMAIN = b"musitu.axiom.decision-ledger.seal.v1\0"
    MIN_KEY_BYTES = 32

    @classmethod
    def _validate_key(cls, key: bytes) -> None:
        if not isinstance(key, bytes) or len(key) < cls.MIN_KEY_BYTES:
            raise ValueError("ledger authentication key must be at least 32 bytes")

    @staticmethod
    def _terminal_hash(ledger: DecisionProvenanceLedger) -> str | None:
        return ledger.events[-1]["event_sha256"] if ledger.events else None

    @classmethod
    def _body(cls, ledger: DecisionProvenanceLedger, *, key_id: str, sealed_at: str) -> dict[str, Any]:
        if not key_id:
            raise ValueError("key_id required")
        parse_time(sealed_at)
        ledger.verify()
        return {
            "key_id": key_id,
            "sealed_at": sealed_at,
            "ledger_fingerprint": ledger.fingerprint,
            "event_count": len(ledger.events),
            "terminal_event_sha256": cls._terminal_hash(ledger),
        }

    @classmethod
    def seal(
        cls,
        ledger: DecisionProvenanceLedger,
        key: bytes,
        *,
        key_id: str,
        sealed_at: str,
    ) -> DecisionLedgerSeal:
        cls._validate_key(key)
        body = cls._body(ledger, key_id=key_id, sealed_at=sealed_at)
        mac = hmac.new(key, cls.DOMAIN + canonical(body).encode("utf-8"), hashlib.sha256).hexdigest()
        return DecisionLedgerSeal(**body, mac_sha256=mac)

    @classmethod
    def verify(
        cls,
        ledger: DecisionProvenanceLedger,
        seal: DecisionLedgerSeal,
        key: bytes,
    ) -> dict[str, Any]:
        cls._validate_key(key)
        body = cls._body(ledger, key_id=seal.key_id, sealed_at=seal.sealed_at)
        mismatches = []
        if body["ledger_fingerprint"] != seal.ledger_fingerprint:
            mismatches.append("ledger_fingerprint")
        if body["event_count"] != seal.event_count:
            mismatches.append("event_count")
        if body["terminal_event_sha256"] != seal.terminal_event_sha256:
            mismatches.append("terminal_event_sha256")
        if mismatches:
            raise FrontierSafetyError("decision ledger seal state mismatch: " + ",".join(mismatches))

        expected = hmac.new(
            key,
            cls.DOMAIN + canonical(body).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, seal.mac_sha256):
            raise FrontierSafetyError("decision ledger authentication failed")
        return {
            "status": "PASS",
            "key_id": seal.key_id,
            "ledger_fingerprint": seal.ledger_fingerprint,
            "event_count": seal.event_count,
            "terminal_event_sha256": seal.terminal_event_sha256,
        }

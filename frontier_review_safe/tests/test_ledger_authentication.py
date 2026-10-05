from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.core import FrontierSafetyError, sha256
from frontier_review_safe.evaluation import DecisionProvenanceLedger
from frontier_review_safe.ledger_auth import DecisionLedgerAuthenticator


SEALED_AT = datetime(2026, 9, 11, 3, 0, tzinfo=timezone.utc).isoformat()
KEY = b"k" * 32


class LedgerAuthenticationTests(unittest.TestCase):
    def _ledger(self) -> DecisionProvenanceLedger:
        ledger = DecisionProvenanceLedger()
        ledger.append(
            "analysis.decision",
            "user-1",
            {"decision": "A"},
            request_id="req-1",
            policy_version="p1",
            code_version="git:test",
            input_hashes=["a" * 64],
        )
        ledger.append(
            "analysis.decision",
            "user-1",
            {"decision": "B"},
            request_id="req-2",
            policy_version="p1",
            code_version="git:test",
            input_hashes=["b" * 64],
        )
        return ledger

    @staticmethod
    def _recompute_entire_hash_chain(ledger: DecisionProvenanceLedger) -> None:
        prev = None
        for index, event in enumerate(ledger.events):
            event["sequence"] = index
            event["previous_sha256"] = prev
            body = dict(event)
            body.pop("event_sha256", None)
            event["event_sha256"] = sha256(body)
            prev = event["event_sha256"]

    def test_authenticated_seal_accepts_unchanged_ledger(self):
        ledger = self._ledger()
        seal = DecisionLedgerAuthenticator.seal(
            ledger,
            KEY,
            key_id="ledger-key-v1",
            sealed_at=SEALED_AT,
        )
        result = DecisionLedgerAuthenticator.verify(ledger, seal, KEY)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["event_count"], 2)

    def test_full_history_rewrite_can_rehash_but_cannot_forge_existing_seal(self):
        ledger = self._ledger()
        seal = DecisionLedgerAuthenticator.seal(
            ledger,
            KEY,
            key_id="ledger-key-v1",
            sealed_at=SEALED_AT,
        )

        ledger.events[0]["payload"]["decision"] = "MALICIOUS_REWRITE"
        self._recompute_entire_hash_chain(ledger)

        # This demonstrates the exact gap: an attacker who rewrites everything
        # can make the ordinary unkeyed hash chain internally consistent again.
        self.assertTrue(ledger.verify())
        with self.assertRaises(FrontierSafetyError):
            DecisionLedgerAuthenticator.verify(ledger, seal, KEY)

    def test_wrong_key_and_short_key_fail_closed(self):
        ledger = self._ledger()
        seal = DecisionLedgerAuthenticator.seal(
            ledger,
            KEY,
            key_id="ledger-key-v1",
            sealed_at=SEALED_AT,
        )
        with self.assertRaises(FrontierSafetyError):
            DecisionLedgerAuthenticator.verify(ledger, seal, b"x" * 32)
        with self.assertRaises(ValueError):
            DecisionLedgerAuthenticator.verify(ledger, seal, b"short")
        with self.assertRaises(ValueError):
            DecisionLedgerAuthenticator.seal(
                ledger,
                b"short",
                key_id="ledger-key-v1",
                sealed_at=SEALED_AT,
            )

    def test_empty_ledger_can_be_sealed_without_fabricating_terminal_hash(self):
        ledger = DecisionProvenanceLedger()
        seal = DecisionLedgerAuthenticator.seal(
            ledger,
            KEY,
            key_id="ledger-key-v1",
            sealed_at=SEALED_AT,
        )
        self.assertIsNone(seal.terminal_event_sha256)
        self.assertEqual(DecisionLedgerAuthenticator.verify(ledger, seal, KEY)["status"], "PASS")


if __name__ == "__main__":
    unittest.main(verbosity=2)

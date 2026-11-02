from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SEC = (ROOT / "evidence_security.js").read_text(encoding="utf-8")
CONTENT = (ROOT / "evidence_content.js").read_text(encoding="utf-8")
STORE = (ROOT / "evidence_store.js").read_text(encoding="utf-8")
UI = (ROOT / "evidence_ui.js").read_text(encoding="utf-8")
BOOT = (ROOT / "evidence_bootstrap.js").read_text(encoding="utf-8")
DEVELOPER_BOOT = (ROOT / "developer_bootstrap.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))


class Phase13EvidenceObservatoryContractTests(unittest.TestCase):
    def test_public_observatory_and_trust_center_are_user_facing(self):
        for token in ["Evidence Observatory &amp; Trust Center", "Immutable evaluation ledger", "Claim authorization", "Trust Center documents", "Download review package"]:
            self.assertIn(token, UI)
        self.assertIn("/^#\\/(?:evidence|trust)", UI)
        self.assertIn("AxiomEvidenceObservatoryBootstrap", BOOT)
        self.assertIn("import('./evidence_bootstrap.js')", DEVELOPER_BOOT)

    def test_ledger_is_append_only_and_hash_linked(self):
        for token in ["APPEND_ONLY_SHA256_LINKED_NO_DELETE_OR_OVERWRITE", "previous_event_sha256", "event_sha256", "entry_sha256", "definition_sha256", "EVALUATION_STATUS_APPENDED"]:
            self.assertIn(token, SEC + STORE)
        self.assertIn(".add(clone(row))", STORE)
        self.assertNotIn(".put(", STORE)
        self.assertNotIn(".delete(", STORE)
        self.assertNotIn(".clear(", STORE)

    def test_failures_and_missing_external_evidence_remain_visible(self):
        for token in ["phase12-provider-outage-attempts", "PROVIDER_OUTAGE_UNQUALIFIED", "runner_allocated:false", "steps_executed:0", "phase15-frontier-comparison-not-run"]:
            self.assertIn(token, CONTENT)
        for provider in ["OpenAI", "Anthropic", "Google", "Microsoft", "Bloomberg", "S&P Global"]:
            self.assertIn(provider, CONTENT)
        for token in ["NOT_CAPTURED", "NOT_RUN_IN_SEALED_MUSITU_SUITE", "externalOriginAuthenticated:false"]:
            self.assertIn(token, CONTENT)

    def test_claim_boundary_fails_closed(self):
        for token in ["FAIL_CLOSED_NO_SELF_ATTESTED_EXTERNAL_OR_SUPERIORITY_CLAIMS", "AUTHENTICATED_INDEPENDENT_REVIEW_REQUIRED_OUTSIDE_CANDIDATE", "GLOBAL_SUPERIORITY", "PRODUCTION_SECURITY_CERTIFICATION", "WCAG_CONFORMANCE_CERTIFICATION"]:
            self.assertIn(token, SEC)
        for token in ["candidate-local ledger cannot self-authorize this claim class", "independent_review_complete:false", "global_superiority_claim_allowed:false", "phase13_earned:false"]:
            self.assertIn(token, STORE)
        self.assertIn("candidate-local publication cannot authenticate external attestations", SEC)

    def test_trust_documents_exist_and_manifest_digests_are_exact(self):
        expected = {
            "ACCESSIBILITY.md": "16e87f5927288373e37d900852d1d605781f2fb5b33ea1a32ef27ec0b0e645e3",
            "EVALUATION_METHODOLOGY.md": "279d9b343d1c20e5e1c9671a92a47e2940831346ee8389956a8767d2c39fa484",
            "GOVERNANCE.md": "8aed4a465fc834dbf779edf7896355fcc8d8ca91917be2990830e936fc92eee6",
            "PRIVACY.md": "7bed182ff3b8d42294f9f831c887bfb665992d7052a53b19aa2969037eeaa802",
            "SECURITY.md": "59fcbb857f5c64590eb8c244f68e87cf69f2dee23b33425fbbd8e69d7e9527f5",
        }
        for name, digest in expected.items():
            path = ROOT / "trust" / name
            self.assertTrue(path.is_file())
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            self.assertIn(digest, CONTENT)
            self.assertRegex(CONTENT, re.escape(f"./trust/{name}") + r"['\"]")
        self.assertIn("not a production security certification", (ROOT / "trust/SECURITY.md").read_text(encoding="utf-8"))
        self.assertIn("independent WCAG 2.2 AA conformance", (ROOT / "trust/ACCESSIBILITY.md").read_text(encoding="utf-8"))

    def test_external_transport_and_dynamic_execution_are_absent(self):
        for text in [SEC, CONTENT, STORE, UI, BOOT]:
            for token in ["fetch(", "WebSocket(", "EventSource(", "new Function(", "eval("]:
                self.assertNotIn(token, text)

    def test_offline_shell_contains_phase13_candidate_assets_and_docs(self):
        for asset in ["./evidence_bootstrap.js", "./evidence_security.js", "./evidence_content.js", "./evidence_store.js", "./evidence_ui.js", "./styles/evidence.css", "./trust/SECURITY.md", "./trust/PRIVACY.md", "./trust/ACCESSIBILITY.md", "./trust/EVALUATION_METHODOLOGY.md", "./trust/GOVERNANCE.md"]:
            self.assertIn(asset, SW)
        self.assertIn("axiom-interface-phase13-candidate-v1", SW)
        self.assertIn("axiom-interface-phase12-v1", SW)

    def test_phase13_is_not_claimed_before_external_review_and_seal(self):
        authority = SURFACE["authority"]
        phase13 = authority.get("qualified_phase13_sha")
        if phase13 is None:
            self.assertNotIn("evidence_observatory_trust_center_substrate", SURFACE)
            self.assertIn(SURFACE["phase"], {"PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE", "PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE"})
            return
        self.assertEqual(SURFACE["schema"], "musitu.axiom.interface.surface-map.v13")
        self.assertEqual(SURFACE["phase"], "PHASE_13_EVIDENCE_OBSERVATORY_TRUST_CENTER")
        self.assertEqual(SURFACE["evidence_observatory_trust_center_substrate"]["status"], "EARNED")
        self.assertTrue(authority["qualified_phase13_independent_review_binding_verified"])


if __name__ == "__main__":
    unittest.main(verbosity=2)


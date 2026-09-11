from __future__ import annotations

import json
from pathlib import Path
import unittest


EXPECTED_FRONTIER_SHA = "d9196774a9fff3150922e2cb681d16e2423651da"
EXPECTED_MAIN_SHA = "d6a846f6bbe0bccac1758713eb4de167caf07113"
EXPECTED_DEMO_SHA = "d3eb576dc83e5df1edb2c7d58fb14f345ce85cc8"
EXPECTED_PROTECTED_OBJECTS = {
    "auth": "d2814277d6b3a9c12bb0332e4acfd44ccfc9dcd4",
    "branding": "7707ee8033a1c2753b83cd807543aeeec5a5d997",
    "chatgpt-app-submission.json": "e6e94f4c7f644d694d3aa732f0b8c9c86dae2b7d",
    "demo.mp4": EXPECTED_DEMO_SHA,
    "deploy_payload": "ce2d4b0b0e620e44b035081b92db3cc5aca21d7a",
    "mcp": "1ca86d943145df743d5eff5e58a8c46052478de0",
    "submission": "4b4a4483c97fe739f551e015401674222c69a887",
}
REQUIRED_PROTECTED_PATHS = {
    "auth",
    "branding",
    "chatgpt-app-submission.json",
    "demo.mp4",
    "deploy_payload",
    "mcp",
    "submission",
    ".github/workflows/axiom-mcp-production-deploy.yml",
    ".github/workflows/axiom-mcp-production-deploy-v2.yml",
    ".github/workflows/axiom-oauth-production-deploy.yml",
    ".github/workflows/axiom-modal-production-deploy.yml",
    ".github/workflows/axiom-openai-reviewer-demo-kv-origin-v2.yml",
    ".github/workflows/axiom-openai-reviewer-demo-provision.yml",
    ".github/workflows/axiom-openai-reviewer-demo-publication-v1.yml",
    ".github/workflows/axiom-openai-domain-challenge-install.yml",
}


class ReviewSnapshotManifestIntegrityTests(unittest.TestCase):
    @staticmethod
    def manifest():
        return json.loads(
            Path("frontier_review_safe/review_snapshot_manifest.json").read_text(encoding="utf-8")
        )

    def test_frozen_branch_and_main_anchors_are_exact(self):
        manifest = self.manifest()
        self.assertEqual(manifest["authoritative_frontier_sha"], EXPECTED_FRONTIER_SHA)
        self.assertEqual(manifest["sealed_main_sha"], EXPECTED_MAIN_SHA)

    def test_all_frozen_review_objects_remain_pinned_including_demo(self):
        manifest = self.manifest()
        self.assertEqual(manifest["reviewer_demo_blob_sha"], EXPECTED_DEMO_SHA)
        self.assertEqual(manifest["protected_git_object_shas"], EXPECTED_PROTECTED_OBJECTS)

    def test_all_required_production_and_reviewer_paths_remain_protected(self):
        manifest = self.manifest()
        self.assertTrue(REQUIRED_PROTECTED_PATHS.issubset(set(manifest["protected_paths"])))


if __name__ == "__main__":
    unittest.main(verbosity=2)

from __future__ import annotations

import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = (ROOT / "projects.js").read_text(encoding="utf-8")
PROJECT_CSS = (ROOT / "styles" / "projects.css").read_text(encoding="utf-8")
SURFACE = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))


class ProjectContractTests(unittest.TestCase):
    def test_persistent_graph_has_required_stores_and_stable_ids(self):
        for store in ["projects", "objects", "edges", "events"]:
            self.assertIn(f"'{store}'", PROJECTS)
        self.assertIn("crypto.randomUUID", PROJECTS)
        for field in ["project_id", "owner_id", "created_at", "updated_at", "permissions", "provenance", "version_history", "evidence_links", "memory_scope"]:
            self.assertIn(field, PROJECTS)

    def test_project_object_and_link_types_cover_blueprint_core(self):
        for object_type in ["conversation", "source", "artifact", "task", "memory", "agent", "decision"]:
            self.assertIn(f"'{object_type}'", PROJECTS)
        self.assertIn("addObject", PROJECTS)
        self.assertIn("addEdge", PROJECTS)
        self.assertIn("from_id", PROJECTS)
        self.assertIn("to_id", PROJECTS)

    def test_permissions_fail_closed_and_owner_is_required(self):
        self.assertIn("NotAllowedError", PROJECTS)
        self.assertIn("owner permission is required", PROJECTS)
        self.assertIn("['owner','editor']", PROJECTS)
        for role in ["owner", "editor", "viewer"]:
            self.assertIn(f"'{role}'", PROJECTS)

    def test_memory_scope_and_truth_boundary_are_explicit(self):
        for scope in ["private", "project-only", "organization-wide", "temporary", "permanent", "do-not-use"]:
            self.assertIn(f"'{scope}'", PROJECTS)
        self.assertEqual(SURFACE["project_substrate"]["persistence"], "INDEXEDDB_BROWSER_LOCAL_DEVICE")
        self.assertFalse(SURFACE["project_substrate"]["cloud_sync_claimed"])
        self.assertFalse(SURFACE["project_substrate"]["multi_device_sync_claimed"])
        self.assertIn("does not claim cloud or multi-device sync", PROJECTS)

    def test_provenance_event_chain_is_tamper_evident_and_versioned(self):
        self.assertIn("crypto.subtle.digest('SHA-256'", PROJECTS)
        self.assertIn("previous_sha256", PROJECTS)
        self.assertIn("event_sha256", PROJECTS)
        self.assertIn("verifyEventChain", PROJECTS)
        self.assertIn("expectedRevision", PROJECTS)
        self.assertIn("project revision conflict", PROJECTS)

    def test_project_forms_have_accessible_non_drag_alternatives(self):
        for label in ["Create project", "Add linked object", "Link objects", "Memory scope", "Provenance source"]:
            self.assertIn(label, PROJECTS)
        self.assertNotIn("draggable=", PROJECTS)
        self.assertIn("aria-live=\"polite\"", PROJECTS)
        self.assertIn("forced-colors:active", PROJECT_CSS)
        self.assertIn("max-width:52rem", PROJECT_CSS)

    def test_no_external_network_or_secret_surface_added(self):
        self.assertNotRegex(PROJECTS, r"https?://")
        self.assertNotIn("fetch(", PROJECTS)
        self.assertNotIn("secret", PROJECTS.casefold())
        self.assertNotIn("password", PROJECTS.casefold())


if __name__ == "__main__":
    unittest.main(verbosity=2)

from __future__ import annotations

import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "styles" / "app.css").read_text(encoding="utf-8")
TOKENS = (ROOT / "styles" / "tokens.css").read_text(encoding="utf-8")
JS = (ROOT / "app.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
SURFACE_MAP = json.loads((ROOT / "surface-map.json").read_text(encoding="utf-8"))


class SemanticParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []
        self.ids: set[str] = set()
        self.duplicate_ids: set[str] = set()
        self.button_stack: list[dict[str, str | None]] = []
        self.unnamed_buttons: list[dict[str, str | None]] = []
        self._button_text: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        data = dict(attrs)
        self.tags.append((tag, data))
        if data.get("id"):
            if data["id"] in self.ids:
                self.duplicate_ids.add(data["id"])
            self.ids.add(data["id"])
        if tag == "button":
            self.button_stack.append(data)
            self._button_text.append("")

    def handle_data(self, data: str) -> None:
        if self._button_text:
            self._button_text[-1] += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self.button_stack:
            attrs = self.button_stack.pop()
            text = self._button_text.pop().strip()
            if not text and not attrs.get("aria-label") and not attrs.get("aria-labelledby"):
                self.unnamed_buttons.append(attrs)


class InterfaceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.parser = SemanticParser()
        cls.parser.feed(HTML)

    def test_semantic_landmarks_and_skip_navigation(self):
        tags = [tag for tag, _ in self.parser.tags]
        self.assertIn("header", tags)
        self.assertIn("main", tags)
        self.assertGreaterEqual(tags.count("nav"), 2)
        self.assertGreaterEqual(tags.count("aside"), 2)
        self.assertIn('href="#main-workspace"', HTML)
        self.assertIn('id="main-workspace"', HTML)
        self.assertFalse(self.parser.duplicate_ids)

    def test_screen_reader_and_keyboard_contract(self):
        self.assertFalse(self.parser.unnamed_buttons)
        self.assertIn('aria-label="Universal composer"', HTML)
        self.assertIn('aria-label="Proof Drawer"', HTML)
        self.assertIn('role="tablist"', HTML)
        self.assertIn('aria-live="polite"', HTML)
        self.assertIn('role="alert"', HTML)
        self.assertIn(':focus-visible', CSS)
        self.assertIn("prefers-reduced-motion: reduce", CSS)
        self.assertIn("ArrowRight", JS)
        self.assertIn("ArrowLeft", JS)
        self.assertIn("composer-focus", JS)

    def test_touch_reflow_contrast_and_theme_primitives(self):
        self.assertRegex(TOKENS, r"--target-min:\s*2\.75rem")
        self.assertIn('data-theme="high-contrast"', TOKENS)
        self.assertIn("forced-colors: active", CSS)
        self.assertIn("max-width: 52rem", CSS)
        self.assertIn("max-width: 30rem", CSS)
        self.assertNotIn("overflow-x: hidden", CSS)

    def test_reliability_error_contract_is_complete(self):
        for field in ["errorId", "component", "impact", "succeeded", "failed", "dataLost", "retryState", "recovery", "supportTrace"]:
            self.assertIn(field, JS)
        for label in ["Impact", "What succeeded", "What failed", "Data lost", "Retry state", "Recovery"]:
            self.assertIn(label, JS)

    def test_observability_excludes_sensitive_content(self):
        self.assertIn("Operational metadata is allow-listed", JS)
        self.assertNotIn("event.detail.prompt", JS)
        self.assertNotIn("event.detail.composer", JS)
        self.assertIn("Private chain-of-thought", HTML)
        self.assertIn("getTrace", JS)

    def test_security_boundary_has_no_external_runtime_dependencies(self):
        self.assertIn("default-src 'self'", HTML)
        self.assertIn("object-src 'none'", HTML)
        self.assertIn("connect-src 'self'", HTML)
        self.assertNotRegex(HTML, r'(?:src|href)="https?://')
        self.assertNotIn("eval(", JS)
        self.assertNotIn("new Function", JS)
        self.assertNotRegex(JS, r"fetch\(['\"]https?://")
        self.assertIn("origin!==self.location.origin", SW)

    def test_consequential_action_flow_is_preview_gated(self):
        for label in ["Preview", "Approval", "Action", "Receipt", "Undo / rollback"]:
            self.assertIn(label, HTML)
        self.assertIn("Models propose; policy decides", HTML)
        self.assertIn("No external action executed", JS)
        self.assertEqual(SURFACE_MAP["execution_boundary"], "PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS")

    def test_surface_map_matches_authority_and_phase(self):
        self.assertEqual(SURFACE_MAP["authority"]["earned_track_b_sha"], "73ecdbad38cb10020b6e30ebe42a9222a3bb6c55")
        self.assertEqual(SURFACE_MAP["authority"]["blueprint_sha256"], "e750039a9c88abc780d24f48c3e86e22fd9295fec99a1b0593668aa8dd9ac166")
        self.assertEqual(SURFACE_MAP["phase"], "PHASE_1_ISOLATED_SHELL")
        self.assertGreaterEqual(len(SURFACE_MAP["surfaces"]), 11)
        self.assertIn("observability", SURFACE_MAP["workspace_routes"])

    def test_service_worker_is_same_origin_and_shell_only(self):
        self.assertIn("event.request.method!=='GET'", SW)
        self.assertIn("self.location.origin", SW)
        self.assertIn("./index.html", SW)
        self.assertNotIn("https://", SW)

    def test_design_contract_fingerprint_is_locked(self):
        payload = "\n--FILE--\n".join([HTML, TOKENS, CSS, JS])
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        expected = (ROOT / "tests" / "design_contract.sha256").read_text(encoding="utf-8").strip()
        self.assertEqual(digest, expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Security-hardened live research adapter for Frontier v5."""
from __future__ import annotations

from dataclasses import replace
from .fullstack import LiveResearchAdapter, RetrievalSnapshot
from .retrieval_security import RetrievedContentFirewall


class SecureLiveResearchAdapter(LiveResearchAdapter):
    """Re-scan textual retrievals with the canonical hardened firewall.

    This preserves the byte-identical provenance snapshot while ensuring the
    security classification used by live verification and downstream research
    is the canonical Unicode-normalizing detector.
    """

    def fetch(self, url: str, headers=None) -> RetrievalSnapshot:
        snap = super().fetch(url, headers=headers)
        ctype = snap.content_type
        flags = snap.injection_flags
        if ctype.startswith("text/") or ctype in {
            "application/json", "application/xml", "application/xhtml+xml"
        }:
            flags = RetrievedContentFirewall.scan(snap.text())
        return replace(
            snap,
            instruction_authority="retrieved-content-data-only",
            injection_flags=tuple(flags),
        )


__all__ = ["SecureLiveResearchAdapter"]

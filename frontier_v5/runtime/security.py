#!/usr/bin/env python3
"""Hardened retrieved-content security primitives for MUSITU Axiom Frontier."""
from __future__ import annotations

from dataclasses import replace
import re
from typing import Iterable, Mapping

from .fullstack import LiveResearchAdapter, RetrievalSnapshot


class HardenedRetrievedContentFirewall:
    """Conservative detector for authority-confusion and exfiltration language.

    Detection is defense-in-depth only. Retrieved content remains data-only
    whether or not a lexical detector fires.
    """

    PATTERNS = {
        "ignore-prior": re.compile(r"\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|polic(?:y|ies))\b", re.I),
        "system-override": re.compile(r"\b(system|developer)\s+(prompt|message|instructions?)\b", re.I),
        "credential-request": re.compile(r"\b(reveal|print|send|exfiltrate|upload|leak|expose)\b.{0,64}\b(secrets?|tokens?|credentials?|api[_ -]?keys?|passwords?)\b", re.I | re.S),
        "tool-authority": re.compile(r"\b(call|invoke|run|execute|launch)\b.{0,64}\b(tools?|commands?|shell|terminal|payments?|trades?|deploy(?:ment)?)\b", re.I | re.S),
        "policy-bypass": re.compile(r"\b(bypass|disable|override|evade)\b.{0,64}\b(polic(?:y|ies)|safety|authorization|approvals?|guardrails?)\b", re.I | re.S),
    }

    @classmethod
    def scan(cls, text: str) -> tuple[str, ...]:
        return tuple(sorted(name for name, rx in cls.PATTERNS.items() if rx.search(text)))


class HardenedLiveResearchAdapter(LiveResearchAdapter):
    """Live research adapter that rescans snapshots with the hardened detector."""

    def fetch(self, url: str, headers: Mapping[str, str] | None = None) -> RetrievalSnapshot:
        snap = super().fetch(url, headers=headers)
        flags = snap.injection_flags
        if snap.content_type.startswith("text/") or snap.content_type in {"application/json", "application/xml", "application/xhtml+xml"}:
            flags = HardenedRetrievedContentFirewall.scan(snap.text())
        return replace(snap, injection_flags=flags, instruction_authority="retrieved-content-data-only")


__all__ = ["HardenedLiveResearchAdapter", "HardenedRetrievedContentFirewall"]

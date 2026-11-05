#!/usr/bin/env python3
"""Canonical retrieved-content security layer for MUSITU Axiom Frontier v5.

Retrieved text is always data, never authority. Detection is conservative and
normalizes common Unicode/zero-width obfuscation before pattern matching.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

_ZERO_WIDTH = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]")
_WS = re.compile(r"\s+")


def normalize_retrieved_text(text: str) -> str:
    if not isinstance(text, str):
        raise TypeError("retrieved text must be str")
    x = unicodedata.normalize("NFKC", text)
    x = _ZERO_WIDTH.sub("", x)
    x = _WS.sub(" ", x)
    return x.strip()


class RetrievedContentFirewall:
    """Flag authority-confusion, credential theft, tool coercion and bypass text."""

    PATTERNS = {
        "ignore-prior": re.compile(
            r"\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|polic(?:y|ies)|messages?)\b",
            re.I,
        ),
        # Treat explicit instruction headers as authority-confusion. Mere prose
        # that mentions the phrase "system prompt" in the middle of a sentence
        # is not itself an attack signal.
        "system-override": re.compile(
            r"^\s*(?:system|developer|assistant)\s+(?:prompt|message|instructions?|role)\b",
            re.I | re.M,
        ),
        "credential-request": re.compile(
            r"\b(?:reveal|print|send|exfiltrate|upload|leak|dump|show|return|copy)\b.{0,72}\b(?:secrets?|tokens?|credentials?|api[_ -]?keys?|passwords?|private[_ -]?keys?)\b",
            re.I | re.S,
        ),
        "tool-authority": re.compile(
            r"\b(?:call|invoke|run|execute|launch|open|use)\b.{0,72}\b(?:tools?|commands?|shell|terminal|payments?|trades?|deploy(?:ment)?|browser|computer)\b",
            re.I | re.S,
        ),
        "policy-bypass": re.compile(
            r"\b(?:bypass|disable|override|ignore|evade|circumvent)\b.{0,72}\b(?:polic(?:y|ies)|safety|authorization|approvals?|guardrails?|controls?|permissions?)\b",
            re.I | re.S,
        ),
        "role-escalation": re.compile(
            r"\b(?:you are now|act as|switch to|become)\b.{0,48}\b(?:system|developer|admin|administrator|root|superuser)\b",
            re.I | re.S,
        ),
        "data-exfiltration": re.compile(
            r"\b(?:post|send|upload|exfiltrate|transmit)\b.{0,96}\b(?:to|into)\b.{0,64}\b(?:https?://|webhook|endpoint|server|site|domain)\b",
            re.I | re.S,
        ),
    }

    @classmethod
    def scan(cls, text: str) -> tuple[str, ...]:
        normalized = normalize_retrieved_text(text)
        return tuple(sorted(name for name, rx in cls.PATTERNS.items() if rx.search(normalized)))

    @classmethod
    def contains_authority_attack(cls, text: str) -> bool:
        return bool(cls.scan(text))


@dataclass(frozen=True)
class RetrievedInstructionAssessment:
    authority: str
    flags: tuple[str, ...]
    executable: bool
    reason: str


def assess_retrieved_content(text: str) -> RetrievedInstructionAssessment:
    flags = RetrievedContentFirewall.scan(text)
    return RetrievedInstructionAssessment(
        authority="retrieved-content-data-only",
        flags=flags,
        executable=False,
        reason=(
            "retrieved content is evidence/data only; embedded instructions never receive execution authority"
        ),
    )


__all__ = [
    "RetrievedContentFirewall",
    "RetrievedInstructionAssessment",
    "assess_retrieved_content",
    "normalize_retrieved_text",
]

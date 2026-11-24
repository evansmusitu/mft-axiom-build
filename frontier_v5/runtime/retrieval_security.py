#!/usr/bin/env python3
"""Canonical retrieved-content security layer for MUSITU Axiom Frontier v5.

Retrieved text is always data, never authority. Detection is conservative and
normalizes common Unicode/zero-width obfuscation before pattern matching.
"""
from __future__ import annotations

from dataclasses import dataclass
import base64
import binascii
import re
import unicodedata

# Invisible/format characters that can split keywords: soft hyphen, zero-width
# and bidi controls, word joiners, BOM, Hangul fillers, variation selectors and
# Unicode tag characters.
_INVISIBLE = re.compile(
    "[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e"
    "\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\U000e0000-\U000e0fff]"
)
_COMBINING = re.compile("[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]")
# Common Cyrillic/Greek confusables for Latin letters (NFKC does not map them).
_HOMOGLYPHS = str.maketrans({
    "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y",
    "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u04bb": "h",
    "\u04cf": "l", "\u051b": "q", "\u051d": "w", "\u043a": "k",
    "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H",
    "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0423": "Y", "\u0425": "X",
    "\u0405": "S", "\u0406": "I", "\u0408": "J", "\u051a": "Q", "\u051c": "W", "\u04ba": "H",
    "\u04c0": "I", "\u04ae": "Y",
    "\u03b1": "a", "\u03bf": "o", "\u03c1": "p", "\u03bd": "v", "\u03c5": "u", "\u03b9": "i",
    "\u03ba": "k", "\u03c7": "x", "\u03b5": "e", "\u03c4": "t", "\u03b3": "y", "\u03c9": "w",
    "\u03b7": "n",
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I",
    "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T",
    "\u03a5": "Y", "\u03a7": "X",
    "\u0131": "i", "\u0261": "g", "\u0251": "a", "\u0585": "o", "\u057d": "u",
})
# Keep line breaks so line-anchored patterns still see headers mid-document.
_HSPACE = re.compile(r"[^\S\n]+")
_LINEBREAKS = re.compile(r"\s*\n\s*")
_BASE64_RUN = re.compile(r"[A-Za-z0-9+/_-]{24,}={0,2}")
_MAX_DECODE_DEPTH = 2
_MAX_DECODED_SEGMENTS = 32
_MAX_BASE64_RUN = 65_536


def normalize_retrieved_text(text: str) -> str:
    if not isinstance(text, str):
        raise TypeError("retrieved text must be str")
    x = unicodedata.normalize("NFKC", text)
    x = _INVISIBLE.sub("", x)
    x = _COMBINING.sub("", unicodedata.normalize("NFKD", x))
    x = x.translate(_HOMOGLYPHS)
    x = _LINEBREAKS.sub("\n", _HSPACE.sub(" ", x))
    return x.strip()


def _decode_base64_text(run: str) -> str | None:
    """Return printable UTF-8 text encoded in a base64/base64url run, else None."""
    body = run[:_MAX_BASE64_RUN].rstrip("=")
    if "-" in body or "_" in body:
        if "+" in body or "/" in body:
            return None
        body = body.replace("-", "+").replace("_", "/")
    if len(body) % 4 == 1:
        body = body[:-1]
    try:
        text = base64.b64decode(body + "=" * (-len(body) % 4), validate=True).decode("utf-8")
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    printable = sum(ch.isprintable() or ch in "\t\r\n" for ch in text)
    if not text or printable < 0.95 * len(text):
        return None
    return text


class RetrievedContentFirewall:
    """Flag authority-confusion, credential theft, tool coercion and bypass text."""

    PATTERNS = {
        "ignore-prior": re.compile(
            r"\b(?:ignore|disregard|forget|discard|abandon)\s+(?:(?:all|any|every|each)\s+(?:of\s+)?)?"
            r"(?:(?:the|your|my|our|these|those|its|their)\s+)?"
            r"(?:previous|prior|above|earlier|preceding|original|initial|existing|former)\s+"
            r"(?:instructions?|rules?|polic(?:y|ies)|messages?|directions?|directives?|guidelines?|guidance"
            r"|prompts?|commands?|orders?|context|constraints?)\b"
            # "ignore the instructions above"
            r"|\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:(?:the|your|any)\s+)?"
            r"(?:instructions?|rules?|prompts?|directions?|guidelines?)\s+"
            r"(?:above|before|given\s+(?:above|before|earlier|previously)|so\s+far)\b"
            # paraphrase: "disregard everything you were told earlier"
            r"|\b(?:ignore|disregard|forget|discard)\s+(?:everything|anything|all|whatever)\s+"
            r"(?:(?:that\s+)?(?:you|we|i)\s+(?:were|was|have\s+been|had\s+been|'ve\s+been|are|have)\s+)?"
            r"(?:told|said|instructed|given|asked|taught|shown)\b"
            # French: "ignorez les instructions precedentes" (accents already stripped)
            r"|\b(?:ignore[rz]?|oublie[rz]?|ne\s+tenez\s+(?:pas|plus)\s+compte\s+des?)\s+(?:toutes?\s+)?"
            r"(?:(?:les|des|vos|ces)\s+)?(?:instructions?|consignes?|regles?|directives?|ordres?)\s+"
            r"(?:precedentes?|anterieures?|ci-dessus|initiales?)\b",
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
        flags: set[str] = set()
        pending = [(normalize_retrieved_text(text), 0)]
        budget = _MAX_DECODED_SEGMENTS
        while pending:
            normalized, depth = pending.pop()
            flags.update(name for name, rx in cls.PATTERNS.items() if rx.search(normalized))
            if depth >= _MAX_DECODE_DEPTH:
                continue
            # Rescan instructions hidden in long base64/base64url runs (bounded).
            for match in _BASE64_RUN.finditer(normalized):
                if budget <= 0:
                    break
                decoded = _decode_base64_text(match.group(0))
                if decoded is not None:
                    budget -= 1
                    pending.append((normalize_retrieved_text(decoded), depth + 1))
        return tuple(sorted(flags))

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

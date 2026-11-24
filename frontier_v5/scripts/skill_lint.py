#!/usr/bin/env python3
"""Strict lint for MUSITU Axiom skill folders.

For every skill folder passed on the command line:

* ``SKILL.md`` exists, is UTF-8, has at most 500 lines and starts on line 1
  with a ``---`` YAML frontmatter fence that a later ``---`` line closes;
* the frontmatter is a strict YAML subset of unique top-level ``key: value``
  entries (plain, single/double-quoted or ``|``/``>`` block scalars);
* ``name`` is a non-empty string equal to the folder name and matching
  ``[a-z0-9-]{1,64}``; ``description`` is a non-empty string;
* every relative file reference in SKILL.md (``references/...``,
  ``scripts/...``, ``agents/...``, ``assets/...``, ``./...`` and ``../...``)
  resolves inside the skill *as package_skills.py packages it*: it must exist
  in the skill folder or be a file the packager injects
  (``references/{QUALITY,PROOF,ROUTING,COMMERCIAL}.md`` from shared/,
  ``scripts/{proof_envelope,scenario_grid}.py``, generated
  ``agents/openai.yaml``). A backticked `` `../../shared/<file>` `` reference
  is rewritten by the packager to ``references/<file>``; any other reference
  that leaves the skill folder fails;
* the skill folder contains no symlinks.

package_skills.py imports the packaging contract (injected files and the
shared-reference rewrite) from this module so the two cannot drift apart.
"""
from __future__ import annotations

from pathlib import Path
import json
import os
import posixpath
import re
import sys
import textwrap
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "shared"
HELPERS = ROOT / "scripts"

# Packaging contract shared with package_skills.py.
SHARED_REFERENCES = ("QUALITY.md", "PROOF.md", "ROUTING.md", "COMMERCIAL.md")
HELPER_SCRIPTS = ("proof_envelope.py", "scenario_grid.py")
GENERATED_FILES = ("agents/openai.yaml",)
SKILL_NAME_RE = re.compile(r"[a-z0-9-]{1,64}")
MAX_SKILL_LINES = 500

_KEY_LINE = re.compile(r"([A-Za-z0-9_][A-Za-z0-9_-]*)[ \t]*:(?:[ \t]+(.*))?")
_BLOCK_HEADER = re.compile(r"[|>](?:[+-]?[1-9]?|[1-9][+-])")
_YAML_NULL = {"", "~", "null", "Null", "NULL"}
_YAML_NON_STRING = re.compile(
    r"(?:true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF"
    r"|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+"
    r"|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))"
)
_REFERENCE = re.compile(
    r"(?<![\w./\-])"
    r"((?:\.{1,2}/)*(?:references|scripts|agents|assets)/[\w.\-/]*[\w\-]"
    r"|(?:\.{1,2}/)+[\w.\-/]*[\w\-])"
)


class FrontmatterError(ValueError):
    pass


class NonStringValue:
    """A YAML value that is not a string (number, boolean or nested block)."""

    def __init__(self, raw: str) -> None:
        self.raw = raw


def rewrite_shared_references(text: str) -> str:
    """The packager's SKILL.md rewrite of backticked shared-contract references."""
    for name in SHARED_REFERENCES:
        text = text.replace(f"`../../shared/{name}`", f"`references/{name}`")
    return text


def injected_files() -> dict[str, Path]:
    """Files the packager adds to every skill: path inside the skill -> source file."""
    out = {f"references/{name}": SHARED / name for name in SHARED_REFERENCES}
    out.update({f"scripts/{name}": HELPERS / name for name in HELPER_SCRIPTS})
    return out


def _quoted_value(key: str, text: str, lineno: int) -> str:
    if text.startswith('"'):
        try:
            value, end = json.JSONDecoder().raw_decode(text)
        except json.JSONDecodeError as exc:
            raise FrontmatterError(f"frontmatter line {lineno}: invalid double-quoted value for {key}: {exc.msg}") from None
    else:
        m = re.match(r"'((?:[^']|'')*)'", text, re.S)
        if not m:
            raise FrontmatterError(f"frontmatter line {lineno}: unterminated single-quoted value for {key}")
        value, end = m.group(1).replace("''", "'"), m.end()
    rest = text[end:].strip()
    if rest and not rest.startswith("#"):
        raise FrontmatterError(f"frontmatter line {lineno}: unexpected text after quoted value for {key}")
    return value


def _scalar(key: str, raw: str, continuation: list[str], lineno: int) -> Any:
    if raw[:1] in ("|", ">"):
        if not _BLOCK_HEADER.fullmatch(raw):
            raise FrontmatterError(f"frontmatter line {lineno}: invalid block scalar header for {key}")
        lines = textwrap.dedent("\n".join(continuation)).split("\n")
        return ("\n" if raw[0] == "|" else " ").join(x.strip() if raw[0] == ">" else x for x in lines).strip()
    if raw == "" and continuation:
        return NonStringValue("\n".join(continuation))
    if raw[:1] in ('"', "'"):
        return _quoted_value(key, " ".join([raw] + [c.strip() for c in continuation]), lineno)
    if raw[:1] in tuple("[]{},&*!%@`#"):
        raise FrontmatterError(f"frontmatter line {lineno}: value for {key} must be quoted")
    if ": " in raw or raw.endswith(":") or " #" in raw:
        raise FrontmatterError(f"frontmatter line {lineno}: plain value for {key} contains ': ' or ' #'; quote it")
    value = " ".join([raw] + [c.strip() for c in continuation]).strip()
    if value in _YAML_NULL:
        return None
    if _YAML_NON_STRING.fullmatch(value):
        return NonStringValue(value)
    return value


def parse_frontmatter(text: str) -> tuple[dict[str, Any], int]:
    """Parse the leading frontmatter; return (fields, index of the first body line)."""
    lines = text.split("\n")
    if lines[0].rstrip("\r") != "---":
        raise FrontmatterError("missing YAML frontmatter: SKILL.md must start on line 1 with '---'")
    close = next((i for i in range(1, len(lines)) if lines[i].rstrip("\r") == "---"), None)
    if close is None:
        raise FrontmatterError("unclosed YAML frontmatter: no closing '---' line")
    block = [line.rstrip("\r") for line in lines[1:close]]
    fields: dict[str, Any] = {}
    i = 0
    while i < len(block):
        line, lineno = block[i], i + 2
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        if line[:1] in (" ", "\t"):
            raise FrontmatterError(f"frontmatter line {lineno}: unexpected indentation")
        m = _KEY_LINE.fullmatch(line)
        if not m:
            raise FrontmatterError(f"frontmatter line {lineno}: expected 'key: value'")
        key, raw = m.group(1), (m.group(2) or "").strip()
        if key in fields:
            raise FrontmatterError(f"frontmatter line {lineno}: duplicate key {key}")
        j = i + 1
        while j < len(block) and (block[j][:1] in (" ", "\t") or not block[j].strip()):
            j += 1
        continuation = block[i + 1:j]
        while continuation and not continuation[-1].strip():
            continuation.pop()
        fields[key] = _scalar(key, raw, continuation, lineno)
        i = j
    return fields, close + 1


def _symlinks(skill_dir: Path) -> list[str]:
    found = []
    for dirpath, dirnames, filenames in os.walk(skill_dir, followlinks=False):
        for entry in dirnames + filenames:
            full = Path(dirpath) / entry
            if full.is_symlink():
                found.append(full.relative_to(skill_dir).as_posix())
    return sorted(found)


def check_references(skill_dir: Path, body: str) -> list[str]:
    """Check relative file references in the SKILL.md body as packaged."""
    errs: list[str] = []
    injected = injected_files()
    rewritten = rewrite_shared_references(body)
    from_shared = {f"references/{name}" for name in SHARED_REFERENCES if f"`../../shared/{name}`" in body}
    root = skill_dir.resolve()
    for token in sorted(set(_REFERENCE.findall(rewritten))):
        rel = posixpath.normpath(token)
        if rel == ".." or rel.startswith("../") or rel.startswith("/"):
            errs.append(f"reference leaves the skill folder and will not exist in the packaged skill: {token}")
            continue
        target = skill_dir / rel
        if target.exists():
            if not target.resolve().is_relative_to(root):
                errs.append(f"reference resolves outside the skill folder: {token}")
            elif rel in from_shared and target.is_file() and (
                not injected[rel].is_file() or target.read_bytes() != injected[rel].read_bytes()
            ):
                errs.append(
                    f"SKILL.md references ../../shared/{posixpath.basename(rel)} but the skill ships a different "
                    f"{rel}; the packaged reference would resolve to the skill-specific file"
                )
            continue
        if rel in injected and injected[rel].is_file():
            continue
        if rel in GENERATED_FILES:
            continue
        errs.append(f"referenced file does not exist in the skill or the packager-injected set: {token}")
    return errs


def validate_skill(d: str | Path) -> list[str]:
    skill_dir = Path(d)
    if not skill_dir.is_dir():
        return ["not a skill directory"]
    errs: list[str] = []
    if skill_dir.is_symlink():
        errs.append("skill folder must not be a symlink")
    errs.extend(f"symlink not allowed in skill: {rel}" for rel in _symlinks(skill_dir))
    p = skill_dir / "SKILL.md"
    if not p.is_file():
        return errs + ["missing SKILL.md"]
    try:
        t = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return errs + ["SKILL.md is not valid UTF-8"]
    if len(t.splitlines()) > MAX_SKILL_LINES:
        errs.append(f"SKILL.md exceeds {MAX_SKILL_LINES} lines")
    body = t
    try:
        fields, body_start = parse_frontmatter(t)
    except FrontmatterError as exc:
        errs.append(str(exc))
    else:
        body = "\n".join(t.split("\n")[body_start:])
        name = fields.get("name")
        if "name" not in fields:
            errs.append("missing name")
        elif not isinstance(name, str) or not name.strip():
            errs.append("name must be a non-empty string")
        else:
            if not SKILL_NAME_RE.fullmatch(name):
                errs.append("name must be lowercase letters/digits/hyphens and <=64 chars")
            if name != skill_dir.resolve().name:
                errs.append(f"name {name!r} does not match folder name {skill_dir.resolve().name!r}")
        description = fields.get("description")
        if "description" not in fields:
            errs.append("missing description")
        elif not isinstance(description, str) or not description.strip():
            errs.append("description must be a non-empty string")
    errs.extend(check_references(skill_dir, body))
    return errs


def main():
    paths = sys.argv[1:]
    if not paths:
        raise SystemExit("pass one or more skill folders")
    report = {}
    failed = False
    for p in paths:
        e = validate_skill(p)
        report[p] = e
        failed |= bool(e)
    print(json.dumps(report, indent=2))
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()

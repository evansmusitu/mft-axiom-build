#!/usr/bin/env python3
"""Package MUSITU Axiom skills into deterministic, self-contained zip files.

Each ``<skill>.zip`` holds the skill folder plus the shared contracts and helper
scripts its SKILL.md relies on (the packaging contract lives in skill_lint.py).

Merge policy for injected files:
* skill-specific files win: if a skill ships its own ``references/<shared file>``
  or ``agents/openai.yaml``, that file is kept and the shared/ version or the
  generated metadata is only added when the skill does not ship the file
  (kept overrides are listed in the JSON output);
* helper scripts (``scripts/proof_envelope.py``, ``scripts/scenario_grid.py``)
  are shared tooling: a skill shipping a *different* file under those names
  fails packaging; an identical copy is accepted.

Every skill must pass skill_lint.py, be a direct child folder of skills/
(``--skill`` takes a folder name, not a path) and contain no symlinks.

Zips are byte-reproducible: entries sorted by archive path, no directory
entries, fixed 1980-01-01 00:00:00 timestamps, fixed 0644 regular-file
permissions, Unix creator system and DEFLATE level 9. DEFLATE output depends
on the zlib implementation, so compare hashes produced with the same zlib.
"""
from __future__ import annotations

from pathlib import Path
import argparse
import importlib.util
import json
import os
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
SHARED = ROOT / "shared"
HELPERS = ROOT / "scripts"
MANIFEST = ROOT / "MANIFEST.json"

ZIP_DATE_TIME = (1980, 1, 1, 0, 0, 0)
ZIP_FILE_MODE = 0o100644  # regular file, rw-r--r--
ZIP_COMPRESSION = zipfile.ZIP_DEFLATED
ZIP_COMPRESSLEVEL = 9
ZIP_CREATE_SYSTEM = 3  # Unix


def _load_skill_lint():
    spec = importlib.util.spec_from_file_location("musitu_skill_lint", HELPERS / "skill_lint.py")
    module = importlib.util.module_from_spec(spec)
    previous, sys.dont_write_bytecode = sys.dont_write_bytecode, True  # keep __pycache__ out of the source tree
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


lint = _load_skill_lint()


class PackagingError(Exception):
    pass


def parse_frontmatter(text: str):
    """Return (name, description) from the strict SKILL.md frontmatter."""
    try:
        fields, _ = lint.parse_frontmatter(text)
    except lint.FrontmatterError as exc:
        raise ValueError(f"SKILL.md frontmatter: {exc}") from None
    name, desc = fields.get("name"), fields.get("description")
    if not isinstance(name, str) or not name.strip() or not isinstance(desc, str) or not desc.strip():
        raise ValueError("SKILL.md missing name/description frontmatter")
    return name.strip(), desc.strip()


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def openai_metadata(text: str) -> bytes:
    name, desc = parse_frontmatter(text)
    title = " ".join(x.capitalize() for x in name.removeprefix("musitu-").split("-"))
    short = desc.split(".", 1)[0].strip()
    if len(short) > 90:
        short = short[:87].rstrip() + "..."
    display_name = "MUSITU Axiom — " + title
    default_prompt = "Use MUSITU Axiom's " + title + " workflow for this task."
    content = (
        "interface:\n"
        f"  display_name: {yaml_quote(display_name)}\n"
        f"  short_description: {yaml_quote(short)}\n"
        f"  default_prompt: {yaml_quote(default_prompt)}\n"
    )
    return content.encode("utf-8")


def resolve_skill_dir(name: str) -> Path:
    """Map a skill name to its folder; only direct, non-symlink children of skills/."""
    if not isinstance(name, str) or not lint.SKILL_NAME_RE.fullmatch(name):
        raise PackagingError(f"invalid skill name {name!r}: pass a folder name under skills/ ([a-z0-9-]{{1,64}})")
    d = SKILLS / name
    if d.is_symlink():
        raise PackagingError(f"skill folder must not be a symlink: {name}")
    if not d.is_dir() or d.resolve().parent != SKILLS.resolve():
        raise PackagingError(f"unknown skill: {name}")
    return d


def _skill_files(skill_dir: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for dirpath, dirnames, filenames in os.walk(skill_dir, followlinks=False):
        for entry in dirnames + filenames:
            full = Path(dirpath) / entry
            if full.is_symlink():
                raise PackagingError(f"{skill_dir.name}: symlinks are not allowed: {full.relative_to(skill_dir).as_posix()}")
        for entry in filenames:
            full = Path(dirpath) / entry
            if not full.is_file():
                raise PackagingError(f"{skill_dir.name}: not a regular file: {full.relative_to(skill_dir).as_posix()}")
            files[full.relative_to(skill_dir).as_posix()] = full.read_bytes()
    return files


def skill_package_files(skill_dir: Path) -> tuple[dict[str, bytes], list[str]]:
    """Return (files inside the skill zip, skill-specific files kept over injected ones)."""
    errors = lint.validate_skill(skill_dir)
    if errors:
        raise PackagingError(f"{skill_dir.name}: skill_lint failed: " + "; ".join(errors))
    files = _skill_files(skill_dir)
    text = files["SKILL.md"].decode("utf-8")
    files["SKILL.md"] = lint.rewrite_shared_references(text).encode("utf-8")
    kept: list[str] = []
    for rel, source in lint.injected_files().items():
        data = source.read_bytes()
        if rel not in files:
            files[rel] = data
        elif files[rel] != data:
            if rel.startswith("scripts/"):
                raise PackagingError(f"{skill_dir.name}: ships a different {rel}; shared helper scripts cannot be overridden")
            kept.append(rel)
    for rel in lint.GENERATED_FILES:
        if rel in files:
            kept.append(rel)
        else:
            files[rel] = openai_metadata(text)
    return files, sorted(kept)


def write_deterministic_zip(path: Path, entries: dict[str, bytes]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as fh, zipfile.ZipFile(fh, "w") as z:
            for arcname in sorted(entries):
                info = zipfile.ZipInfo(arcname, date_time=ZIP_DATE_TIME)
                info.compress_type = ZIP_COMPRESSION
                info.create_system = ZIP_CREATE_SYSTEM
                info.external_attr = ZIP_FILE_MODE << 16
                z.writestr(info, entries[arcname], compress_type=ZIP_COMPRESSION, compresslevel=ZIP_COMPRESSLEVEL)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return path


def package_skill(skill_dir: Path, out_dir: Path) -> Path:
    files, _ = skill_package_files(skill_dir)
    return write_deterministic_zip(
        out_dir / (skill_dir.name + ".zip"),
        {f"{skill_dir.name}/{rel}": data for rel, data in files.items()},
    )


def selected_for_profile(profile: str):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if profile == "submission":
        return manifest["submission_skills"]
    if profile == "frontier":
        return manifest["frontier_skills"]
    if profile == "all":
        return sorted(d.name for d in SKILLS.iterdir() if d.is_dir())
    raise ValueError(f"unknown profile: {profile}")


def make_bundle(profile: str, built: list[Path], out: Path):
    bundle = out / f"MUSITU_AXIOM_V5_{profile.upper()}_SKILL_ZIPS.zip"
    return write_deterministic_zip(bundle, {p.name: p.read_bytes() for p in built})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--skill", action="append", help="skill folder name under skills/ (repeatable)")
    ap.add_argument("--profile", choices=("all", "submission", "frontier"), default="all")
    ap.add_argument("--bundle", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    try:
        selected = list(dict.fromkeys(args.skill or selected_for_profile(args.profile)))
        dirs = [resolve_skill_dir(name) for name in selected]
        packages = {d.name: skill_package_files(d) for d in dirs}  # validate everything before writing
        built = [
            write_deterministic_zip(out / (name + ".zip"), {f"{name}/{rel}": data for rel, data in files.items()})
            for name, (files, _) in packages.items()
        ]
        bundle = make_bundle(args.profile, built, out) if args.bundle else None
    except (PackagingError, ValueError, KeyError, OSError) as exc:
        raise SystemExit(f"package_skills: {exc}")
    kept = {name: k for name, (_, k) in packages.items() if k}
    print(json.dumps({
        "profile": args.profile,
        "built": [str(x) for x in built],
        "count": len(built),
        "bundle": str(bundle) if bundle else None,
        "skill_specific_files_kept": kept,
    }, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


REPOSITORY = Path(__file__).resolve().parents[2]
SOURCE = REPOSITORY / "axiom_interface"
FORBIDDEN_BINARY = {".apk", ".aab", ".ipa", ".dmg", ".pkg", ".exe", ".msi", ".zip"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def shell_assets() -> list[Path]:
    service_worker = (SOURCE / "sw.js").read_text(encoding="utf-8")
    match = re.search(r"const SHELL=\[(.*?)\];", service_worker, re.DOTALL)
    if not match:
        raise SystemExit("service-worker shell manifest unavailable")
    names = re.findall(r"'\./([^']+)'", match.group(1))
    if not names or len(names) != len(set(names)):
        raise SystemExit("service-worker shell manifest is empty or duplicated")
    required = {Path(name) for name in ("index.html", "app.js", "browser_app.js", "browser_session.js", "browser-app.json", "manifest.webmanifest", "sw.js")}
    selected = {Path(name) for name in names}
    selected.add(Path("sw.js"))
    if not required.issubset(selected):
        raise SystemExit(f"browser application assets missing: {sorted(str(path) for path in required - selected)}")
    return sorted(selected, key=lambda path: path.as_posix())


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=REPOSITORY, text=True).strip()


def build(output: Path) -> dict:
    output = output.resolve()
    if output.exists():
        raise SystemExit(f"output already exists: {output}")
    output.mkdir(parents=True)
    records = []
    for relative in shell_assets():
        if relative.is_absolute() or ".." in relative.parts or relative.suffix.lower() in FORBIDDEN_BINARY:
            raise SystemExit(f"unsafe browser application asset: {relative}")
        source = SOURCE / relative
        if not source.is_file() or source.is_symlink():
            raise SystemExit(f"browser application asset missing or unsafe: {relative}")
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        records.append({"path": relative.as_posix(), "bytes": target.stat().st_size, "sha256": sha256(target)})
    status = subprocess.run(["git", "diff", "--quiet", "--ignore-submodules", "HEAD", "--"], cwd=REPOSITORY).returncode
    manifest = {
        "schema": "musitu.axiom.browser-application-build.v1",
        "status": "PASS",
        "source_git_sha": git("rev-parse", "HEAD"),
        "source_worktree_clean": status == 0,
        "entry_document": "index.html",
        "entry_route": "#/home",
        "content_type": "text/html; charset=utf-8",
        "content_disposition": "inline",
        "normal_launch_download": False,
        "files": records,
    }
    (output / "build-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the dependency-light MUSITU AXIOM browser application directory")
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    result = build(arguments.output)
    print(json.dumps({"status": result["status"], "files": len(result["files"]), "output": str(arguments.output.resolve())}, sort_keys=True))
    print("MUSITU_AXIOM_BROWSER_APPLICATION_BUILD_PASS")


if __name__ == "__main__":
    main()

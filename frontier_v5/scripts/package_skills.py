#!/usr/bin/env python3
from pathlib import Path
import argparse, shutil, tempfile, zipfile, json

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
SHARED = ROOT / "shared"
HELPERS = ROOT / "scripts"


def package_skill(skill_dir: Path, out_dir: Path):
    with tempfile.TemporaryDirectory() as td:
        stage = Path(td) / skill_dir.name
        shutil.copytree(skill_dir, stage)
        refs = stage / "references"
        refs.mkdir(exist_ok=True)
        for name in ("QUALITY.md", "PROOF.md", "ROUTING.md", "COMMERCIAL.md"):
            shutil.copy(SHARED / name, refs / name)
        scripts = stage / "scripts"
        scripts.mkdir(exist_ok=True)
        for name in ("proof_envelope.py", "scenario_grid.py"):
            shutil.copy(HELPERS / name, scripts / name)
        p = stage / "SKILL.md"
        t = p.read_text(encoding="utf-8")
        t = t.replace("`../../shared/QUALITY.md`", "`references/QUALITY.md`")
        t = t.replace("`../../shared/PROOF.md`", "`references/PROOF.md`")
        t = t.replace("`../../shared/ROUTING.md`", "`references/ROUTING.md`")
        t = t.replace("`../../shared/COMMERCIAL.md`", "`references/COMMERCIAL.md`")
        p.write_text(t, encoding="utf-8")
        out_dir.mkdir(parents=True, exist_ok=True)
        zp = out_dir / (skill_dir.name + ".zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for f in stage.rglob("*"):
                if f.is_file():
                    z.write(f, arcname=str(Path(skill_dir.name) / f.relative_to(stage)))
        return zp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--skill", action="append")
    args = ap.parse_args()
    out = Path(args.out)
    selected = args.skill or sorted(d.name for d in SKILLS.iterdir() if d.is_dir())
    built = []
    for name in selected:
        d = SKILLS / name
        if not d.is_dir():
            raise SystemExit(f"unknown skill: {name}")
        built.append(str(package_skill(d, out)))
    print(json.dumps({"built": built, "count": len(built)}, indent=2))


if __name__ == "__main__":
    main()

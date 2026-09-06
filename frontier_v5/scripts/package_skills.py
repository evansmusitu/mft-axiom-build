#!/usr/bin/env python3
from pathlib import Path
import argparse, shutil, tempfile, zipfile, json, re

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
SHARED = ROOT / "shared"
HELPERS = ROOT / "scripts"
MANIFEST = ROOT / "MANIFEST.json"


def parse_frontmatter(text: str):
    name = re.search(r"^name:\s*([^\n]+)$", text, re.M)
    desc = re.search(r'^description:\s*"?(.*?)"?\s*$', text, re.M)
    if not name or not desc:
        raise ValueError("SKILL.md missing name/description frontmatter")
    return name.group(1).strip().strip('"'), desc.group(1).strip().strip('"')


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def add_openai_metadata(stage: Path, text: str):
    name, desc = parse_frontmatter(text)
    title = " ".join(x.capitalize() for x in name.removeprefix("musitu-").split("-"))
    short = desc.split(".", 1)[0].strip()
    if len(short) > 90:
        short = short[:87].rstrip() + "..."
    agents = stage / "agents"
    agents.mkdir(exist_ok=True)
    content = (
        "interface:\n"
        f"  display_name: {yaml_quote('MUSITU Axiom — ' + title)}\n"
        f"  short_description: {yaml_quote(short)}\n"
        f"  default_prompt: {yaml_quote('Use MUSITU Axiom\'s ' + title + ' workflow for this task.')}\n"
    )
    (agents / "openai.yaml").write_text(content, encoding="utf-8")


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
        text = p.read_text(encoding="utf-8")
        text = text.replace("`../../shared/QUALITY.md`", "`references/QUALITY.md`")
        text = text.replace("`../../shared/PROOF.md`", "`references/PROOF.md`")
        text = text.replace("`../../shared/ROUTING.md`", "`references/ROUTING.md`")
        text = text.replace("`../../shared/COMMERCIAL.md`", "`references/COMMERCIAL.md`")
        p.write_text(text, encoding="utf-8")
        add_openai_metadata(stage, text)
        out_dir.mkdir(parents=True, exist_ok=True)
        zp = out_dir / (skill_dir.name + ".zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for f in stage.rglob("*"):
                if f.is_file():
                    z.write(f, arcname=str(Path(skill_dir.name) / f.relative_to(stage)))
        return zp


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
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as z:
        for p in built:
            z.write(p, arcname=p.name)
    return bundle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--skill", action="append")
    ap.add_argument("--profile", choices=("all", "submission", "frontier"), default="all")
    ap.add_argument("--bundle", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    selected = args.skill or selected_for_profile(args.profile)
    built: list[Path] = []
    for name in selected:
        d = SKILLS / name
        if not d.is_dir():
            raise SystemExit(f"unknown skill: {name}")
        built.append(package_skill(d, out))
    bundle = make_bundle(args.profile, built, out) if args.bundle else None
    print(json.dumps({"profile": args.profile, "built": [str(x) for x in built], "count": len(built), "bundle": str(bundle) if bundle else None}, indent=2))


if __name__ == "__main__":
    main()

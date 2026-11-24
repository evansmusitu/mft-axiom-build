#!/usr/bin/env python3
from pathlib import Path
import re, sys, json


def validate_skill(d):
    p = Path(d) / "SKILL.md"
    errs = []
    if not p.exists():
        return ["missing SKILL.md"]
    t = p.read_text(encoding="utf-8")
    if not t.startswith("---\n"):
        errs.append("missing YAML frontmatter")
    m = re.search(r"^name:\s*(.+)$", t, re.M)
    dsc = re.search(r"^description:\s*(.+)$", t, re.M)
    if not m:
        errs.append("missing name")
    if not dsc:
        errs.append("missing description")
    if m and not re.fullmatch(r"[a-z0-9-]{1,64}", m.group(1).strip()):
        errs.append("name must be lowercase letters/digits/hyphens and <=64 chars")
    if len(t.splitlines()) > 500:
        errs.append("SKILL.md exceeds 500 lines")
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

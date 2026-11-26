#!/usr/bin/env python3
"""Build one dependency-free Windows offline custody declaration file."""
import argparse
from pathlib import Path
import re

def build(source_commit):
    if not re.fullmatch(r"[a-f0-9]{40}", source_commit):
        raise ValueError("SOURCE_COMMIT_INVALID")
    template = Path(__file__).resolve().parents[1] / "customer_frontier/qualification/gate3_owner_custody_reconciliation.template.ps1"
    text = template.read_text(encoding="utf-8")
    if text.count("@@SOURCE_COMMIT@@") != 1:
        raise ValueError("SOURCE_PLACEHOLDER_INVALID")
    return text.replace("@@SOURCE_COMMIT@@", source_commit).encode("utf-8-sig")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    args.out.write_bytes(build(args.source_commit))

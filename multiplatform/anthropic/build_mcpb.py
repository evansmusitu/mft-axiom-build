from __future__ import annotations
import zipfile
from pathlib import Path
ROOT=Path(__file__).parent/"mcpb"
OUT=ROOT.parent/"dist"
OUT.mkdir(exist_ok=True)
target=OUT/"musitu-axiom-frontier.mcpb"
with zipfile.ZipFile(target,"w",zipfile.ZIP_DEFLATED) as archive:
    for path in ROOT.rglob("*"):
        if path.is_file():
            archive.write(path,path.relative_to(ROOT))
print(target)

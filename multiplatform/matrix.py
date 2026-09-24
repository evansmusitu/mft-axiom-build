from __future__ import annotations
import json
from pathlib import Path
matrix=json.loads(Path("multiplatform/capabilities/matrix.json").read_text(encoding="utf-8"))
assert len(matrix["capabilities"])==30 and len(set(matrix["capabilities"]))==30
print("MUSITU_AXIOM_30_CAPABILITY_MATRIX_SHAPE_PASS")

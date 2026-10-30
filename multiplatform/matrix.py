from __future__ import annotations
import json
from pathlib import Path
matrix=json.loads(Path("multiplatform/capabilities/matrix.json").read_text(encoding="utf-8"))
rows=matrix["capabilities"]
assert len(rows)==30
assert len({row["name"] for row in rows})==30
assert all("evidence_fields" not in row for row in rows)
print("MUSITU_AXIOM_30_CAPABILITY_MATRIX_SHAPE_PASS")
print("implemented_reference_only",sum(row["status"]=="IMPLEMENTED_REFERENCE_ONLY" for row in rows))
print("unassessed",sum(row["status"]=="UNASSESSED" for row in rows))

from pathlib import Path
from typing import Any, Sequence

class AnalyticalStore:
    def parquet_roundtrip(self, path: str, columns: dict[str,Sequence[Any]]) -> int:
        import pyarrow as pa
        import pyarrow.parquet as pq
        table=pa.table(columns)
        pq.write_table(table,Path(path))
        return pq.read_table(Path(path)).num_rows
    def query_parquet(self, path: str, sql: str) -> list[tuple[Any,...]]:
        import duckdb
        return duckdb.connect().execute(sql.replace("__PARQUET__",repr(path))).fetchall()

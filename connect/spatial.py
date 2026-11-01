from typing import Any

class PostGISStore:
    def __init__(self,dsn:str)->None: self.dsn=dsn
    def execute(self,sql:str,params:tuple[Any,...]=())->list[tuple[Any,...]]:
        import psycopg
        with psycopg.connect(self.dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(sql,params)
                return cur.fetchall()
    def ensure_postgis(self)->str:
        rows=self.execute("select postgis_version()")
        if not rows or not rows[0][0]: raise RuntimeError("postgis_unavailable")
        return str(rows[0][0])

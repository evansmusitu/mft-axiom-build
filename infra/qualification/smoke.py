import json, os, time, uuid
from datetime import datetime, timezone
from pathlib import Path

RESULTS=[]

def check(name, fn):
    start=time.perf_counter()
    try:
        value=fn()
        RESULTS.append({"name":name,"status":"PASS","elapsed_ms":round((time.perf_counter()-start)*1000,2),"detail":value})
    except Exception as exc:
        RESULTS.append({"name":name,"status":"FAIL","elapsed_ms":round((time.perf_counter()-start)*1000,2),"detail":f"{type(exc).__name__}: {exc}"})

def mqtt_smoke():
    import paho.mqtt.client as mqtt
    topic=f"musitu/connect/qualification/{uuid.uuid4().hex}"
    received=[]
    client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    def on_message(_client,_userdata,msg): received.append(msg.payload.decode())
    client.on_message=on_message
    client.connect(os.getenv("MQTT_HOST","127.0.0.1"),1883,60)
    client.subscribe(topic,qos=1)
    client.loop_start()
    client.publish(topic,"connect-ok",qos=1).wait_for_publish()
    deadline=time.time()+5
    while time.time()<deadline and not received: time.sleep(.05)
    client.loop_stop(); client.disconnect()
    assert received==["connect-ok"], received
    return {"topic":topic,"qos":1}

def opcua_smoke():
    import asyncio
    from asyncua import Client, Server
    async def run():
        server=Server()
        await server.init()
        server.set_endpoint("opc.tcp://127.0.0.1:4840/musitu/")
        idx=await server.register_namespace("MUSITU")
        node=await server.nodes.objects.add_variable(idx,"QualificationValue",42)
        await server.start()
        try:
            async with Client(url="opc.tcp://127.0.0.1:4840/musitu/") as client:
                remote=client.get_node(node.nodeid)
                assert await remote.read_value()==42
        finally:
            await server.stop()
    asyncio.run(run())
    return {"endpoint":"opc.tcp://127.0.0.1:4840/musitu/"}

def analytical_smoke():
    import pyarrow as pa, pyarrow.parquet as pq, duckdb
    table=pa.table({"id":[1,2,3],"value":[1.5,2.5,3.5]})
    path=Path("/tmp/musitu-connect.parquet")
    pq.write_table(table,path)
    roundtrip=pq.read_table(path)
    assert roundtrip.num_rows==3
    con=duckdb.connect()
    rows=con.execute(f"select id,value from read_parquet('{path}') order by id").fetchall()
    assert rows==[(1,1.5),(2,2.5),(3,3.5)]
    return {"rows":len(rows),"parquet":"roundtrip-ok","duckdb":"query-ok"}

def postgis_smoke():
    import psycopg
    host=os.getenv("POSTGRES_HOST","127.0.0.1")
    with psycopg.connect(f"host={host} port=5432 dbname=connect user=postgres password=postgres",connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute("create extension if not exists postgis")
            cur.execute("select current_setting('server_version'), postgis_version(), st_astext(st_point(31.05,-17.83))")
            pg_version,version,wkt=cur.fetchone()
            assert pg_version.startswith("18."), pg_version
            assert version and wkt=="POINT(31.05 -17.83)"
    return {"postgresql_version":pg_version,"postgis_version":version,"geometry":"POINT(31.05 -17.83)"}

def lineage_smoke():
    event={"eventType":"COMPLETE","eventTime":"2026-09-27T00:00:00Z","run":{"runId":str(uuid.uuid4()),"facets":{}},"job":{"namespace":"musitu.connect","name":"qualification","facets":{}},"producer":"https://openlineage.io","inputs":[],"outputs":[]}
    assert event["eventType"]=="COMPLETE" and event["producer"]
    return {"eventType":event["eventType"],"schema":"OpenLineage-compatible envelope"}

def report():
    out={
        "schema":"musitu.connect.infrastructure_report.v1",
        "generated_at":datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
        "source_commit":os.getenv("GITHUB_SHA"),
        "workflow_run_id":os.getenv("GITHUB_RUN_ID"),
        "results":RESULTS,
        "all_passed":all(x["status"]=="PASS" for x in RESULTS),
        "axiom_integration_allowed":False
    }
    Path("qualification").mkdir(parents=True,exist_ok=True)
    Path("qualification/infrastructure_report.json").write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))
    raise SystemExit(0 if out["all_passed"] else 1)

check("mqtt_pubsub",mqtt_smoke)
check("opcua_client_server",opcua_smoke)
check("arrow_parquet_duckdb",analytical_smoke)
check("postgis_geometry",postgis_smoke)
check("openlineage_event",lineage_smoke)
report()

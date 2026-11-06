"""Private, offline restore of user SQL into a new local file. No network."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

# Exact user-object names and DDL from actual read-only candidate catalog.
EXPECTED={
 'd1add918ccee3b7e49c06cfdd1a6ca111275fb3ae5e9364e3ef0c0430a2ca2a2':('index','b48a1d58eb1b70455c7792be23452167065b08845573898d446be2c2e433ee03'),
 '89f527ce2b1210129eca1a3d0707da7a8fba984f801c943f6a52c5416ea5a9ff':('table','2f409aaaa2b12cc7afb019636621cd455ef8213d57620c646410ed7867cdfd0f'),
 'ed0481703a186ce91280f26928db38ffd7f22d0b8a9f339d963828d16ed8a148':('table','c8b2a04a9f0156fd6277db2daf10d7daf6eacefeb299299dafae7b160c402105'),
 '3d5ec0bc381c08922a99d928a9c5caf2b5f4c3eaf23297ea763dbd23b1b25297':('table','4cfb755116c9b0c3b20331b750f34b1e2af97f4d9a65be9a7fe64a6210664754'),
}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def restore(sql,output,expected=EXPECTED):
 if not isinstance(sql,bytes) or not 0<len(sql)<=8_000_000:raise ValueError('INVALID_EXPORT_SIZE')
 text=sql.decode('utf-8');path=Path(output)
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
 db=sqlite3.connect(path);deadline=time.monotonic()+10
 try:
  db.enable_load_extension(False);db.execute('PRAGMA foreign_keys=ON')
  def authorize(action,arg1,arg2,*_):
   if action in (sqlite3.SQLITE_ATTACH,sqlite3.SQLITE_DETACH):return sqlite3.SQLITE_DENY
   if action==sqlite3.SQLITE_FUNCTION and str(arg2).lower() in ('load_extension','readfile','writefile'):return sqlite3.SQLITE_DENY
   if action==sqlite3.SQLITE_PRAGMA and str(arg1).lower() not in ('foreign_keys','defer_foreign_keys','integrity_check','foreign_key_check','table_info'):return sqlite3.SQLITE_DENY
   return sqlite3.SQLITE_OK
  db.set_authorizer(authorize);db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
  db.executescript('BEGIN IMMEDIATE;\n'+text+'\nCOMMIT;')
  db.execute('PRAGMA foreign_keys=ON')
  if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('RESTORE_INTEGRITY_FAILED')
  objects=db.execute("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' AND name!='_cf_KV' ORDER BY type,name").fetchall()
  observed={sha(name.encode()):(kind,None if definition is None else sha(definition.encode())) for kind,name,definition in objects}
  if observed!=expected:raise ValueError('RESTORED_CATALOG_MISMATCH')
  tables=[]
  for kind,name,_ in objects:
   if kind!='table':continue
   cursor=db.execute('SELECT * FROM "'+name.replace('"','""')+'"');columns=[v[0] for v in cursor.description];rows=[]
   for row in cursor:
    if len(rows)>=100000:raise ValueError('RESTORE_ROW_BUDGET_EXCEEDED')
    values=[{'blob_b64':base64.b64encode(v).decode()} if isinstance(v,bytes) else v for v in row]
    rows.append(json.dumps(values,sort_keys=True,separators=(',',':'),allow_nan=False))
   canonical=json.dumps({'columns':columns,'rows':sorted(rows)},sort_keys=True,separators=(',',':')).encode()
   tables.append({'table_name_sha256':sha(name.encode()),'rows':len(rows),'data_sha256':sha(canonical)})
  return {'status':'LOCAL_USER_SQL_RESTORE_VERIFIED','user_objects':len(objects),'tables':sorted(tables,key=lambda v:v['table_name_sha256']),
   'user_data_sha256':sha(json.dumps(sorted(tables,key=lambda v:v['table_name_sha256']),sort_keys=True,separators=(',',':')).encode()),
   'scope':'fresh local SQLite user SQL only; not hosted D1 or internal metadata recovery','hosted_restore_qualified':False,'target_admitted':False,'release_authority':False}
 finally:db.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
 try:
  result=restore(sys.stdin.buffer.read(8_000_001),args.output);print(json.dumps(result,sort_keys=True))
 except Exception:
  print(json.dumps({'status':'LOCAL_RESTORE_FAILED_UNKNOWN','hosted_restore_qualified':False,'target_admitted':False,'release_authority':False}));raise SystemExit(1)

from __future__ import annotations
import hashlib, json, sqlite3, time, uuid
from pathlib import Path

OBJECT_TYPES={'project','work','artifact','agent','memory','source','approval'}
class GraphError(RuntimeError): pass
class TenantIsolationError(GraphError): pass

def _id(p): return f'{p}_{uuid.uuid4().hex}'
def _now(): return int(time.time())
def _json(v): return json.dumps(v,sort_keys=True,separators=(',',':'))
def _sha(v): return hashlib.sha256(v.encode()).hexdigest()

SCHEMA=''' 
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS graph_objects(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, object_type TEXT NOT NULL,
 version INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(tenant_id,project_id,object_type,id));
CREATE TABLE IF NOT EXISTS graph_events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,
 object_id TEXT NOT NULL,object_type TEXT NOT NULL,object_version INTEGER NOT NULL,event_type TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL,previous_event_sha256 TEXT,event_sha256 TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS import_keys(
 tenant_id TEXT NOT NULL,source_store TEXT NOT NULL,source_object_id TEXT NOT NULL,object_id TEXT NOT NULL,
 imported_sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,source_store,source_object_id));
CREATE INDEX IF NOT EXISTS idx_graph_objects_tenant_project ON graph_objects(tenant_id,project_id,object_type);
CREATE INDEX IF NOT EXISTS idx_graph_events_tenant_project_seq ON graph_events(tenant_id,project_id,seq);
'''

class ProjectWorkGraph:
    def __init__(self,path):
        self.path=Path(path); self.path.parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(self.path); self.db.row_factory=sqlite3.Row; self.db.executescript(SCHEMA); self.db.commit()
    def close(self): self.db.close()
    def _last_event_hash(self,tenant,project):
        row=self.db.execute('SELECT event_sha256 FROM graph_events WHERE tenant_id=? AND project_id=? ORDER BY seq DESC LIMIT 1',(tenant,project)).fetchone()
        return row['event_sha256'] if row else None
    def _event(self,tenant,project,obj_id,obj_type,version,event_type,payload_sha):
        prev=self._last_event_hash(tenant,project); eid=_id('gev'); now=_now()
        body=_json({'event_id':eid,'tenant_id':tenant,'project_id':project,'object_id':obj_id,'object_type':obj_type,'object_version':version,'event_type':event_type,'payload_sha256':payload_sha,'previous_event_sha256':prev,'created_at':now})
        digest=_sha(body)
        self.db.execute('INSERT INTO graph_events(event_id,tenant_id,project_id,object_id,object_type,object_version,event_type,payload_sha256,previous_event_sha256,event_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,tenant,project,obj_id,obj_type,version,event_type,payload_sha,prev,digest,now))
        return digest
    def create(self,tenant,project_id,obj_type,payload,obj_id=None):
        if obj_type not in OBJECT_TYPES: raise GraphError('unknown object type')
        obj_id=obj_id or _id(obj_type[:3]); now=_now(); raw=_json(payload); ph=_sha(raw)
        with self.db:
            self.db.execute('INSERT INTO graph_objects VALUES(?,?,?,?,?,?,?,?,?,?)',(obj_id,tenant,project_id,obj_type,1,raw,ph,0,now,now))
            self._event(tenant,project_id,obj_id,obj_type,1,'created',ph)
        return obj_id
    def update(self,tenant,obj_id,payload,expected_version):
        row=self.db.execute('SELECT * FROM graph_objects WHERE id=? AND tenant_id=? AND deleted=0',(obj_id,tenant)).fetchone()
        if not row: raise TenantIsolationError('object not accessible')
        if row['version']!=expected_version: raise GraphError('version conflict')
        version=expected_version+1; raw=_json(payload); ph=_sha(raw); now=_now()
        with self.db:
            self.db.execute('UPDATE graph_objects SET version=?,payload_json=?,payload_sha256=?,updated_at=? WHERE id=? AND tenant_id=?',(version,raw,ph,now,obj_id,tenant))
            self._event(tenant,row['project_id'],obj_id,row['object_type'],version,'updated',ph)
        return version
    def get(self,tenant,obj_id):
        row=self.db.execute('SELECT * FROM graph_objects WHERE id=? AND tenant_id=? AND deleted=0',(obj_id,tenant)).fetchone()
        if not row: raise TenantIsolationError('object not accessible')
        d=dict(row); d['payload']=json.loads(d.pop('payload_json')); return d
    def list_project(self,tenant,project_id):
        rows=self.db.execute('SELECT * FROM graph_objects WHERE tenant_id=? AND project_id=? AND deleted=0 ORDER BY object_type,id',(tenant,project_id)).fetchall()
        out=[]
        for row in rows:
            d=dict(row); d['payload']=json.loads(d.pop('payload_json')); out.append(d)
        return out
    def sync(self,tenant,project_id,after_seq=0):
        rows=self.db.execute('SELECT * FROM graph_events WHERE tenant_id=? AND project_id=? AND seq>? ORDER BY seq',(tenant,project_id,int(after_seq))).fetchall()
        events=[dict(r) for r in rows]
        return {'events':events,'cursor':events[-1]['seq'] if events else int(after_seq)}
    def verify_provenance(self,tenant,project_id):
        rows=self.db.execute('SELECT * FROM graph_events WHERE tenant_id=? AND project_id=? ORDER BY seq',(tenant,project_id)).fetchall(); prev=None
        for r in rows:
            if r['previous_event_sha256']!=prev: return False
            body=_json({'event_id':r['event_id'],'tenant_id':r['tenant_id'],'project_id':r['project_id'],'object_id':r['object_id'],'object_type':r['object_type'],'object_version':r['object_version'],'event_type':r['event_type'],'payload_sha256':r['payload_sha256'],'previous_event_sha256':r['previous_event_sha256'],'created_at':r['created_at']})
            if _sha(body)!=r['event_sha256']: return False
            prev=r['event_sha256']
        return True
    def import_local(self,tenant,source_store,rows):
        mapped=[]
        for row in rows:
            source_id=str(row['id']); payload=row['payload']; project_id=str(row['project_id']); obj_type=str(row['object_type'])
            digest=_sha(_json({'project_id':project_id,'object_type':obj_type,'payload':payload}))
            old=self.db.execute('SELECT * FROM import_keys WHERE tenant_id=? AND source_store=? AND source_object_id=?',(tenant,source_store,source_id)).fetchone()
            if old:
                if old['imported_sha256']!=digest: raise GraphError('import conflict')
                mapped.append(old['object_id']); continue
            obj_id=self.create(tenant,project_id,obj_type,payload)
            with self.db:self.db.execute('INSERT INTO import_keys VALUES(?,?,?,?,?,?)',(tenant,source_store,source_id,obj_id,digest,_now()))
            mapped.append(obj_id)
        return mapped

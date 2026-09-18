from __future__ import annotations
import ast, hashlib, hmac, json, secrets, sqlite3, time, uuid
from dataclasses import dataclass
from pathlib import Path

SCHEMA=''' 
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(organization_id TEXT NOT NULL REFERENCES organizations(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(organization_id,user_id));
CREATE TABLE IF NOT EXISTS entitlements(organization_id TEXT NOT NULL REFERENCES organizations(id),capability TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(organization_id,capability));
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),created_by TEXT NOT NULL REFERENCES users(id),secret_hash TEXT UNIQUE NOT NULL,key_prefix TEXT NOT NULL,label TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS oauth_links(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,external_subject TEXT NOT NULL,scope TEXT NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER,UNIQUE(provider,external_subject));
CREATE TABLE IF NOT EXISTS recovery_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),created_by TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS safe_task_receipts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),operation TEXT NOT NULL,input_sha256 TEXT NOT NULL,output_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,organization_id TEXT,actor_user_id TEXT,event_type TEXT NOT NULL,subject_type TEXT NOT NULL,subject_id TEXT NOT NULL,details_json TEXT NOT NULL,created_at INTEGER NOT NULL);
'''
ENTITLEMENTS=('axiom.project.create','axiom.safe_task.execute','axiom.oauth.link','axiom.key.manage')
class IdentityError(RuntimeError): pass
class AuthenticationError(IdentityError): pass
class AuthorizationError(IdentityError): pass
@dataclass(frozen=True)
class SessionContext: session_id:str; user_id:str; organization_id:str; role:str

def _now(): return int(time.time())
def _id(p): return f'{p}_{uuid.uuid4().hex}'
def _sha(v): return hashlib.sha256(v.encode()).hexdigest()
def _json(v): return json.dumps(v,sort_keys=True,separators=(',',':'))
def _pwh(password,salt):
    if len(password)<12: raise IdentityError('password must be at least 12 characters')
    return hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=2**14,r=8,p=1,dklen=32).hex()

class _Math(ast.NodeVisitor):
    BIN={ast.Add:lambda a,b:a+b,ast.Sub:lambda a,b:a-b,ast.Mult:lambda a,b:a*b,ast.Div:lambda a,b:a/b}
    UNA={ast.UAdd:lambda a:+a,ast.USub:lambda a:-a}
    def visit_Expression(self,n): return self.visit(n.body)
    def visit_Constant(self,n):
        if isinstance(n.value,bool) or not isinstance(n.value,(int,float)): raise AuthorizationError('unsupported literal')
        return n.value
    def visit_BinOp(self,n):
        fn=self.BIN.get(type(n.op))
        if not fn: raise AuthorizationError('unsupported operator')
        return fn(self.visit(n.left),self.visit(n.right))
    def visit_UnaryOp(self,n):
        fn=self.UNA.get(type(n.op))
        if not fn: raise AuthorizationError('unsupported unary operator')
        return fn(self.visit(n.operand))
    def generic_visit(self,n): raise AuthorizationError('unsupported expression')

def safe_arithmetic(expr):
    if not isinstance(expr,str) or not expr or len(expr)>200: raise AuthorizationError('invalid expression')
    return _Math().visit(ast.parse(expr,mode='eval'))

class IdentityAuthority:
    def __init__(self,path):
        self.path=Path(path); self.path.parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(self.path); self.db.row_factory=sqlite3.Row; self.db.execute('PRAGMA foreign_keys=ON'); self.db.executescript(SCHEMA); self.db.commit()
    def close(self): self.db.close()
    def _audit(self,event,kind,sid,org=None,actor=None,details=None):
        self.db.execute('INSERT INTO audit_events(event_id,organization_id,actor_user_id,event_type,subject_type,subject_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)',(_id('evt'),org,actor,event,kind,sid,_json(details or {}),_now()))
    def signup(self,email,password,organization_name):
        email=(email or '').strip().lower(); organization_name=(organization_name or '').strip()
        if '@' not in email or not organization_name: raise IdentityError('invalid signup input')
        now=_now(); salt=secrets.token_hex(16); uid,oid,pid=_id('usr'),_id('org'),_id('prj')
        try:
            with self.db:
                self.db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?)',(uid,email,_pwh(password,salt),salt,'active',now,now))
                self.db.execute('INSERT INTO organizations VALUES(?,?,?,?)',(oid,organization_name,uid,now))
                self.db.execute('INSERT INTO memberships VALUES(?,?,?,?,?)',(oid,uid,'owner','active',now))
                for cap in ENTITLEMENTS:self.db.execute('INSERT INTO entitlements VALUES(?,?,?,?)',(oid,cap,'active',now))
                self.db.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',(pid,oid,uid,'My first AXIOM project',now,now))
                self._audit('identity.signup','user',uid,oid,uid,{'email_sha256':_sha(email)})
                self._audit('organization.created','organization',oid,oid,uid,{'role':'owner'})
                self._audit('project.created','project',pid,oid,uid,{'automatic':True})
        except sqlite3.IntegrityError as e: raise IdentityError('account already exists or violates identity constraints') from e
        return {'user_id':uid,'organization_id':oid,'role':'owner','project_id':pid,'entitlements':list(ENTITLEMENTS)}
    def login(self,email,password,ttl_seconds=3600):
        row=self.db.execute('SELECT * FROM users WHERE email=?',((email or '').strip().lower(),)).fetchone()
        if not row or row['status']!='active': raise AuthenticationError('invalid credentials')
        try: candidate=_pwh(password,row['password_salt'])
        except IdentityError: raise AuthenticationError('invalid credentials')
        if not hmac.compare_digest(candidate,row['password_hash']): raise AuthenticationError('invalid credentials')
        mem=self.db.execute("SELECT * FROM memberships WHERE user_id=? AND status='active' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1",(row['id'],)).fetchone()
        if not mem: raise AuthorizationError('no active organization membership')
        raw=secrets.token_urlsafe(32); sid=_id('ses'); now=_now()
        with self.db:
            self.db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,NULL)',(sid,row['id'],_sha(raw),now,now+max(60,int(ttl_seconds))))
            self._audit('identity.login','session',sid,mem['organization_id'],row['id'],{'ttl_seconds':max(60,int(ttl_seconds))})
        return {'session_token':raw,'session_id':sid,'user_id':row['id'],'organization_id':mem['organization_id'],'role':mem['role']}
    def authenticate(self,token):
        row=self.db.execute("SELECT s.id,s.user_id,m.organization_id,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active' AND m.status='active' ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1",(_sha(token),_now())).fetchone()
        if not row: raise AuthenticationError('session invalid or expired')
        return SessionContext(row['id'],row['user_id'],row['organization_id'],row['role'])
    def _entitled(self,org,cap):
        if not self.db.execute("SELECT 1 FROM entitlements WHERE organization_id=? AND capability=? AND status='active'",(org,cap)).fetchone(): raise AuthorizationError(f'missing entitlement: {cap}')
    def list_projects(self,token):
        c=self.authenticate(token); return [dict(r) for r in self.db.execute('SELECT id,name,created_at,updated_at FROM projects WHERE organization_id=? ORDER BY created_at,id',(c.organization_id,)).fetchall()]
    def issue_api_key(self,token,label):
        c=self.authenticate(token); self._entitled(c.organization_id,'axiom.key.manage')
        if c.role not in {'owner','admin'}: raise AuthorizationError('role cannot manage keys')
        secret='axk_'+secrets.token_urlsafe(32); kid=_id('key'); prefix=secret[:12]; now=_now()
        with self.db:
            self.db.execute("INSERT INTO api_keys VALUES(?,?,?,?,?,?,'active',?,NULL)",(kid,c.organization_id,c.user_id,_sha(secret),prefix,label,now))
            self._audit('key.issued','api_key',kid,c.organization_id,c.user_id,{'label':label,'prefix':prefix})
        return {'key_id':kid,'key_prefix':prefix,'secret_once':secret}
    def link_oauth(self,token,provider,external_subject,scope='axiom.execute'):
        c=self.authenticate(token); self._entitled(c.organization_id,'axiom.oauth.link'); lid=_id('oln'); now=_now()
        with self.db:
            self.db.execute('INSERT INTO oauth_links VALUES(?,?,?,?,?,?,NULL)',(lid,c.user_id,provider,external_subject,scope,now))
            self._audit('oauth.linked','oauth_link',lid,c.organization_id,c.user_id,{'provider':provider,'scope':scope})
        return {'link_id':lid,'provider':provider,'scope':scope}
    def request_recovery(self,email,ttl_seconds=900):
        row=self.db.execute("SELECT id FROM users WHERE email=? AND status='active'",((email or '').strip().lower(),)).fetchone(); rid=_id('rec')
        if not row:return {'recovery_request_id':rid,'token_once':''}
        token=secrets.token_urlsafe(32); now=_now(); mem=self.db.execute("SELECT organization_id FROM memberships WHERE user_id=? AND status='active' LIMIT 1",(row['id'],)).fetchone()
        with self.db:
            self.db.execute('INSERT INTO recovery_tokens VALUES(?,?,?,?,?,NULL)',(rid,row['id'],_sha(token),now,now+max(60,int(ttl_seconds))))
            self._audit('identity.recovery_requested','user',row['id'],mem['organization_id'] if mem else None,row['id'])
        return {'recovery_request_id':rid,'token_once':token}
    def complete_recovery(self,token,new_password):
        row=self.db.execute('SELECT * FROM recovery_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?',(_sha(token),_now())).fetchone()
        if not row: raise AuthenticationError('invalid or expired recovery token')
        salt=secrets.token_hex(16); now=_now(); mem=self.db.execute("SELECT organization_id FROM memberships WHERE user_id=? AND status='active' LIMIT 1",(row['user_id'],)).fetchone()
        with self.db:
            self.db.execute('UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?',(_pwh(new_password,salt),salt,now,row['user_id']))
            self.db.execute('UPDATE recovery_tokens SET used_at=? WHERE id=?',(now,row['id']))
            self.db.execute('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',(now,row['user_id']))
            self._audit('identity.recovered','user',row['user_id'],mem['organization_id'] if mem else None,row['user_id'],{'sessions_revoked':True})
    def audit_history(self,token,limit=100):
        c=self.authenticate(token); rows=self.db.execute('SELECT seq,event_id,event_type,subject_type,subject_id,details_json,created_at FROM audit_events WHERE organization_id=? ORDER BY seq DESC LIMIT ?',(c.organization_id,max(1,min(500,int(limit))))).fetchall(); return [{**dict(r),'details':json.loads(r['details_json'])} for r in rows]
    def execute_safe_task(self,token,project_id,operation,args):
        c=self.authenticate(token); self._entitled(c.organization_id,'axiom.safe_task.execute')
        if not self.db.execute('SELECT 1 FROM projects WHERE id=? AND organization_id=?',(project_id,c.organization_id)).fetchone(): raise AuthorizationError('project not accessible')
        if operation!='arithmetic.evaluate': raise AuthorizationError('only S0 arithmetic.evaluate is admitted in AR-03 foundation')
        expression=str((args or {}).get('expression','')); result=safe_arithmetic(expression); rid=_id('rcp'); now=_now(); out={'result':result,'risk_class':'S0','verified':True}
        with self.db:
            self.db.execute('INSERT INTO safe_task_receipts VALUES(?,?,?,?,?,?,?)',(rid,project_id,c.user_id,operation,_sha(_json({'operation':operation,'args':{'expression':expression}})),_json(out),now))
            self._audit('task.executed','safe_task_receipt',rid,c.organization_id,c.user_id,{'project_id':project_id,'operation':operation,'risk_class':'S0'})
        return {'receipt_id':rid,'project_id':project_id,'operation':operation,**out}

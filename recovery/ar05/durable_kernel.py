from __future__ import annotations
import ast, json, sqlite3, time, uuid
from pathlib import Path

class KernelError(RuntimeError): pass
class TransientToolError(KernelError): pass

def _id(p): return f'{p}_{uuid.uuid4().hex}'
def _now(): return int(time.time())
def _json(v): return json.dumps(v,sort_keys=True,separators=(',',':'))

SCHEMA=''' 
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,state TEXT NOT NULL,budget_max INTEGER NOT NULL,budget_used INTEGER NOT NULL DEFAULT 0,cancel_requested INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS steps(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,operation TEXT NOT NULL,args_json TEXT NOT NULL,risk_class TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,idempotency_key TEXT NOT NULL,cost_units INTEGER NOT NULL,last_error TEXT,output_json TEXT,requires_approval INTEGER NOT NULL DEFAULT 0,UNIQUE(task_id,ordinal),UNIQUE(task_id,idempotency_key));
CREATE TABLE IF NOT EXISTS approvals(task_id TEXT NOT NULL,step_id TEXT NOT NULL,actor_id TEXT NOT NULL,decision TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(task_id,step_id,actor_id));
CREATE TABLE IF NOT EXISTS task_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,task_id TEXT NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tool_receipts(task_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,operation TEXT NOT NULL,output_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(task_id,idempotency_key));
CREATE TABLE IF NOT EXISTS side_effects(effect_key TEXT PRIMARY KEY,value INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS injection_once(task_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,injection TEXT NOT NULL,consumed_at INTEGER NOT NULL,PRIMARY KEY(task_id,idempotency_key,injection));
'''

class _Math(ast.NodeVisitor):
    BIN={ast.Add:lambda a,b:a+b,ast.Sub:lambda a,b:a-b,ast.Mult:lambda a,b:a*b,ast.Div:lambda a,b:a/b}
    def visit_Expression(self,n): return self.visit(n.body)
    def visit_Constant(self,n):
        if isinstance(n.value,bool) or not isinstance(n.value,(int,float)): raise KernelError('bad literal')
        return n.value
    def visit_BinOp(self,n):
        fn=self.BIN.get(type(n.op))
        if not fn: raise KernelError('bad operator')
        return fn(self.visit(n.left),self.visit(n.right))
    def generic_visit(self,n): raise KernelError('bad expression')

def arithmetic(expr): return _Math().visit(ast.parse(str(expr),mode='eval'))

class DurableKernel:
    def __init__(self,path):
        self.path=Path(path); self.path.parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(self.path); self.db.row_factory=sqlite3.Row; self.db.executescript(SCHEMA); self.db.commit()
    def close(self): self.db.close()
    def _event(self,task_id,event_type,payload=None):
        self.db.execute('INSERT INTO task_events VALUES(NULL,?,?,?,?,?)',(_id('tev'),task_id,event_type,_json(payload or {}),_now()))
    def create_task(self,tenant_id,project_id,plan,budget_max=100):
        if not plan: raise KernelError('empty plan')
        task=_id('tsk'); now=_now()
        with self.db:
            self.db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,0,0,?,?)',(task,tenant_id,project_id,'PLANNED',int(budget_max),now,now))
            for i,s in enumerate(plan):
                step=_id('stp'); risk=str(s.get('risk_class','S0')).upper(); cost=max(0,int(s.get('cost_units',1))); idem=str(s.get('idempotency_key') or f'{task}:{i}:{s["operation"]}')
                req=1 if s.get('requires_approval') or risk in {'S3','S4','S5'} else 0
                self.db.execute('INSERT INTO steps VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?)',(step,task,i,s['operation'],_json(s.get('args',{})),risk,'PENDING',idem,cost,None,None,req))
            self._event(task,'task.created',{'step_count':len(plan),'budget_max':int(budget_max)})
        return task
    def request_cancel(self,task_id):
        with self.db:
            self.db.execute('UPDATE tasks SET cancel_requested=1,updated_at=? WHERE id=?',(_now(),task_id))
            self._event(task_id,'task.cancel_requested')
    def approve(self,task_id,step_id,actor_id):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO approvals VALUES(?,?,?,'APPROVED',?)",(task_id,step_id,actor_id,_now()))
            self._event(task_id,'step.approved',{'step_id':step_id,'actor_id':actor_id})
    def events(self,task_id,after_seq=0):
        return [dict(r) for r in self.db.execute('SELECT * FROM task_events WHERE task_id=? AND seq>? ORDER BY seq',(task_id,int(after_seq))).fetchall()]
    def status(self,task_id):
        t=self.db.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
        if not t: raise KernelError('task not found')
        steps=[dict(r) for r in self.db.execute('SELECT * FROM steps WHERE task_id=? ORDER BY ordinal',(task_id,)).fetchall()]
        return {'task':dict(t),'steps':steps}
    def _consume_injection(self,task_id,idem,name):
        try:
            self.db.execute('INSERT INTO injection_once VALUES(?,?,?,?)',(task_id,idem,name,_now()))
            return False
        except sqlite3.IntegrityError:
            return True
    def _execute(self,task_id,step):
        existing=self.db.execute('SELECT output_json FROM tool_receipts WHERE task_id=? AND idempotency_key=?',(task_id,step['idempotency_key'])).fetchone()
        if existing:
            return json.loads(existing['output_json'])
        args=json.loads(step['args_json']); op=step['operation']; idem=step['idempotency_key']
        if op=='tool.timeout_once' and not self._consume_injection(task_id,idem,'timeout'):
            self.db.commit()
            raise TransientToolError('injected timeout')
        if op=='arithmetic.evaluate':
            out={'result':arithmetic(args.get('expression',''))}
        elif op=='side_effect.increment':
            key=str(args['effect_key']); row=self.db.execute('SELECT value FROM side_effects WHERE effect_key=?',(key,)).fetchone(); now=_now()
            if row:
                value=row['value']
            else:
                value=1
                self.db.execute('INSERT INTO side_effects VALUES(?,?,?,?)',(key,value,now,now))
            out={'effect_key':key,'value':value}
            self.db.execute('INSERT INTO tool_receipts VALUES(?,?,?,?,?)',(task_id,idem,op,_json(out),now))
            if args.get('fail_after_commit_once') and not self._consume_injection(task_id,idem,'after_commit'):
                self.db.commit()
                raise TransientToolError('injected post-commit transient failure')
            return out
        elif op=='tool.timeout_once':
            out={'recovered':True}
        else:
            raise KernelError('unknown operation')
        self.db.execute('INSERT INTO tool_receipts VALUES(?,?,?,?,?)',(task_id,idem,op,_json(out),_now()))
        return out
    def run(self,task_id,max_steps=None):
        executed=0
        while max_steps is None or executed<max_steps:
            task=self.db.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
            if not task: raise KernelError('task not found')
            if task['cancel_requested']:
                with self.db:
                    self.db.execute("UPDATE tasks SET state='CANCELLED',updated_at=? WHERE id=?",(_now(),task_id))
                    self._event(task_id,'task.cancelled')
                return 'CANCELLED'
            step=self.db.execute("SELECT * FROM steps WHERE task_id=? AND status!='SUCCEEDED' ORDER BY ordinal LIMIT 1",(task_id,)).fetchone()
            if not step:
                with self.db:
                    self.db.execute("UPDATE tasks SET state='SUCCEEDED',updated_at=? WHERE id=?",(_now(),task_id))
                    self._event(task_id,'task.succeeded')
                return 'SUCCEEDED'
            if step['requires_approval']:
                ok=self.db.execute("SELECT 1 FROM approvals WHERE task_id=? AND step_id=? AND decision='APPROVED' LIMIT 1",(task_id,step['id'])).fetchone()
                if not ok:
                    with self.db:
                        self.db.execute("UPDATE tasks SET state='AWAITING_APPROVAL',updated_at=? WHERE id=?",(_now(),task_id))
                        self._event(task_id,'task.awaiting_approval',{'step_id':step['id'],'risk_class':step['risk_class']})
                    return 'AWAITING_APPROVAL'
            if task['budget_used']+step['cost_units']>task['budget_max']:
                with self.db:
                    self.db.execute("UPDATE tasks SET state='BUDGET_EXHAUSTED',updated_at=? WHERE id=?",(_now(),task_id))
                    self._event(task_id,'task.budget_exhausted',{'step_id':step['id']})
                return 'BUDGET_EXHAUSTED'
            try:
                with self.db:
                    self.db.execute("UPDATE steps SET status='RUNNING',attempts=attempts+1,last_error=NULL WHERE id=?",(step['id'],))
                    self.db.execute("UPDATE tasks SET state='RUNNING',updated_at=? WHERE id=?",(_now(),task_id))
                    out=self._execute(task_id,step)
                    self.db.execute("UPDATE steps SET status='SUCCEEDED',output_json=? WHERE id=?",(_json(out),step['id']))
                    self.db.execute('UPDATE tasks SET budget_used=budget_used+?,updated_at=? WHERE id=?',(step['cost_units'],_now(),task_id))
                    self._event(task_id,'step.succeeded',{'step_id':step['id'],'operation':step['operation']})
                executed+=1
            except TransientToolError as e:
                with self.db:
                    self.db.execute("UPDATE steps SET status='RETRYABLE',last_error=? WHERE id=?",(str(e),step['id']))
                    self.db.execute("UPDATE tasks SET state='RETRYABLE',updated_at=? WHERE id=?",(_now(),task_id))
                    self._event(task_id,'step.transient_failure',{'step_id':step['id'],'error':str(e)})
                return 'RETRYABLE'
        return self.status(task_id)['task']['state']

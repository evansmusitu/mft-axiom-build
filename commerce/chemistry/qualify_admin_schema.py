#!/usr/bin/env python3
import hashlib,json,re,sqlite3
from pathlib import Path

SCHEMA=Path('commerce/chemistry/admin_schema_v1.sql')
REQUIRED={'chemistry_admin_schema','chemistry_admin_users','chemistry_customers','chemistry_customer_orders','chemistry_cash_sessions','chemistry_payments','chemistry_receipts','chemistry_support_notes','chemistry_device_events','chemistry_adjustments','chemistry_access_controls','chemistry_admin_audit'}
BASE=['chemistry_orders','chemistry_seats','chemistry_provider_events','chemistry_field_aggregate']

def main():
    sql=SCHEMA.read_text()
    for pat in [r'\bDROP\b',r'\bALTER\b',r'\bDELETE\b',r'\bUPDATE\b',r'\bTRUNCATE\b']:
        if re.search(pat,sql,re.I):raise SystemExit('destructive migration token '+pat)
    con=sqlite3.connect(':memory:')
    con.executescript('''
CREATE TABLE chemistry_orders(reference TEXT PRIMARY KEY,client_secret_sha256 TEXT NOT NULL,plan TEXT NOT NULL,holder TEXT NOT NULL,email TEXT,seats INTEGER NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,browser_url TEXT,poll_url TEXT,paynow_reference TEXT,licence_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,paid_at TEXT);
CREATE TABLE chemistry_seats(reference TEXT NOT NULL,seat_no INTEGER NOT NULL,device_id TEXT,licence_token TEXT,issued_at TEXT,PRIMARY KEY(reference,seat_no));
CREATE TABLE chemistry_provider_events(provider TEXT NOT NULL,digest TEXT NOT NULL,reference TEXT,received_at TEXT NOT NULL,processed_at TEXT,outcome TEXT,PRIMARY KEY(provider,digest));
CREATE TABLE chemistry_field_aggregate(day TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,route TEXT NOT NULL,detail TEXT NOT NULL,viewport TEXT NOT NULL,bucket TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,kind,name,route,detail,viewport,bucket));
''')
    before={t:con.execute(f'PRAGMA table_info({t})').fetchall() for t in BASE}
    con.executescript(sql);con.executescript(sql)
    after={t:con.execute(f'PRAGMA table_info({t})').fetchall() for t in BASE}
    if before!=after:raise SystemExit('baseline Commerce schema changed')
    tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if REQUIRED-tables:raise SystemExit('missing admin tables '+repr(sorted(REQUIRED-tables)))
    if con.execute('SELECT version FROM chemistry_admin_schema').fetchall()!=[(1,)]:raise SystemExit('schema version mismatch')
    idx={r[1]:r for r in con.execute("PRAGMA index_list(chemistry_admin_audit)").fetchall()}
    if 'idx_chem_admin_audit_prev_hash' not in idx or int(idx['idx_chem_admin_audit_prev_hash'][2])!=1:raise SystemExit('unique audit prev-hash index missing')
    try:
        con.execute("INSERT INTO chemistry_cash_sessions(session_id,cashier_id,currency,opening_cents,status,opened_at) VALUES('x','a','ZWG',0,'open','now')");raise SystemExit('ZWG accepted')
    except sqlite3.IntegrityError:pass
    con.execute("INSERT INTO chemistry_admin_audit(event_id,actor_id,actor_role,action,target_type,target_id,request_id,prev_hash,event_hash,created_at) VALUES('e1','owner','owner','test','system','1','r1','GENESIS','h1','t1')")
    try:
        con.execute("INSERT INTO chemistry_admin_audit(event_id,actor_id,actor_role,action,target_type,target_id,request_id,prev_hash,event_hash,created_at) VALUES('e2','owner','owner','test','system','2','r2','GENESIS','h2','t2')");raise SystemExit('audit fork accepted')
    except sqlite3.IntegrityError:pass
    con.execute("INSERT INTO chemistry_admin_audit(event_id,actor_id,actor_role,action,target_type,target_id,request_id,prev_hash,event_hash,created_at) VALUES('e3','owner','owner','test','system','3','r3','h1','h3','t3')")
    report={'schema':'musitu.chemistry.admin.schema_qualification.v3','result':'PASS','schema_sha256':hashlib.sha256(sql.encode()).hexdigest(),'idempotent':True,'baseline_tables_unchanged':True,'required_admin_tables':sorted(REQUIRED),'usd_cash_enforced':True,'audit_fork_rejected':True,'production_mutation':False}
    out=Path('evidence-out');out.mkdir(exist_ok=True);(out/'schema.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps(report,sort_keys=True));print('MUSITU_ADMIN_SCHEMA_V3=PASS')
if __name__=='__main__':main()

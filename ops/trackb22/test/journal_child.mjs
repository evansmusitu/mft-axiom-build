// Process-level S0 test harness, never a production broker.
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {DurableDispatchJournal} from '../src/journal.mjs';
const file=process.env.B22_SQLITE_PATH,barrier=process.env.B22_START_FILE;
if(!file||!barrier)throw Error('B22_TEST_FILE_MISSING');
const db=new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=5000');
const storage={sql:{exec(sql,...params){let s=db.prepare(sql);const rows=sql.trimStart().startsWith('SELECT')?s.all(...params):(s.run(...params),[]);return {toArray:()=>rows};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e;}}};
const j=new DurableDispatchJournal(storage,{accountId:'axiom-s0-isolated',utcDay:'2026-10-13',now:()=>Date.parse('2026-10-13T15:00:00Z')});
const doc={account_id:'axiom-s0-isolated',utc_day:'2026-10-13',request_id:'concurrent-unique',tenant_id:'tenant-A',workload_id:'agent-a',body_sha:'a'.repeat(64),quota_grant_id:'grant-A'};
console.log('B22_CHILD_READY');
while(!existsSync(barrier)){await new Promise(r=>setTimeout(r,10));}
const issued=j.begin(doc);
console.log('B22_CHILD_RECEIPT='+JSON.stringify(issued));
if(process.env.B22_TERMINATE_AFTER_COMMIT==='1'&&issued.send_allowed){process.kill(process.pid,'SIGKILL');}
db.close();

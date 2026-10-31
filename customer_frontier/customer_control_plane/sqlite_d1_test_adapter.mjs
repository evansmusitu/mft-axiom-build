// Offline SQLite D1 test double. Not suitable for Cloudflare production deployment.
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
export function openTestDB(sqlFile){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(sqlFile,'utf8'));
 const prepare=(sql)=>{let ps=[];const statement=sqlite.prepare(sql);const self={bind:(...p)=>{ps=p;return self;},first:async()=>statement.get(...ps)??null,all:async()=>({results:statement.all(...ps)}),run:async()=>({meta:{changes:statement.run(...ps).changes}}),_stmt:statement,_args:()=>ps};return self;};
 return {prepare,batch:async(statements)=>{sqlite.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>({meta:{changes:s._stmt.run(...s._args()).changes}}));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},_sqlite:sqlite,close:()=>sqlite.close()};
}

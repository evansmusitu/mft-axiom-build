import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {ENTERPRISE_SCHEMA_1,ENTERPRISE_SCHEMA_2} from '../../edge/src/v03_do_schema.mjs';
const patch=new URL('../../edge/migrations/v03/0003_OPTIONAL_terminal_immutability.sql',import.meta.url);
function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 db.exec(ENTERPRISE_SCHEMA_1);db.exec(ENTERPRISE_SCHEMA_2);
 db.exec(readFileSync(patch,'utf8'));
 db.exec("INSERT INTO projects(id,title,owner_sub,created_at) VALUES('p','p','owner','2026-10-22')");
 for(const id of ['completed','failed','active'])db.prepare('INSERT INTO jobs(id,project_id,submission_key,payload_json,payload_sha256,render_device,state,created_by_sub,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'p','key-'+id,'{"scene":"synthetic_cube","detail":"test"}','a'.repeat(64),'CPU','RUNNING','owner','2026-10-22');
 for(const [i,f]of ['scene.blend','scene.glb','preview.png'].entries())db.prepare('INSERT INTO assets(job_id,filename,object_key,sha256,bytes) VALUES(?,?,?,?,?)').run('completed',f,'synthetic/completed/'+f,String(i+1).repeat(64),1024);
 db.exec("UPDATE jobs SET state='COMPLETED' WHERE id='completed'");
 db.exec("UPDATE jobs SET state='FAILED' WHERE id='failed'");
 return db;
}
test('staging-only SQLite v3 denies completed metadata modification',()=>{
 const d=setup();try{assert.throws(()=>d.exec("UPDATE jobs SET error_code='forged' WHERE id='completed'"),/TERMINAL_JOB_IMMUTABLE/);
 assert.equal(d.prepare("SELECT error_code FROM jobs WHERE id='completed'").get().error_code,null)}finally{d.close()}
});
test('staging-only SQLite v3 denies failed metadata modification',()=>{
 const d=setup();try{assert.throws(()=>d.exec("UPDATE jobs SET error_code='forged' WHERE id='failed'"),/TERMINAL_JOB_IMMUTABLE/);
 assert.equal(d.prepare("SELECT error_code FROM jobs WHERE id='failed'").get().error_code,null)}finally{d.close()}
});
test('staging-only SQLite v3 blocks completed asset reassignment',()=>{
 const d=setup();try{assert.throws(()=>d.exec("UPDATE assets SET job_id='active' WHERE job_id='completed'"),/ASSET_JOB_REASSIGNMENT_DENIED|COMPLETED_ASSET_IMMUTABLE/);
 assert.equal(d.prepare("SELECT COUNT(*) AS n FROM assets WHERE job_id='completed'").get().n,3)}finally{d.close()}
});
test('staging-only SQLite v3 blocks reassignment between active jobs',()=>{
 const d=setup();try{d.prepare('INSERT INTO assets(job_id,filename,object_key,sha256,bytes) VALUES(?,?,?,?,?)').run('active','scene.blend','synthetic/active/scene.blend','b'.repeat(64),1024);
 assert.throws(()=>d.exec("UPDATE assets SET job_id='failed' WHERE job_id='active'"),/ASSET_JOB_REASSIGNMENT_DENIED/)}finally{d.close()}
});
test('staging-only SQLite v3 remains idempotent',()=>{
 const d=setup();try{d.exec(readFileSync(patch,'utf8'));assert.throws(()=>d.exec("DELETE FROM assets WHERE job_id='completed'"),/COMPLETED_ASSET_IMMUTABLE/)}finally{d.close()}
});

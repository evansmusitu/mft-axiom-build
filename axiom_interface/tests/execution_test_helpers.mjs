import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {sha256Json} from '../vnext/execution_integrity.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';

export function sqliteD1(file=':memory:'){
  const connection=new DatabaseSync(file);
  return {connection,exec(sql){connection.exec(sql);},prepare(sql){return {bind(...args){const q=connection.prepare(sql);return {run:async()=>({success:true,meta:{changes:Number(q.run(...args).changes)}}),first:async()=>q.get(...args)??null,all:async()=>({results:q.all(...args)}),_run:()=>({success:true,meta:{changes:Number(q.run(...args).changes)}})};}};},async batch(statements){connection.exec('BEGIN IMMEDIATE');try{const rows=statements.map(s=>s._run());connection.exec('COMMIT');return rows;}catch(e){connection.exec('ROLLBACK');throw e;}}};
}
export function applyExecutionSchema(db){db.exec(fs.readFileSync(new URL('../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8'));return db;}
export async function admittedTaskFixture(args){
  const db=applyExecutionSchema(sqliteD1());
  const gate=createD1ExecutionGovernance({db,customer:args.customer,now:args.now});
  const binding=await gate.admit({objective:args.objective,context:{project_id:'project-fixture',work_id:'work-fixture',controls:{privacy:'Project',budget:1}}});
  const callbacks=args.store;
  const governance={...binding};
  for(const name of ['create','complete','fail'])governance[name]=async value=>{const result=await binding[name](value);await callbacks?.[name]?.(value);return result;};
  const runtime={...args.runtime,execute:async input=>{
    const value=await args.runtime.execute(input);
    if(value?.http_status===200){const envelope={result:value.result};value.committed_response=envelope;value.receipt={...value.receipt,result_sha256:await sha256Json(envelope)};}
    return value;
  }};
  return {...args,runtime,governance,store:governance};
}

#!/usr/bin/env node
/** Local, read-only, no credentials, no network. Never alters mail. */
import {readFileSync} from 'node:fs';
import {assessPhase1CommercialReadiness} from './readiness.mjs';
try{
 if(process.argv.length>3)throw Error('EXPECTED_ZERO_OR_ONE_EVIDENCE_FILE');
 const path=process.argv[2];
 let proof={};
 if(path){
  const {statSync}=await import('node:fs');
  if(statSync(path).size>30000)throw Error('EVIDENCE_FILE_TOO_LARGE');
  const body=JSON.parse(readFileSync(path,'utf8'));
  if(!body||body.schema!=='mmf-phase1-evidence-v1'||!body.gates||
     Object.keys(body).length!==2)throw Error('INVALID_EVIDENCE_FILE');
  proof=body.gates;
 }
 const report=assessPhase1CommercialReadiness(proof);
 console.log(JSON.stringify(report,null,2));
 // BLOCKED is the expected starting position, but an operational CI gate
 // can use this nonzero code to refuse an unqualified launch.
 process.exitCode=report.liveDelivery.status==='BLOCKED'?2:0;
}catch{
 console.error('MMF_PHASE1_EVIDENCE_INVALID');
 process.exitCode=3;
}

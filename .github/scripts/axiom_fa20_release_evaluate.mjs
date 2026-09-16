#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  runIndependentReleaseControlVerification,
  runReleaseControlQualification,
  verifyIndependentReleaseControlAttestation,
  verifyReleaseControlEvidence,
} from '../../axiom_interface/vnext/fa20_release_orchestrator.mjs';

const args=new Map();
for(let index=2;index<process.argv.length;index+=2){
  const key=process.argv[index],value=process.argv[index+1];
  if(!key?.startsWith('--')||value===undefined)throw new TypeError('arguments must be --key value pairs');
  args.set(key.slice(2),value);
}
const required=name=>{const value=args.get(name);if(!value)throw new TypeError(`--${name} required`);return value;};
const role=required('role'),candidateCommit=required('candidate-commit'),output=path.resolve(required('output'));
fs.mkdirSync(path.dirname(output),{recursive:true});

let evidence;
if(role==='builder'){
  evidence=await runReleaseControlQualification({candidateCommit,builderIdentity:'axiom-fa20-release-builder'});
  if(!await verifyReleaseControlEvidence(evidence))throw new Error('FA-20 release-control evidence self-integrity check failed');
}else if(role==='verifier'){
  const builderEvidence=JSON.parse(fs.readFileSync(path.resolve(required('builder-evidence')),'utf8'));
  if(builderEvidence.candidate_commit!==candidateCommit)throw new Error('builder evidence candidate commit mismatch');
  evidence=await runIndependentReleaseControlVerification({builderEvidence,verifierIdentity:'github-actions-independent-fa20-verifier'});
  if(!await verifyIndependentReleaseControlAttestation(evidence))throw new Error('FA-20 independent attestation integrity check failed');
}else throw new TypeError('role must be builder or verifier');

fs.writeFileSync(output,`${JSON.stringify(evidence,null,2)}\n`,{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({role,status:evidence.status,candidate_commit:candidateCommit,staging_executed:evidence.staging_executed,production_executed:evidence.production_executed,production_authority:evidence.production_authority}));

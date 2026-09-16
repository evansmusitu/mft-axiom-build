#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  FA18_HUMAN_AUTHORITY,
  runAxiomBuilderChallenge,
  runIndependentChallengeVerification,
  verifyBuilderEvidence,
  verifyIndependentAttestation,
} from '../../axiom_interface/vnext/fa18_axiom_build_challenge.mjs';

const args=new Map();
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!key?.startsWith('--')||value===undefined)throw new TypeError('arguments must be --key value pairs');
  args.set(key.slice(2),value);
}
const required=name=>{const value=args.get(name);if(!value)throw new TypeError(`--${name} required`);return value;};
const role=required('role'),candidateCommit=required('candidate-commit'),output=path.resolve(required('output'));
fs.mkdirSync(path.dirname(output),{recursive:true});

let evidence;
if(role==='builder'){
  evidence=await runAxiomBuilderChallenge({builderId:'axiom-build-studio',candidateCommit,humanAuthority:FA18_HUMAN_AUTHORITY});
  if(!await verifyBuilderEvidence(evidence))throw new Error('builder evidence self-integrity check failed');
}else if(role==='verifier'){
  const builderEvidence=JSON.parse(fs.readFileSync(path.resolve(required('builder-evidence')),'utf8'));
  if(builderEvidence.candidate_commit!==candidateCommit)throw new Error('builder evidence candidate commit mismatch');
  evidence=await runIndependentChallengeVerification({builderEvidence,verifierId:'github-actions-independent-fa18-verifier',humanAuthority:FA18_HUMAN_AUTHORITY});
  if(!await verifyIndependentAttestation(evidence))throw new Error('independent attestation integrity check failed');
}else throw new TypeError('role must be builder or verifier');

fs.writeFileSync(output,`${JSON.stringify(evidence,null,2)}\n`,{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({role,status:evidence.status,candidate_commit:candidateCommit,production_authority:evidence.production_authority}));

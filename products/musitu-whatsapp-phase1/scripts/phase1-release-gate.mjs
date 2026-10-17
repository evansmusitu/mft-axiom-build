/** Fail-closed audit gate. Checked-in evidence is not a substitute for a live verifier. */
import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(new URL('../docs/phase1/finalization/qualification.json',import.meta.url),'utf8'));
const blocked=Object.entries(r.required_live_gates).filter(([_,done])=>done!==true).map(([name])=>name);
if(blocked.length||r.public_release_authorized!==true){
 console.log(JSON.stringify({status:'PHASE1_RELEASE_BLOCKED',environment:r.environment,blocked},null,2));
 process.exitCode=2;
}else{
 // This report can never silently grant a release; an independent verifier
 // must also authorize external customer effects and production promotion.
 console.log('LOCAL_MATRIX_COMPLETE_ONLY_NOT_PUBLIC_RELEASE_AUTHORIZATION');
 process.exitCode=2;
}

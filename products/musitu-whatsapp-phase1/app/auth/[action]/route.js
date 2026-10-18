import {identityAction} from '../../../src/staging/identity.mjs';
import {identityFailureDiagnostic} from '../../../src/staging/identity-diagnostics.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req,{params}){let stage='REQUEST';try{return await identityAction(req,(await params).action,{onStage:value=>{stage=value;}});}catch(error){console.warn(JSON.stringify(identityFailureDiagnostic(stage,error)));return Response.json({error:'IDENTITY_UNAVAILABLE_OR_DENIED'},{status:503});}}
export {handle as GET,handle as POST};

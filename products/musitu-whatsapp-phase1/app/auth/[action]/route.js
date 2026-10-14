import {identityAction} from '../../../src/staging/identity.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req,{params}){try{return await identityAction(req,(await params).action);}catch{return Response.json({error:'IDENTITY_UNAVAILABLE_OR_DENIED'},{status:503});}}
export {handle as GET,handle as POST};

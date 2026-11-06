// Unconfigured staging candidate; no public route to CustomerIdentityService.
import {WorkerEntrypoint} from 'cloudflare:workers';
import {handleIdentityBrowser,handleIdentityBinding} from './zitadel_session_broker_candidate.mjs';
export default {fetch(request,env){return handleIdentityBrowser(request,env);}};
export class CustomerIdentityService extends WorkerEntrypoint {
 fetch(request){return handleIdentityBinding(request,this.env);}
}

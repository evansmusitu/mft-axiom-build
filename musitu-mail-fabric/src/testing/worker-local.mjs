/** Never deploy: isolated workerd/Miniflare integration fixture; no provider network calls. */
import {randomBytes} from 'node:crypto';
import {createWorker} from '../edge/worker.mjs';
import {createSimulatedProvider} from '../providers.mjs';
import {generateDemonstrationKeys} from '../evidence.mjs';
const worker=createWorker({providerFactory:()=>createSimulatedProvider()});
let extra;
function getExtra(){
 if(extra)return extra;
 const keys=generateDemonstrationKeys();
 extra={
 MMF_TENANT_ID:'local-test',MMF_FROM_DOMAIN:'example.org',
 MMF_AUTH_TOKEN:'local-only-test-token-012345678901234567890',
 MMF_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),
 MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64'),
 MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
 MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({format:'pem',type:'spki'}).toString(),
 MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_API_ENABLED:'true'
 };
 return extra;
}
const allow=(env,request)=>env?.MMF_LOCAL_ONLY==='true'&&env.MMF_REAL_SEND_ENABLED==='false'&&(!request||['127.0.0.1','localhost'].includes(new URL(request.url).hostname));
export default {
 async fetch(request,env){if(!allow(env,request))return new Response('LOCAL_ONLY',{status:503});return worker.fetch(request,{...env,...getExtra()});},
 async queue(batch,env){if(!allow(env)){for(const m of batch.messages)m.retry();return;}return worker.queue(batch,{...env,...getExtra()});},
 async scheduled(controller,env){if(!allow(env))return {status:'DISABLED'};return worker.scheduled(controller,{...env,...getExtra()});}
};

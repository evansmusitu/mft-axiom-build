/**
 * Meta WhatsApp webhook protocol bridge — private, loopback-only qualification.
 * Accepts GET verification and authenticated raw POST callbacks. Persistence is
 * delegated to PostgresSignedWebhookIngestor, which owns channel/tenant mapping
 * and transaction commit. This bridge never replies to customers or calls Meta.
 *
 * A public reverse proxy/domain, real Meta app verification, WAF limits, TLS,
 * independent secret custody and native PostgreSQL RLS tests are separate gates.
 */
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyMetaSignature} from '../core/channel.mjs';

const LIMIT=256*1024;
const ERRORS=new Set([
 'INVALID_META_JSON','INVALID_META_WEBHOOK','INVALID_META_SIGNATURE',
 'INVALID_META_STATUS','INVALID_META_TIMESTAMP','UNAUTHORIZED_CHANNEL',
 'UNAUTHORIZED_TENANT','UNSUPPORTED_META_CHANGE','MIXED_META_EVENT_TYPES',
 'WEBHOOK_EVENT_LIMIT','MULTI_TENANT_BATCH_DENIED','CONFLICTING_DUPLICATE_MESSAGE',
 'STATUS_REPLAY_CONFLICT','STATUS_STATE_CONFLICT','STATUS_UPDATE_CONFLICT',
 'UNKNOWN_OR_UNBOUND_OUTBOUND','MESSAGE_SENDER_OR_CONTENT_CONFLICT'
]);
const digest=s=>createHash('sha256').update(s,'utf8').digest();
export function createMetaWebhookBridge({appSecret,verifyToken,ingestor,maxBodyReadMs=5000,maxPersistenceMs=15000}={}) {
 if(typeof appSecret!=='string'||appSecret.length<8||typeof verifyToken!=='string'||verifyToken.length<8||
    typeof ingestor?.ingest!=='function'||!Number.isSafeInteger(maxBodyReadMs)||maxBodyReadMs<100||maxBodyReadMs>30000||!Number.isSafeInteger(maxPersistenceMs)||maxPersistenceMs<100||maxPersistenceMs>60000) throw new Error('META_WEBHOOK_BRIDGE_CONFIG');
 const secret=appSecret;
 const tokenDigest=digest(verifyToken);
 const server=createServer(async(req,res)=>{
  const respond=(status,text,contentType='text/plain; charset=utf-8')=>{
   if(res.headersSent||res.destroyed)return;
   res.writeHead(status,{
    'content-type':contentType,'cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
   });res.end(text);
  };
  const parsed=(()=>{try{return new URL(req.url||'','http://localhost');}catch{return null;}})();
  if(!parsed||parsed.pathname!=='/webhook'||!['GET','POST'].includes(req.method))return respond(404,'NOT_FOUND');
  if(req.method==='GET'){
   if(parsed.searchParams.size!==3||
      ['hub.mode','hub.verify_token','hub.challenge'].some(k=>parsed.searchParams.getAll(k).length!==1))
      return respond(400,'INVALID_VERIFY_REQUEST');
   const mode=parsed.searchParams.get('hub.mode');
   const provided=parsed.searchParams.get('hub.verify_token');
   const challenge=parsed.searchParams.get('hub.challenge');
   if(mode!=='subscribe'||typeof provided!=='string'||!timingSafeEqual(digest(provided),tokenDigest))
    return respond(403,'FORBIDDEN');
   if(typeof challenge!=='string'||!/^[A-Za-z0-9_.~-]{1,256}$/.test(challenge))
    return respond(400,'INVALID_CHALLENGE');
   return respond(200,challenge);
  }
  if(req.headers['content-type']!=='application/json'&&req.headers['content-type']!=='application/json; charset=utf-8')
   return respond(415,'UNSUPPORTED_MEDIA_TYPE');
  const signature=req.headers['x-hub-signature-256'];
  if(typeof signature!=='string'||!/^sha256=[a-fA-F0-9]{64}$/.test(signature))return respond(401,'SIGNATURE_REJECTED');
  const declared=req.headers['content-length'];
  if(declared!==undefined && (!/^\d+$/.test(declared)||Number(declared)>LIMIT)){
   res.once('finish',()=>req.destroy());
   return respond(413,'BODY_TOO_LARGE');
  }
  let size=0;const chunks=[];let bodyExpired=false;
  const deadline=setTimeout(()=>{
   bodyExpired=true;
   res.once('finish',()=>req.destroy());
   respond(408,'BODY_TIMEOUT');
  },maxBodyReadMs);
  try {
   for await(const chunk of req){
    if(bodyExpired)return;
    size+=chunk.length;
    if(size>LIMIT){
     res.once('finish',()=>req.destroy());
     return respond(413,'BODY_TOO_LARGE');
    }
    chunks.push(chunk);
   }
  } catch {if(!bodyExpired)return respond(400,'INVALID_REQUEST_BODY');return;}
  finally{clearTimeout(deadline);}
  if(bodyExpired)return;
  if(size===0)return respond(400,'EMPTY_BODY');
  const rawBody=Buffer.concat(chunks);
  if(!verifyMetaSignature(rawBody,signature,secret))return respond(401,'SIGNATURE_REJECTED');
  let persistenceTimer;
  try{
   // An unknown commit state must return a retryable response; never 200.
   // The underlying ingestor may still finish later: its unique keys MUST
   // make provider retries safe. This HTTP deadline does not cancel a DB txn.
   const deadline=new Promise((_,reject)=>{
    persistenceTimer=setTimeout(()=>reject(new Error('PERSISTENCE_DEADLINE_EXCEEDED')),maxPersistenceMs);
   });
   await Promise.race([ingestor.ingest({rawBody,signature}),deadline]);
   // A 200 only means our validated inbound event was committed, NOT that a
   // customer reply was sent or that Meta accepted an outbound message.
   return respond(200,'EVENT_RECEIVED');
  }catch(error){
   if(ERRORS.has(error?.message))return respond(422,'INVALID_OR_UNAUTHORIZED_EVENT');
   // Meta can retry later. Never acknowledge on uncertain database state.
   return respond(503,'PERSISTENCE_UNAVAILABLE');
  }finally{clearTimeout(persistenceTimer);}
 });
 return Object.freeze({
  async start(){
   if(server.listening)throw new Error('ALREADY_STARTED');
   await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
   return `http://127.0.0.1:${server.address().port}`;
  },
  async stop(){if(!server.listening)return;await new Promise((ok,fail)=>server.close(err=>err?fail(err):ok()));}
 });
}

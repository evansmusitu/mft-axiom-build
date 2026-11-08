/** Loopback-only private development harness. Not a reachable Meta endpoint. */
import {createServer} from 'node:http';
import {simulateOfflineFaqProcessing} from './faq-pipeline.mjs';
const MAX_BYTES=1024*1024;
export function createPrivateWebhookServer({store,appSecret,verifyToken,offlineFaqActorByTenant,postgresIngestor}){
  if((!store&&!postgresIngestor)||typeof appSecret!=='string'||!appSecret||typeof verifyToken!=='string'||!verifyToken||
    (postgresIngestor && (store||offlineFaqActorByTenant||typeof postgresIngestor.ingest!=='function')))throw new Error('PRIVATE_CONFIG_REQUIRED');
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    function respond(status,body,type='text/plain; charset=utf-8'){
      res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);
    }
    if(req.method==='GET'&&url.pathname==='/health')return respond(200,'PRIVATE_LOCAL_ONLY — no Meta, payment, email or signup egress');
    if(req.method==='GET'&&url.pathname==='/webhook'){
      const token=url.searchParams.get('hub.verify_token');
      const challenge=url.searchParams.get('hub.challenge');
      if(url.searchParams.get('hub.mode')!=='subscribe'||token!==verifyToken||!challenge||challenge.length>1024)return respond(403,'DENIED');
      return respond(200,challenge);
    }
    if(req.method!=='POST'||url.pathname!=='/webhook')return respond(404,'NOT_FOUND');
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))return respond(415,'UNSUPPORTED_MEDIA_TYPE');
    const chunks=[];let size=0;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES) return respond(413,'PAYLOAD_TOO_LARGE');chunks.push(chunk);}
      const input={rawBody:Buffer.concat(chunks),signature:req.headers['x-hub-signature-256'],appSecret};
      const result=postgresIngestor
        ? {receipts:await postgresIngestor.ingest(input),drafts:[]}
        : offlineFaqActorByTenant
          ? simulateOfflineFaqProcessing({store,...input,actorForTenant:offlineFaqActorByTenant})
          : {receipts:store.ingestSignedWebhook(input),drafts:[]};
      const body={statuses:result.receipts.map(x=>x.status)};
      if(offlineFaqActorByTenant)body.offlineDraftCount=result.drafts.filter(x=>x.status==='DRAFT').length;
      return respond(200,JSON.stringify(body),'application/json');
    }catch(e){
      if(e.message==='INVALID_META_SIGNATURE')return respond(401,'SIGNATURE_REJECTED');
      if(['INVALID_META_JSON','INVALID_META_WEBHOOK','INVALID_CUSTOMER_ID','CONFLICTING_CUSTOMER_ID','MULTI_TENANT_BATCH_DENIED','CONFLICTING_DUPLICATE_MESSAGE'].includes(e.message))return respond(400,'INVALID_WEBHOOK');
      if(['UNAUTHORIZED_CHANNEL','UNAUTHORIZED_TENANT'].includes(e.message))return respond(403,'CHANNEL_DENIED');
      if(e.message==='WEBHOOK_BODY_LIMIT')return respond(413,'PAYLOAD_TOO_LARGE');
      if(e.message==='ACCESS_DENIED')return respond(403,'STAGE_ACTOR_DENIED');
      if(['UNKNOWN_OUTBOUND_ATTEMPT','INVALID_META_STATUS','UNSUPPORTED_PROVIDER_STATUS','UNSUPPORTED_META_CHANGE','WEBHOOK_EVENT_LIMIT','MESSAGE_SENDER_OR_CONTENT_CONFLICT','INVALID_META_STATUS','MIXED_META_EVENT_TYPES','UNKNOWN_OR_UNBOUND_OUTBOUND','STATUS_REPLAY_CONFLICT','STATUS_STATE_CONFLICT','STATUS_UPDATE_CONFLICT'].includes(e.message))return respond(422,'UNKNOWN_OR_INVALID_STATUS');
      return respond(500,'PRIVATE_STAGE_ERROR');
    }
  });
  return {
    async start(){
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      return `http://127.0.0.1:${server.address().port}`;
    },
    async stop(){await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  };
}

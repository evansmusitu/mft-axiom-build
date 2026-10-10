/** Isolated Cloudflare staging control-plane. Does not deploy mail or touch live routes.
 *  Requires explicit auth to one exact account; resource names are immutable.
 */
export const STAGE = Object.freeze({
  account: '93f395f5121954671f92fffa453d6b61',
  database: 'musitu-mail-fabric-staging-20261010',
  queue: 'musitu-mail-fabric-staging-20261010',
});
const API='https://api.cloudflare.com/client/v4';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const QID=/^[a-f0-9]{32}$/i;
function guard(flag,reason){if(!flag)throw new Error(reason);}
export async function provision({account,dbToken,queueToken,fetchImpl=fetch,schema,dryRun=true}={}){
  guard(account===STAGE.account,'ACCOUNT_SCOPE_MISMATCH');
  guard(typeof dbToken==='string'&&dbToken.length>16,'D1_CREDENTIAL_REQUIRED');
  guard(typeof queueToken==='string'&&queueToken.length>16,'QUEUES_CREDENTIAL_REQUIRED');
  guard(typeof schema==='string'&&schema.includes('CREATE TABLE IF NOT EXISTS mail_messages')&&schema.includes('mail_provider_events'),'UNEXPECTED_SCHEMA');
  async function req(path,token,{method='GET',body}={}){
    const r=await fetchImpl(API+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(18000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.success===false){
      if(method==='POST'&&path==='/accounts/'+STAGE.account+'/d1/database'&&(j.errors||[]).some(e=>e.code===7406))
        throw new Error('D1_ACCOUNT_DATABASE_LIMIT');
      throw new Error('CLOUDFLARE_'+method+'_HTTP_'+r.status+'_CODES_'+(j.errors||[]).map(e=>e.code).filter(x=>typeof x==='number').join('_'));
    }
    return j.result;
  }
  const path='/accounts/'+account;
  // Independently verify exact account before mutation; existing support infrastructure is never selected.
  const accountInfo=await req(path,dbToken);
  guard(accountInfo?.id===account,'ACCOUNT_READBACK_MISMATCH');
  const d1list=await req(path+'/d1/database?name='+encodeURIComponent(STAGE.database)+'&per_page=100',dbToken);
  guard(Array.isArray(d1list),'D1_DISCOVERY_UNAVAILABLE');
  const d1hits=d1list.filter(x=>x.name===STAGE.database);
  guard(d1hits.length<2,'AMBIGUOUS_STAGING_DATABASE');
  const queueList=await req(path+'/queues?per_page=100',queueToken);
  const list=Array.isArray(queueList)?queueList:Array.isArray(queueList?.queues)?queueList.queues:null;
  guard(Array.isArray(list),'QUEUE_DISCOVERY_UNAVAILABLE');
  const queueHits=list.filter(x=>x.queue_name===STAGE.queue);
  guard(queueHits.length<2,'AMBIGUOUS_STAGING_QUEUE');
  if(dryRun)return {status:'READ_ONLY',d1Exists:d1hits.length===1,queueExists:queueHits.length===1,mailEnabled:false,workerPublished:false};
  let db=d1hits[0],q=queueHits[0];
  if(!db)db=await req(path+'/d1/database',dbToken,{method:'POST',body:{name:STAGE.database,read_replication:{mode:'disabled'}}});
  guard(db?.name===STAGE.database&&UUID.test(String(db.uuid||'')),'STAGING_DATABASE_CREATION_INVALID');
  if(!q)q=await req(path+'/queues',queueToken,{method:'POST',body:{queue_name:STAGE.queue}});
  guard(q?.queue_name===STAGE.queue&&QID.test(String(q.queue_id||'')),'STAGING_QUEUE_CREATION_INVALID');
  const dbCheck=await req(path+'/d1/database/'+db.uuid,dbToken);
  const queueCheck=await req(path+'/queues/'+q.queue_id,queueToken);
  guard(dbCheck?.name===STAGE.database&&queueCheck?.queue_name===STAGE.queue,'STAGING_READBACK_MISMATCH');
  // D1 query is restricted to the exact newly identified database UUID.
  const queried=await req(path+'/d1/database/'+db.uuid+'/query',dbToken,{method:'POST',body:{sql:schema}});
  guard(queried!==null&&queried!==undefined,'D1_SCHEMA_APPLY_FAILED');
  const proof=await req(path+'/d1/database/'+db.uuid+'/query',dbToken,{method:'POST',body:{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_messages','mail_suppressions','mail_provider_events','mail_sender_domains') ORDER BY name"}});
  const names=(Array.isArray(proof)?proof.flatMap(z=>z.results||[]):proof?.results||[]).map(x=>x.name);
  guard(['mail_messages','mail_suppressions','mail_provider_events','mail_sender_domains'].every(name=>names.includes(name)),'D1_SCHEMA_READBACK_FAILED');
  return {status:'STAGING_RESOURCES_READY',databaseId:db.uuid,queueId:q.queue_id,tableCount:names.length,mailEnabled:false,workerPublished:false};
}

import {DurableObject} from 'cloudflare:workers';
import {verifiedV03Identity} from './v03_identity.mjs';
import {createV03Worker} from './v03_entry.mjs';
import {makeDurableSqlAdapter} from './v03_do_adapter.mjs';
import {ENTERPRISE_SCHEMA_1,ENTERPRISE_SCHEMA_2} from './v03_do_schema.mjs';

// This is a deliberately private, single-tenant Studio ledger. It is NOT
// a public Cloudflare Access bypass or a direct database API.
const INNER_ACTOR='x-musitu-internal-verified-actor';
const MISS=()=>new Response(JSON.stringify({ok:false,error:'ACCESS_DENIED'}),{
  status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
const CLOSED=()=>new Response(JSON.stringify({ok:false,error:'SERVICE_UNAVAILABLE'}),{
  status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
function trustedActor(req){
  const text=req.headers.get(INNER_ACTOR);
  if(!text||text.length>500)return null;
  try{
    const x=JSON.parse(text);
    if(x&&typeof x.sub==='string'&&x.sub.length>0&&x.sub.length<=200&&
       typeof x.email==='string'&&x.email.length<=254&&x.email.includes('@'))
      return {sub:x.sub,email:x.email};
  }catch{}
  return null;
}

export class StudioEnterpriseSqliteLedger extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.env=env;
    this.db=makeDurableSqlAdapter(ctx.storage);
    this.ready=ctx.blockConcurrencyWhile(async()=>{
      const sql=ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS _studio_schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
      const version=Number(sql.exec('SELECT COALESCE(MAX(version),0) AS n FROM _studio_schema_versions').one().n);
      if(version>2)throw Error('LEDGER_SCHEMA_NEWER_THAN_WORKER');
      if(version<1)ctx.storage.transactionSync(()=>{
        sql.exec(ENTERPRISE_SCHEMA_1);
        sql.exec('INSERT INTO _studio_schema_versions(version,applied_at) VALUES(1,?)',new Date().toISOString());
      });
      if(version<2)ctx.storage.transactionSync(()=>{
        sql.exec(ENTERPRISE_SCHEMA_2);
        sql.exec('INSERT INTO _studio_schema_versions(version,applied_at) VALUES(2,?)',new Date().toISOString());
      });
    });
    this.worker=createV03Worker({identify:async request=>trustedActor(request)});
  }
  async fetch(req){
    await this.ready;
    if(new URL(req.url).pathname==='/internal/callback')
      return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
    const actor=trustedActor(req);
    if(!actor)return MISS();
    const pathname=new URL(req.url).pathname;
    if(pathname==='/api/recovery/readiness'){
      if(req.method!=='GET')return new Response(JSON.stringify({ok:false,error:'METHOD_NOT_ALLOWED'}),{
        status:405,headers:{'content-type':'application/json','cache-control':'no-store'}});
      const owned=this.ctx.storage.sql.exec(
        "SELECT COUNT(*) AS n FROM memberships WHERE member_sub=? AND role='owner'",actor.sub).one();
      if(Number(owned?.n??0)<1)return new Response(JSON.stringify({ok:false,error:'FORBIDDEN'}),{
        status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
      const version=Number(this.ctx.storage.sql.exec(
        'SELECT COALESCE(MAX(version),0) AS n FROM _studio_schema_versions').one()?.n??0);
      let available=false;
      try{
        const get=this.ctx.storage.getCurrentBookmark;
        if(typeof get==='function'){
          const bookmark=await get.call(this.ctx.storage);
          available=typeof bookmark==='string'&&bookmark.length>=10&&bookmark.length<=256;
        }
      }catch{
        // PITR is deliberately unavailable in local workerd; no restore operation invoked.
      }
      return new Response(JSON.stringify({ok:true,schema_version:version,
        pitr_bookmark_available:available,backup_bookmark_exposed:false,
        destructive_restore_triggered:false,live_restore_qualification_verified:false}),{
        status:200,headers:{'content-type':'application/json','cache-control':'no-store',
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
    }
    return this.worker.fetch(req,{...this.env,STUDIO_DB:this.db});
  }
}

export default {
  async fetch(req,env){
    if(!env.STUDIO_LEDGER||!env.STUDIO_ASSETS||!env.ASSETS)return CLOSED();
    const url=new URL(req.url);
    // NO public callback path: Modal results are retrieved with approved signed-staff
    // pull/sync. A network client cannot directly write a completed-job artifact.
    if(url.pathname==='/internal/callback')return new Response('Not found',{status:404});
    const actor=await verifiedV03Identity(req,env);
    if(!actor)return MISS();
    if(!url.pathname.startsWith('/api/')){
      if(!['GET','HEAD'].includes(req.method))return MISS();
      return env.ASSETS.fetch(req);
    }
    const headers=new Headers(req.headers);
    headers.delete(INNER_ACTOR);
    headers.set(INNER_ACTOR,JSON.stringify({sub:actor.sub,email:actor.email}));
    const forwarded=new Request(req,{headers});
    const instance=env.STUDIO_LEDGER.get(env.STUDIO_LEDGER.idFromName('v03-studio-ledger-primary'));
    return instance.fetch(forwarded);
  }
};

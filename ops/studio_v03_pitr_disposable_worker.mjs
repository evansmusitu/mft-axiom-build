/** Disposable Cloudflare provider PITR proof. Not part of Studio production Worker.
 * This can be used only by the throwaway Wrangler CI deployment, protected
 * by a freshly generated runner-only bearer secret. NEVER uses customer data.
 */
import {DurableObject} from 'cloudflare:workers';
const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json','cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const equal=async(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;
  const enc=new TextEncoder();
  const [aa,bb]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(a)),
    crypto.subtle.digest('SHA-256',enc.encode(b))]);
  const x=new Uint8Array(aa),y=new Uint8Array(bb);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
};
export class StudioV03DisposablePitrProof extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.ctx=ctx;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS proof_items (name TEXT PRIMARY KEY, number INTEGER NOT NULL)');
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    const sql=this.ctx.storage.sql;
    if(path==='/snapshot'&&request.method==='GET'){
      const rows=Array.from(sql.exec('SELECT name FROM proof_items ORDER BY name'),x=>x.name);
      return json({ok:true,names:rows});
    }
    if(path==='/seed'&&request.method==='POST'){
      if(Number(sql.exec('SELECT COUNT(*) AS n FROM proof_items').one().n)!==0)
        return json({ok:false,error:'NOT_EMPTY'},409);
      sql.exec("INSERT INTO proof_items(name,number) VALUES('original',1)");
      const bookmark=await this.ctx.storage.getCurrentBookmark();
      if(typeof bookmark!=='string'||!/^[A-Za-z0-9-]{15,200}$/.test(bookmark))
        return json({ok:false,error:'BOOKMARK_UNAVAILABLE'},503);
      return json({ok:true,bookmark,names:['original']});
    }
    if(path==='/mutate'&&request.method==='POST'){
      if(Number(sql.exec('SELECT COUNT(*) AS n FROM proof_items').one().n)!==1)
        return json({ok:false,error:'MUTATION_STATE_INVALID'},409);
      sql.exec("INSERT INTO proof_items(name,number) VALUES('later',2)");
      return json({ok:true,names:['later','original']});
    }
    if(path==='/restore'&&request.method==='POST'){
      let data;
      try{data=await request.json()}catch{return json({ok:false,error:'INVALID_JSON'},400)}
      const bookmark=data?.bookmark;
      if(typeof bookmark!=='string'||!/^[A-Za-z0-9-]{15,200}$/.test(bookmark))
        return json({ok:false,error:'INVALID_BOOKMARK'},400);
      if(Number(sql.exec('SELECT COUNT(*) AS n FROM proof_items').one().n)!==2)
        return json({ok:false,error:'RESTORE_STATE_INVALID'},409);
      await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
      // The connection may drop. The caller must poll /snapshot for evidence.
      this.ctx.abort();
      return json({ok:false,error:'ABORT_NOT_RESTARTED'},500);
    }
    return json({ok:false,error:'NOT_FOUND'},404);
  }
}
export default {
  async fetch(request,env){
    const key=env.STUDIO_PITR_PROOF_BEARER;
    const supplied=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
    if(!await equal(key,supplied))return json({ok:false,error:'UNAUTHORIZED'},403);
    const path=new URL(request.url).pathname;
    if(!['/snapshot','/seed','/mutate','/restore'].includes(path))return json({ok:false,error:'NOT_FOUND'},404);
    const instance=env.STUDIO_PITR_PROOF.get(env.STUDIO_PITR_PROOF.idFromName('ci-only-isolated-20261018'));
    return instance.fetch(new Request(request));
  }
};

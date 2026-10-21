/** Disposable Cloudflare hosted SQLite DO PITR proof.
 * Cron-only: absolutely no public route and no customer database bindings.
 * This Worker must be deleted by its guarded evidence-collector workflow.
 */
import {DurableObject} from 'cloudflare:workers';
const reply=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const names=sql=>Array.from(sql.exec('SELECT name FROM proof_items ORDER BY name'),x=>x.name);
export class StudioV03CronPitrProof extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.ctx=ctx;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS proof_items (name TEXT PRIMARY KEY, number INTEGER NOT NULL)');
  }
  async fetch(request){
    const path=new URL(request.url).pathname, sql=this.ctx.storage.sql;
    if(path==='/begin'&&request.method==='POST'){
      // Only disposable state is ever cleared. Every scheduled trigger does a
      // complete fresh proof rather than relying on a stale previous tick.
      sql.exec('DELETE FROM proof_items');
      sql.exec("INSERT INTO proof_items(name,number) VALUES('original',1)");
      const bookmark=await this.ctx.storage.getCurrentBookmark();
      if(typeof bookmark!=='string'||bookmark.length<15||bookmark.length>256)
        return reply({ok:false,error:'NO_PROVIDER_BOOKMARK'},503);
      if(names(sql).join(',')!=='original')return reply({ok:false,error:'SEED_MISMATCH'},409);
      sql.exec("INSERT INTO proof_items(name,number) VALUES('later',2)");
      if(names(sql).join(',')!=='later,original')return reply({ok:false,error:'MUTATION_MISMATCH'},409);
      return reply({ok:true,bookmark,mutated:true});
    }
    if(path==='/restore'&&request.method==='POST'){
      const obj=await request.json().catch(()=>null);
      const bookmark=obj?.bookmark;
      if(typeof bookmark!=='string'||!/^[A-Za-z0-9-]{15,256}$/.test(bookmark))
        return reply({ok:false,error:'INVALID_BOOKMARK'},400);
      if(names(sql).join(',')!=='later,original')return reply({ok:false,error:'RESTORE_PREREQUISITE_FAILED'},409);
      await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
      this.ctx.abort();
      return reply({ok:false,error:'EXPECTED_ABORT_DID_NOT_OCCUR'},500);
    }
    if(path==='/snapshot'&&request.method==='GET')return reply({ok:true,names:names(sql)});
    return reply({ok:false,error:'NOT_FOUND'},404);
  }
}
export default {
  async fetch(){return new Response('Not Found',{status:404,headers:{'cache-control':'no-store'}})},
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      if(!env.STUDIO_PITR_RECEIPTS)throw Error('ISOLATED_KV_BINDING_REQUIRED');
      // On an already-completed proof, do not re-run a restoration.
      const prior=await env.STUDIO_PITR_RECEIPTS.get('receipt');
      if(prior){
        try{if(JSON.parse(prior)?.restored===true)return;}catch{}
      }
      const receipt={schema:'musitu.studio.v03.disposable.cron-pitr.v1',
        isolated_new_worker:true,cron_only_no_public_ingress:true,
        customer_data_read:false,customer_data_restored:false,
        modal_compute_started:false,source_worker_preserved:true,
        real_bookmark:false,mutated_before_restore:false,restored:false};
      try{
        const id=env.STUDIO_CRON_PITR.get(env.STUDIO_CRON_PITR.idFromName('cron-only-throwaway-20261020'));
        const initial=await id.fetch('https://internal.invalid/begin',{method:'POST'});
        const body=await initial.json();
        if(!initial.ok||!body.ok||body.mutated!==true||typeof body.bookmark!=='string')
          throw Error('PROVIDER_BOOKMARK_OR_MUTATION_UNAVAILABLE');
        receipt.real_bookmark=true;receipt.mutated_before_restore=true;
        // Cloudflare restores on next DO restart. Abort disrupts this particular
        // fetch by design. The outer Worker must handle that expected failure.
        try{
          await id.fetch('https://internal.invalid/restore',{
            method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({bookmark:body.bookmark})});
        }catch{}
        body.bookmark=null;
        for(let n=0;n<24;n++){
          await new Promise(resolve=>setTimeout(resolve,600));
          try{
            const q=await id.fetch('https://internal.invalid/snapshot');
            const data=await q.json();
            if(q.status===200&&data.ok&&Array.isArray(data.names)&&data.names.join(',')==='original'){
              receipt.restored=true;break;
            }
          }catch{}
        }
      }catch{}
      // Never emit bookmarks, bearer values, emails, IP addresses or tokens.
      await env.STUDIO_PITR_RECEIPTS.put('receipt',JSON.stringify(receipt),{expirationTtl:3600});
      console.log('STUDIO_CLOUD_PITR_CRON_PROOF='+JSON.stringify(receipt));
    })());
  }
};

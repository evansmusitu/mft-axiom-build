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
      try{
        await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
      }catch{
        // No raw provider exception, SQL data, or bookmark leaves this scope.
        return reply({ok:false,error:'RESTORE_SCHEDULE_FAILED'},503);
      }
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
      // A disposable proof executes only once. Cron repeats must never reset
      // sample SQL or overwrite a failed receipt while CI is inspecting it.
      // This same-namespace KV claim is a safety backstop; no user data is bound.
      if(await env.STUDIO_PITR_RECEIPTS.get('receipt'))return;
      if(await env.STUDIO_PITR_RECEIPTS.get('attempted'))return;
      await env.STUDIO_PITR_RECEIPTS.put('attempted','1',{expirationTtl:3600});
      const receipt={schema:'musitu.studio.v03.disposable.cron-pitr.v1',
        isolated_new_worker:true,cron_only_no_public_ingress:true,
        customer_data_read:false,customer_data_restored:false,
        modal_compute_started:false,source_worker_preserved:true,
        real_bookmark:false,mutated_before_restore:false,restored:false,
        restore_outcome:'NOT_SENT',restore_http_status:null,restore_error_code:'NONE',
        last_snapshot_state:'NOT_CHECKED',snapshot_attempts:0,
        failure_stage:'BEGIN'};
      let stage='BEGIN';
      try{
        const id=env.STUDIO_CRON_PITR.get(env.STUDIO_CRON_PITR.idFromName('cron-only-throwaway-20261020'));
        const initial=await id.fetch('https://internal.invalid/begin',{method:'POST'});
        const body=await initial.json();
        if(!initial.ok||!body.ok||body.mutated!==true||typeof body.bookmark!=='string')
          throw Error('PROVIDER_BOOKMARK_OR_MUTATION_UNAVAILABLE');
        receipt.real_bookmark=true;receipt.mutated_before_restore=true;
        // A failed /restore HTTP response is NOT a healthy abort; it must be
        // distinguished from the expected transport disconnection after ctx.abort.
        stage='RESTORE_REQUEST';
        try{
          const response=await id.fetch('https://internal.invalid/restore',{
            method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({bookmark:body.bookmark})});
          receipt.restore_http_status=response.status;
          if(response.status>=400){
            // Only a fixed enum may enter the private receipt, never a raw
            // provider body, URL, account identifier, cookie or bookmark.
            try{
              const error=(await response.json())?.error;
              receipt.restore_error_code=[
                'INVALID_BOOKMARK','RESTORE_PREREQUISITE_FAILED',
                'RESTORE_SCHEDULE_FAILED','EXPECTED_ABORT_DID_NOT_OCCUR'
              ].includes(error)?error:'UNKNOWN';
            }catch{receipt.restore_error_code='UNREADABLE'}
          }
          if(response.status>=400&&response.status<500){
            receipt.restore_outcome='HTTP_REJECTED';
            throw Error('RESTORE_HTTP_REJECTED');
          }
          // A 5xx at ctx.abort may mean an expected restart, not proof of
          // restore failure. Always decide acceptance from a fresh snapshot.
          receipt.restore_outcome=response.status>=500?'HTTP_SERVER_ERROR':
            response.status>=200&&response.status<300?'HTTP_ACCEPTED':'OTHER_HTTP';
        }catch{
          if(receipt.restore_outcome==='HTTP_REJECTED')throw Error('RESTORE_HTTP_REJECTED');
          receipt.restore_outcome='DISCONNECTED';
        }
        body.bookmark=null;
        stage='POLL_RESTORED_STATE';
        for(let n=0;n<24;n++){
          receipt.snapshot_attempts++;
          await new Promise(resolve=>setTimeout(resolve,600));
          try{
            const q=await id.fetch('https://internal.invalid/snapshot');
            const data=await q.json();
            if(q.status===200&&data.ok&&Array.isArray(data.names)){
              const current=data.names.join(',');
              receipt.last_snapshot_state=current==='original'?'ORIGINAL_ONLY':
                current==='later,original'?'MUTATED':'OTHER';
              if(current==='original'){
                receipt.restored=true;break;
              }
            }else receipt.last_snapshot_state='INVALID_RESPONSE';
          }catch{receipt.last_snapshot_state='NO_RESPONSE'}
        }
        if(receipt.restored)receipt.failure_stage='NONE';
        else receipt.failure_stage=stage;
      }catch{receipt.failure_stage=stage}
      // Never emit bookmarks, bearer values, emails, IP addresses or tokens.
      await env.STUDIO_PITR_RECEIPTS.put('receipt',JSON.stringify(receipt),{expirationTtl:3600});
      console.log('STUDIO_CLOUD_PITR_CRON_PROOF='+JSON.stringify(receipt));
    })());
  }
};

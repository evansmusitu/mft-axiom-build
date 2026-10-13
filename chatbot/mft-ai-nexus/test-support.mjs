import {DatabaseSync} from 'node:sqlite';
import worker,{MftAiDailyQuota} from './worker.mjs';
export function setup(overrides={}){
 const db=new DatabaseSync(':memory:'); let alarm=null;
 const storage={transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},sql:{exec(query,...args){const s=db.prepare(query);return s.columns().length?s.all(...args):(s.run(...args),[]);}},async setAlarm(at){alarm=at;},async getAlarm(){return alarm;},async deleteAlarm(){alarm=null;}};
 const env={ENABLE_WHATSAPP_MESSAGES:'true',WHATSAPP_MODE:'test',WHATSAPP_TEST_RECIPIENTS:'263781000000',WHATSAPP_APP_SECRET:'test-secret',WHATSAPP_VERIFY_TOKEN:'test-verify',WHATSAPP_ACCESS_TOKEN:'test-access',WHATSAPP_PHONE_NUMBER_ID:'445566',...overrides};
 const object=new MftAiDailyQuota({storage},env);
 env.AI_BUDGET={idFromName:()=>({}),get:()=>({fetch:(url,init)=>object.fetch(new Request(url,init))})};
 return {object,env,db,storage};
}
export const payload=(overrides={})=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'445566'},messages:[{id:'wamid.reliable.1',from:'263781000000',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Hi'},...overrides}]}}]}]});
export async function deliver(env,p){const body=JSON.stringify(p);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const hex=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');const pending=[];const response=await worker.fetch(new Request('https://test/webhook',{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+hex}}),env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return response;}

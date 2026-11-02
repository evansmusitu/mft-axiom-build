/** Actual workerd SQLite Durable Objects, synthetic role keys, no hosted authority claim. */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExternalLedgerClient} from '../../integrations/independent-ledger/client.mjs';
import {canonicalJson,sha256Json} from '../../integrations/independent-ledger/protocol.mjs';
const {Miniflare}=await import(process.env.AXIOM_MINIFLARE_MODULE||'miniflare');
const {build}=await import(process.env.AXIOM_ESBUILD_MODULE||'esbuild');
const bundle=await build({entryPoints:['integrations/independent-ledger/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
export const origin='https://independent-ledger.example',artifact=process.env.AXIOM_ANCHOR_EXECUTION_ARTIFACT_SHA256||'a'.repeat(64),admission='b'.repeat(64),contractHash='c'.repeat(64);
const tokens=Object.fromEntries(['bootstrap','grant','consume','read','revoke','beta'].map(x=>[x,`synthetic_${x}_credential_`.repeat(3)]));
export async function fixture(t,{persist=false,anchor=null}={}){
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const privateJwk=await crypto.subtle.exportKey('jwk',keys.privateKey),fullPublic=await crypto.subtle.exportKey('jwk',keys.publicKey),publicJwk={kty:fullPublic.kty,crv:fullPublic.crv,x:fullPublic.x};
  const config={ledger_id:'fixture-ledger',genesis_id:'fixture-genesis',key_id:'fixture-key',execution_artifact_sha256:artifact};
  const registry={};for(const [name,token]of Object.entries(tokens))registry[await sha256Json(token)]={subject:'subject-'+name,tenant_id:['consume','read'].includes(name)?'tenant-alpha':name==='beta'?'tenant-beta':null,roles:[name==='beta'?'consume':name]};
  const directory=persist?mkdtempSync(join(tmpdir(),'axiom-authority-store-')):null;
  const options={modules:true,compatibilityDate:'2026-07-01',cf:false,script:bundle.outputFiles[0].text,durableObjects:{LEDGER_STATE:{className:'MonotonicLedger',useSQLite:true}},bindings:{LEDGER_CONFIG_JSON:JSON.stringify(config),LEDGER_PRINCIPALS_JSON:JSON.stringify(registry),LEDGER_SIGNING_JWK:JSON.stringify(privateJwk),LEDGER_ALLOW_BOOTSTRAP:'true',...(anchor?{LEDGER_GITHUB_ANCHOR_CONFIG_JSON:JSON.stringify(anchor.pin),LEDGER_GITHUB_ANCHOR_TOKEN:anchor.token}:{})},...(directory?{durableObjectsPersist:directory}:{}),...(anchor?{outboundService:request=>anchor.fetchImpl(request)}:{})};
  let mf=new Miniflare(options);t.after(async()=>{if(mf)await mf.dispose();if(directory){rmSync(directory,{recursive:true,force:true});rmSync(directory+'-snapshot',{recursive:true,force:true});}});
  const fetchImpl=(url,init)=>mf.dispatchFetch(url,init);
  const request=(path,input,{role='grant',raw,method='POST'}={})=>fetchImpl(origin+path,{method,headers:{authorization:'Bearer '+tokens[role],'content-type':'application/json'},...(method==='POST'?{body:raw??canonicalJson(input)}:{})});
  const makeClient=extra=>createExternalLedgerClient({origin,...config,grant_id:'grant-one',epoch:1,public_key_jwk:publicJwk,token:tokens.consume,readToken:tokens.read,fetchImpl,...(anchor?{github_anchor:anchor.pin,anchorReadToken:anchor.readToken??anchor.token,anchorFetchImpl:anchor.fetchImpl,timeoutMs:10000}:{}),...extra});
  const grantInput=extra=>({grant_id:'grant-one',tenant_id:'tenant-alpha',work_id:'work-one',admission_sha256:admission,execution_artifact_sha256:artifact,epoch:1,max_actions:3,max_compute_calls:1,max_provider_calls:2,expires_at:new Date(Date.now()+600000).toISOString(),challenge:'1'.repeat(64),...extra});
  const prepare=(client,extra={})=>client.prepare({contract:{tenant_id:'tenant-alpha',work_id:'work-one',contract_sha256:contractHash,policy:{external_ledger:client.reference}},admission_sha256:admission,task_id:'task_one',slot:0,action:{kind:'model',operation:null,compute_calls:0,provider_calls:1},...extra});
  return {readyUrl:()=>mf.ready,keys,publicJwk,config,registry,options,fetchImpl,request,makeClient,grantInput,prepare,
    async bootstrap(){const r=await request('/v1/operator/bootstrap',{ledger_id:config.ledger_id,genesis_id:config.genesis_id,challenge:'0'.repeat(64)},{role:'bootstrap'});assert.equal(r.status,200,await r.clone().text());},
    async grant(extra){const r=await request('/v1/operator/grants',grantInput(extra));assert.equal(r.status,200,await r.clone().text());return r.json();},
    async restart(bindings={}){await mf.dispose();mf=null;mf=new Miniflare({...options,bindings:{...options.bindings,...bindings}});},
    async loseStore(){if(!directory)throw Error('persistent fixture required');await mf.dispose();mf=null;rmSync(directory,{recursive:true,force:true});mf=new Miniflare(options);},
    async snapshotStore(){if(!directory)throw Error('persistent fixture required');await mf.dispose();mf=null;cpSync(directory,directory+'-snapshot',{recursive:true});mf=new Miniflare(options);},
    async restoreStore(){if(!directory)throw Error('persistent fixture required');await mf.dispose();mf=null;rmSync(directory,{recursive:true,force:true});cpSync(directory+'-snapshot',directory,{recursive:true});mf=new Miniflare(options);},
  };
}

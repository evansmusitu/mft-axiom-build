/**
 * MUSITU Store V2 — private, standalone Paynow 27721 TESTING receipt review.
 * NOT a checkout endpoint. Does not initiate transactions, refund, grant
 * entitlements, enable payouts, enroll publishers, or certify callbacks.
 *
 * Requires an independently obtained, genuine callback body and an already
 * durably recorded Store order. The underlying Paynow review adapter performs
 * one pinned HTTPS POST to Paynow's order-bound pollurl, verifies both SHA512
 * bodies, and writes an operator-private REVIEW_ONLY journal.
 *
 * Never store the merchant integration key in files, Git, CLI arguments or
 * shell history. Use an operator-only managed environment secret.
 */
import {constants as FS,closeSync,fstatSync,lstatSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pollAndRecordPaynowReviewEvent} from './paynow-provider-poll.mjs';

function deny(){throw Error('private_paynow_testing_review_denied');}
const FLAGS=['STORE_CHECKOUT_ENABLED','STORE_CALLBACKS_CERTIFIED','STORE_ENTITLEMENTS_ENABLED','STORE_PUBLISHER_PAYOUTS_ENABLED'];
function environmentOk(env){
 return env&&env.STORE_PAYNOW_ID==='27721'&&env.STORE_PAYNOW_MODE==='testing'&&
   env.STORE_FIRST_PARTY_ONLY==='true'&&env.STORE_TEST_REVIEW_APPROVED==='true'&&
   FLAGS.every(flag=>env[flag]==='false')&&
   typeof env.STORE_PAYNOW_INTEGRATION_KEY==='string'&&
   env.STORE_PAYNOW_INTEGRATION_KEY.length>=16;
}
function options(args){
 if(!Array.isArray(args)||args.length!==6)deny();
 const out=Object.create(null);
 for(let i=0;i<args.length;i+=2){
   const key=args[i];
   if(!['--order','--callback','--ledger'].includes(key)||
     typeof args[i+1]!=='string'||out[key]!==undefined)deny();
   out[key]=args[i+1];
 }
 if(!out['--order']||!out['--callback']||!out['--ledger']||
    new Set(Object.values(out)).size!==3)deny();
 return out;
}
function privateFile(path,max){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||
    typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path.length>2048)deny();
 let fd;
 try{
   const l=lstatSync(path);
   if(!l.isFile()||l.isSymbolicLink()||l.uid!==process.getuid()||
      (l.mode&0o077)!==0||l.nlink!==1||l.size<1||l.size>max||realpathSync(path)!==path)deny();
   fd=openSync(path,FS.O_RDONLY|(FS.O_NOFOLLOW??0));
   const s=fstatSync(fd);
   if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||
      s.nlink!==1||s.size<1||s.size>max||s.ino!==l.ino||s.dev!==l.dev)deny();
   return new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(fd));
 }catch{deny();}
 finally{if(fd!==undefined)closeSync(fd);}
}
function trustedOrder(source){
 let obj;
 try{obj=JSON.parse(source);}catch{deny();}
 if(!obj||Array.isArray(obj)||Object.getPrototypeOf(obj)!==Object.prototype||
    Object.keys(obj).sort().join(',')!=='amount,integration_id,pollurl,reference,testing'||
    obj.integration_id!=='27721'||obj.testing!==true||
    typeof obj.reference!=='string'||!/^STORE-[A-Z0-9]{16,48}$/.test(obj.reference)||
    typeof obj.amount!=='string'||!/^(?:0|[1-9]\d{0,2})\.\d{2}$/.test(obj.amount)||
    Number(obj.amount)<=0||Number(obj.amount)>10||
    typeof obj.pollurl!=='string'||obj.pollurl.length>512)deny();
 return {reference:obj.reference,amount:obj.amount,pollurl:obj.pollurl};
}
/**
 * CI may substitute the transport/ledger ONLY for isolated tests. The CLI
 * cannot use dependency injection and always uses native TLS transport.
 */
export async function runPrivatePaynowTestingReview({args,env,reviewImpl}={}){
 if(!environmentOk(env))deny();
 if(reviewImpl!==undefined&&process.env.CI!=='true')deny();
 const input=options(args);
 const order=trustedOrder(privateFile(input['--order'],2048));
 const callbackBody=privateFile(input['--callback'],8192);
 if(!isAbsolute(input['--ledger'])||resolve(input['--ledger'])!==input['--ledger']||
    input['--ledger'].length>2048)deny();
 const impl=reviewImpl??pollAndRecordPaynowReviewEvent;
 const evidence=await impl({
   ledgerDirectory:input['--ledger'],callbackBody,
   integrationKey:env.STORE_PAYNOW_INTEGRATION_KEY,order
 });
 if(evidence?.state!=='REVIEW_RECORDED_PRIVATE_ONLY'||
    evidence.entitlementGranted!==false||
    evidence.publisherSettlementAuthorized!==false||
    evidence.refundFinalized!==false||
    !Number.isSafeInteger(evidence.eventCount)||evidence.eventCount<1||
    !['boolean'].includes(typeof evidence.manualReviewLocked))deny();
 return Object.freeze({ok:true,code:'STORE_PAYNOW_27721_TESTING_REVIEW_RECORDED',
   eventCount:evidence.eventCount,manualReviewLocked:evidence.manualReviewLocked,
   entitlementGranted:false,publisherSettlementAuthorized:false,
   refundFinalized:false,realMoneyCertified:false,
   marketplacePermissionCertified:false,phase1Accepted:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
   const receipt=await runPrivatePaynowTestingReview({args:process.argv.slice(2),env:process.env});
   process.stdout.write(JSON.stringify(receipt)+'\n');
 }catch{
   process.stderr.write('private_paynow_testing_review_denied_or_pending\n');
   process.exitCode=1;
 }
}

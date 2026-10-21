/**
 * MUSITU Store: private Linux-only, operator-controlled *review evidence*
 * for independently supplied Paynow callback + provider-poll statuses.
 * NO network, payment processing, entitlements, settlement or refund authority.
 *
 * Integrity depends on an operator-owned 0700 directory and external custody
 * of a genuine merchant key, authenticated order and independently polled body.
 * Caller-provided "polled" bytes alone do NOT prove provider transport.
 */
import {createHash} from 'node:crypto';
import {constants as C,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,openSync,
  readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {reconcilePaynowPaymentForReview,verifyPaynowStatusUpdate} from './paynow-review.mjs';

const PREFIX='musitu.store.paynow.review.v1\0';
const SCHEMA='musitu.store.paynow-review-ledger.v1';
const PROVIDER_PREFIX='musitu.store.paynow.provider-claim.v1'+String.fromCharCode(0);
const PROVIDER_SCHEMA='musitu.store.paynow-provider-claim.v1';
const MAX_EVENTS=100;
const NOFOLLOW=C.O_NOFOLLOW??0;
function fail(reason){throw new Error('private Paynow review ledger: '+reason);}
function safeDir(path){
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path.length>2048)
    fail('canonical absolute private directory required');
  let info;
  try{info=lstatSync(path);}catch{fail('private review directory not provisioned');}
  if(!info.isDirectory()||(info.mode&0o077)!==0||
     typeof process.getuid!=='function'||info.uid!==process.getuid()||realpathSync(path)!==path)
    fail('unsafe or non-private owner-controlled directory');
}
function fileCheck(fd){
  const info=fstatSync(fd);
  if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||
     info.uid!==process.getuid()||info.size>64*1024)
    fail('unsafe review ledger file, ownership or permissions');
}
function readState(path,merchantReference){
  // existsSync follows symlinks: dangling links look missing and could reset
  // an existing order's trusted review history. Inspect the directory entry.
  let entry;
  try{entry=lstatSync(path);}catch(err){
    if(err.code==='ENOENT')return null;
    fail('cannot inspect existing private review ledger');
  }
  if(!entry.isFile()||entry.isSymbolicLink())
    fail('unsafe or symlinked private review ledger');
  let fd;
  try{fd=openSync(path,C.O_RDONLY|NOFOLLOW);}catch{fail('unsafe or symlinked review ledger');}
  try{
    fileCheck(fd);
    const raw=readFileSync(fd,'utf8');
    let state;
    try{state=JSON.parse(raw);}catch{fail('corrupt private review ledger');}
    if(!state||Object.getPrototypeOf(state)!==Object.prototype||
       JSON.stringify(state)+'\n'!==raw||
       state.schema!==SCHEMA||state.merchantReference!==merchantReference||
       !/^[A-Za-z0-9_-]{3,80}$/.test(state.providerReference??'')||
       !Array.isArray(state.events)||state.events.length<1||state.events.length>MAX_EVENTS||
       state.entitlementGranted!==false||state.publisherSettlementAuthorized!==false||
       state.refundFinalized!==false||typeof state.manualReviewLocked!=='boolean')
      fail('invalid or noncanonical private review ledger');
    for(const event of state.events){
      if(!event||!/^[0-9a-f]{64}$/.test(event.digest??'')||
         !['Paid','Refunded','Disputed','Cancelled','Awaiting Delivery','Delivered','Created','Sent'].includes(event.providerStatus)||
         !['PAYMENT_CONFIRMED_REVIEW_REQUIRED','PAYMENT_HOLD_REVIEW_REQUIRED'].includes(event.outcome))
        fail('corrupt private review event');
      if(event.providerStatus!=='Paid'&&event.outcome==='PAYMENT_CONFIRMED_REVIEW_REQUIRED')
        fail('historical non-Paid provider event cannot claim confirmed review');
      if(event.outcome==='PAYMENT_HOLD_REVIEW_REQUIRED'&&state.manualReviewLocked===false)
        fail('historical hold cannot have its manual review lock cleared');
    }
    if(new Set(state.events.map(e=>e.digest)).size!==state.events.length)
      fail('duplicate stored private review event');
    return state;
  }finally{closeSync(fd);}
}
/**
 * Immutable cross-order claim. Created *before* a review journal is
 * published: a crash can strand this marker, which must fail closed.
 * Concurrent orders with the same provider reference race on O_EXCL and
 * only one can create the claim. No external provider access is performed.
 */
function providerClaimPath(directory,providerReference){
  const key=createHash('sha256').update(PROVIDER_PREFIX+providerReference).digest('hex');
  return join(directory,'provider-'+key+'.json');
}
function readProviderClaim(path,providerReference){
  let entry;
  try{entry=lstatSync(path);}catch(err){
    if(err.code==='ENOENT')return null;
    fail('cannot inspect provider transaction claim');
  }
  if(!entry.isFile()||entry.isSymbolicLink())
    fail('unsafe provider transaction claim');
  let fd;
  try{fd=openSync(path,C.O_RDONLY|NOFOLLOW);}catch{fail('unsafe provider transaction claim');}
  try{
    fileCheck(fd);
    const raw=readFileSync(fd,'utf8');
    let claim;
    try{claim=JSON.parse(raw);}catch{fail('corrupt provider transaction claim');}
    if(!claim||Object.getPrototypeOf(claim)!==Object.prototype||
       JSON.stringify(claim)+String.fromCharCode(10)!==raw||
       claim.schema!==PROVIDER_SCHEMA||
       claim.providerReference!==providerReference||
       typeof claim.merchantReference!=='string'||
       !/^[A-Za-z0-9_-]{3,80}$/.test(claim.merchantReference))
      fail('corrupt or untrusted provider transaction claim');
    return claim;
  }finally{closeSync(fd);}
}
function reserveProviderReference(directory,providerReference,merchantReference,existingOrder){
  const claimPath=providerClaimPath(directory,providerReference);
  const prior=readProviderClaim(claimPath,providerReference);
  if(prior){
    if(prior.merchantReference!==merchantReference)
      fail('provider transaction already claimed by another merchant order');
    if(!existingOrder)
      fail('provider claim without order history requires independent operator recovery');
    return;
  }
  const claim={schema:PROVIDER_SCHEMA,providerReference,merchantReference};
  let fd;
  try{fd=openSync(claimPath,C.O_WRONLY|C.O_CREAT|C.O_EXCL|NOFOLLOW,0o600);}
  catch{fail('concurrent or unsafe provider transaction claim; manual review required');}
  try{
    fileCheck(fd);
    writeFileSync(fd,JSON.stringify(claim)+String.fromCharCode(10),'utf8');
    fsyncSync(fd);
  }finally{closeSync(fd);}
  // The immutable provider claim must be durable BEFORE publishing review
  // evidence, so no crash can replay a single paid transaction to two orders.
  fsyncDirectory(directory);
}

function fsyncDirectory(directory){
  const fd=openSync(directory,C.O_RDONLY|C.O_DIRECTORY|NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function digestEvent(callbackBody,polledBody){
  const hash=createHash('sha256').update('musitu-paynow-review-event-v1\0');
  for(const body of [callbackBody,polledBody]){
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(body,'utf8');
    hash.update(String(bytes.length)+':').update(bytes).update('\0');
  }
  return hash.digest('hex');
}
function response(state,reused){
  return Object.freeze({state:'REVIEW_RECORDED_PRIVATE_ONLY',
    merchantReference:state.merchantReference,providerReference:state.providerReference,
    eventCount:state.events.length,reused,manualReviewLocked:state.manualReviewLocked,
    entitlementGranted:false,publisherSettlementAuthorized:false,refundFinalized:false});
}
/**
 * Persist an *operator review trail*, never money movement or access rights.
 * The separate provider poll MUST have been fetched by authenticated, audited
 * external code. Nothing here verifies independent network provenance.
 */
export function recordPaynowReviewEvent({ledgerDirectory,callbackBody,polledBody,integrationKey,order}={}){
  safeDir(ledgerDirectory);
  if(polledBody===undefined||polledBody===null)
    fail('independent verified provider poll required before storing review');
  const compared=reconcilePaynowPaymentForReview({callbackBody,polledBody,integrationKey,order});
  if(compared.state==='AWAITING_INDEPENDENT_PROVIDER_POLL')
    fail('independent provider poll required');
  const polled=verifyPaynowStatusUpdate({body:polledBody,integrationKey,order});
  const key=createHash('sha256').update(PREFIX+compared.merchantReference).digest('hex');
  const path=join(ledgerDirectory,key+'.json');
  const lock=join(ledgerDirectory,key+'.lock');
  const pending=join(ledgerDirectory,key+'.pending');
  let lockFd,pendingFd=null,ownsPending=false;
  try{
    try{lockFd=openSync(lock,C.O_CREAT|C.O_EXCL|C.O_WRONLY|NOFOLLOW,0o600);}
    catch{fail('concurrent or abandoned private review lock needs operator recovery');}
    fileCheck(lockFd);
    if(existsSync(pending))fail('unreviewed pending transaction requires manual recovery');
    const old=readState(path,compared.merchantReference);
    if(old&&old.providerReference!==compared.providerReference)
      fail('conflicting provider transaction identity for existing order');
    reserveProviderReference(ledgerDirectory,compared.providerReference,
      compared.merchantReference,old);
    const digest=digestEvent(callbackBody,polledBody);
    if(old?.events.some(e=>e.digest===digest))return response(old,true);
    if(old?.events.length>=MAX_EVENTS)fail('review journal full: independent operator action required');
    const event={digest,providerStatus:polled.providerStatus,outcome:compared.state};
    const locked=(old?.manualReviewLocked??false)||compared.state!=='PAYMENT_CONFIRMED_REVIEW_REQUIRED';
    const next={schema:SCHEMA,merchantReference:compared.merchantReference,
      providerReference:compared.providerReference,
      events:[...(old?.events??[]),event],manualReviewLocked:locked,
      entitlementGranted:false,publisherSettlementAuthorized:false,refundFinalized:false};
    pendingFd=openSync(pending,C.O_CREAT|C.O_EXCL|C.O_WRONLY|NOFOLLOW,0o600);
    ownsPending=true;fileCheck(pendingFd);
    writeFileSync(pendingFd,JSON.stringify(next)+'\n','utf8');
    fsyncSync(pendingFd);closeSync(pendingFd);pendingFd=null;
    renameSync(pending,path);ownsPending=false;
    fsyncDirectory(ledgerDirectory);
    return response(next,false);
  }finally{
    if(pendingFd!==null)closeSync(pendingFd);
    if(ownsPending){try{unlinkSync(pending);}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(lockFd!==undefined){closeSync(lockFd);unlinkSync(lock);}
  }
}

/**
 * Read-only, local consistency audit for migration triage. No auto-repair:
 * unclaimed legacy ledgers, orphaned provider claims, or interrupted writes
 * must be independently reconciled by an authorized financial operator.
 * This does not inspect external backups, prove live provider settlement or
 * turn a review event into a customer entitlement.
 */
function readAuditMetadata(path){
  let fd;
  try{fd=openSync(path,C.O_RDONLY|NOFOLLOW);}
  catch{fail('unsafe review audit file');}
  try{
    fileCheck(fd);
    let parsed;
    try{parsed=JSON.parse(readFileSync(fd,'utf8'));}
    catch{fail('corrupt review audit file');}
    if(!parsed||Object.getPrototypeOf(parsed)!==Object.prototype)
      fail('invalid review audit metadata');
    return parsed;
  }finally{closeSync(fd);}
}
export function auditPaynowReviewDirectory({ledgerDirectory}={}){
  safeDir(ledgerDirectory);
  const entries=readdirSync(ledgerDirectory);
  if(entries.length>10000)fail('review audit directory exceeds safety limit');
  const orders=new Map();
  const providers=new Map();
  for(const name of entries){
    if(!/^(?:provider-)?[0-9a-f]{64}\.json$/.test(name))
      fail('unknown, pending, locked or unsafe file in review audit directory');
    const path=join(ledgerDirectory,name);
    const raw=readAuditMetadata(path);
    if(name.startsWith('provider-')){
      const ref=raw.providerReference;
      if(typeof ref!=='string'||!/^[A-Za-z0-9_-]{3,80}$/.test(ref)||
         path!==providerClaimPath(ledgerDirectory,ref))
        fail('provider claim has invalid hashed filename or identity');
      const claim=readProviderClaim(path,ref);
      if(providers.has(ref))fail('duplicate provider claim in review audit');
      providers.set(ref,claim);
    }else{
      const merchantRef=raw.merchantReference;
      if(typeof merchantRef!=='string'||!/^[A-Za-z0-9_-]{3,80}$/.test(merchantRef)||
        path!==join(ledgerDirectory,createHash('sha256').update(PREFIX+merchantRef).digest('hex')+'.json'))
        fail('review journal has invalid hashed filename or identity');
      const state=readState(path,merchantRef);
      if(!state||orders.has(merchantRef))fail('duplicate or missing review journal');
      orders.set(merchantRef,state);
    }
  }
  if(orders.size!==providers.size)fail('orphaned provider claim or unclaimed order review journal');
  let manualReviewLocked=0;
  for(const [merchantRef,state] of orders){
    const claim=providers.get(state.providerReference);
    if(!claim||claim.merchantReference!==merchantRef)
      fail('missing or mismatched provider transaction claim in review audit');
    if(state.manualReviewLocked)manualReviewLocked++;
  }
  for(const [providerRef,claim] of providers){
    const journal=orders.get(claim.merchantReference);
    if(!journal||journal.providerReference!==providerRef)
      fail('orphaned or conflicting provider transaction ownership claim');
  }
  return Object.freeze({
    state:'OFFLINE_REVIEW_AUDIT_ONLY',orders:orders.size,
    providerClaims:providers.size,manualReviewLocked,
    entitlementGranted:false,publisherSettlementAuthorized:false,
    refundFinalized:false
  });
}

/**
 * Offline, internal-only Store V2 structural screening evidence coordinator.
 * Does NOT own a network endpoint, secrets, role issuance, malware verdict,
 * Android signature decision, rights approval, commerce or release authority.
 * Caller provides a separately authenticated, independently verified human
 * reviewer and current revocation/status verifier. All positive outcomes stay
 * STRUCTURAL_PREFLIGHT_ONLY in a private append-only journal.
 */
import {createHash} from 'node:crypto';
const SHA=/^[a-f0-9]{64}$/;
const ID=/^sub-[a-f0-9]{32}$/;
const KEY=/^private\/apk\/[0-9a-f]{48}$/;
const SUBJECT=/^[A-Za-z0-9_-]{6,120}$/;
const PUB=/^[a-z][a-z0-9-]{2,63}$/;
const DENIED=Object.freeze({signatureVerified:false,malwareCleared:false,
 publicationAuthorized:false,publisherApproved:false,paymentAuthorized:false,
 entitlementGranted:false,payoutAuthorized:false});
export async function runPrivateStructuralPreflight({repository,inspector,isAuthorized,submissionId,actor}={}){
 if(!repository||typeof repository.readQuarantineReceipt!=='function'||
    typeof repository.recordStructuralCheck!=='function'||
    !inspector||typeof inspector.inspect!=='function'||
    typeof isAuthorized!=='function')throw Error('trusted private inspection and authentication required');
 if(typeof submissionId!=='string'||!ID.test(submissionId)||
    !actor||actor.role!=='review_security'||typeof actor.subject!=='string'||
    !SUBJECT.test(actor.subject)||typeof actor.tokenId!=='string'||
    !/^[A-Za-z0-9_-]{12,200}$/.test(actor.tokenId)||
    typeof actor.issuer!=='string'||!/^https:\/\/[^\s]{5,250}$/.test(actor.issuer)||
    typeof actor.audience!=='string'||actor.audience.length<5||actor.audience.length>120||
    !Number.isSafeInteger(actor.expiresAt)||actor.expiresAt<=0)
   throw Error('independent security reviewer role required');
 // Authority is time-of-use, not a cached JWT signature or an untrusted
 // applicant-supplied reviewer role. No raw object read before this decision.
 const active=await isAuthorized({subject:actor.subject,role:actor.role,tokenId:actor.tokenId,
    issuer:actor.issuer,audience:actor.audience,expiresAt:actor.expiresAt});
 if(active!==true)throw Error('reviewer authentication or revocation check denied');
 const rec=await repository.readQuarantineReceipt(submissionId);
 if(!rec||rec.submissionId!==submissionId||!PUB.test(rec.publisherId||'')||
    !SUBJECT.test(rec.actorId||'')||!SHA.test(rec.apkSha256||'')||
    !Number.isSafeInteger(rec.apkBytes)||rec.apkBytes<22||rec.apkBytes>512*1024*1024||
    typeof rec.storageKey!=='string'||!KEY.test(rec.storageKey))
  throw Error('missing or mismatched immutable quarantine manifest');
 if(rec.actorId===actor.subject)throw Error('independent human self-review prohibited');
 const result=await inspector.inspect(rec.storageKey,{expectedSha256:rec.apkSha256,expectedBytes:rec.apkBytes});
 if(result?.status!=='STRUCTURAL_PREFLIGHT_ONLY'||
    !Number.isSafeInteger(result.entryCount)||result.entryCount<2||result.entryCount>4096||
    !Number.isSafeInteger(result.declaredExpandedBytes)||result.declaredExpandedBytes<0||
    result.declaredExpandedBytes>2*1024*1024*1024||
    Object.entries(DENIED).some(([k,v])=>result[k]!==undefined&&result[k]!==v))
  throw Error('structural inspector result is not authoritative or fail-closed');
 const evidence={schema:'musitu.store.private-apk-structural-preflight.v1',
   submissionId,publisherId:rec.publisherId,apkSha256:rec.apkSha256,
   apkBytes:rec.apkBytes,storageKey:rec.storageKey,
   inspectorSubject:actor.subject,inspectorTokenId:actor.tokenId,
   inspectorIssuer:actor.issuer,inspectorAudience:actor.audience,inspectorExpiresAt:actor.expiresAt,
   entryCount:result.entryCount,
   expandedBytes:result.declaredExpandedBytes,status:'STRUCTURAL_PREFLIGHT_ONLY'};
 const evidenceSha256=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
 // Revalidate at the evidence-commit boundary: the reviewer may be revoked
 // during a long private inspection. The SQL INSERT independently enforces
 // current enrolled-role and session status in the same DB transaction.
 if(await isAuthorized({subject:actor.subject,role:actor.role,tokenId:actor.tokenId,
    issuer:actor.issuer,audience:actor.audience,expiresAt:actor.expiresAt})!==true)
  throw Error('reviewer session revoked before structural evidence commit');
 const stored=await repository.recordStructuralCheck({...evidence,evidenceSha256});
 if(stored?.kind!=='created')throw Error('structural evidence record conflict or storage failure');
 return Object.freeze({status:'STRUCTURAL_PREFLIGHT_ONLY',entryCount:result.entryCount,
  declaredExpandedBytes:result.declaredExpandedBytes,...DENIED});
}

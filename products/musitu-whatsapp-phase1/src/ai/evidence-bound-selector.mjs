/**
 * PRIVATE OFFLINE CANDIDATE: constrained selection from tenant-qualified,
 * owner-approved facts. Model responses NEVER become drafted answer text.
 * This module performs no network calls, queue writes, sends or tool actions.
 * Any non-exact match requires human review; it cannot authorize a bot send.
 * Caller owns provider authentication, model approvals and data privacy policy.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDOVER=Object.freeze({status:'HANDOVER_REQUIRED',sourceFaqId:null,body:null,requiresHumanReview:true});
const normalize=text=>text.toLowerCase().replace(/\s+/g,' ').trim();
const invalid=reason=>{throw new Error(reason);};
export async function selectEvidenceBoundReply({tenantId,question,approvedFaqs,provider}={}){
 if(typeof tenantId!=='string'||!UUID.test(tenantId)||typeof question!=='string'||!question.trim()||
  question.length>4000||!Array.isArray(approvedFaqs)||approvedFaqs.length>30||
  typeof provider?.propose!=='function')invalid('INPUT_BOUNDARY');
 const candidates=[];const unique=new Set();
 for(const faq of approvedFaqs){
  if(faq?.tenantId!==tenantId)invalid('TENANT_SOURCE_MISMATCH');
  if(typeof faq.faqId!=='string'||faq.faqId.length>160||!faq.faqId||
     typeof faq.question!=='string'||!faq.question.trim()||faq.question.length>1000||
     typeof faq.answer!=='string'||!faq.answer.trim()||faq.answer.length>4000||
     unique.has(faq.faqId))invalid('INPUT_BOUNDARY');
  unique.add(faq.faqId);
  if(faq.approved!==true)continue;
  candidates.push({faqId:faq.faqId,question:faq.question,answer:faq.answer});
 }
 if(!candidates.length)return {...HANDOVER};
 let suggestion;
 try{
  // No tool/channel action is offered to the model. Only an owner-approved
  // FAQ identifier is accepted as output, never free-text response content.
  suggestion=await provider.propose({question,candidates});
 }catch{return {...HANDOVER};}
 if(!suggestion||typeof suggestion!=='object'||Array.isArray(suggestion)||
    Object.keys(suggestion).some(x=>!['action','faqId','content'].includes(x)))return {...HANDOVER};
 if(suggestion.action!=='ANSWER'||typeof suggestion.faqId!=='string')return {...HANDOVER};
 const selected=candidates.find(x=>x.faqId===suggestion.faqId);
 if(!selected)return {...HANDOVER};
 const exact=normalize(question)===normalize(selected.question);
 return {status:exact?'DRAFT':'HUMAN_REVIEW_REQUIRED',sourceFaqId:selected.faqId,
  body:selected.answer,requiresHumanReview:!exact};
}

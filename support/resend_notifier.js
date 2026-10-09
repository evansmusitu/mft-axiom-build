// Resend operator notifications: opt-in, metadata-only, fail-closed.
const NID = /^AXN-[0-9A-HJKMNP-TV-Z]{16}$/;
const CID = /^AX-[0-9A-HJKMNP-TV-Z]{12}$/;
const KIND = /^[A-Z][A-Z0-9_]{2,79}$/;
const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_\u0060{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export async function deliverResendOperatorAlert(notification, env = {}) {
  if (String(env.SUPPORT_RESEND_OPERATOR_READY || '').toLowerCase() !== 'true')
    return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  const id=String(notification?.notification_id||''), cid=String(notification?.case_id||''), kind=String(notification?.kind||'');
  if (!NID.test(id)||!CID.test(cid)||!KIND.test(kind))throw new TypeError('invalid operator notification metadata');
  const key=String(env.SUPPORT_RESEND_API_KEY||'').trim();
  const sender=String(env.SUPPORT_RESEND_FROM||'').trim().toLowerCase();
  const recipients=String(env.SUPPORT_RESEND_OPERATOR_TO||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if (!/^re_[a-z0-9_-]{12,}$/i.test(key)||sender!=='support@mftintelligence.com'||recipients.length<1||recipients.length>2||recipients.some(x=>!EMAIL.test(x))||new Set(recipients).size!==recipients.length)
    return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  let mappings;
  try{mappings=JSON.parse(String(env.SUPPORT_OPERATOR_BINDINGS_JSON||''));}
  catch{return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});}
  if (!mappings||typeof mappings!=='object'||recipients.some(x=>!mappings[x]||mappings[x].role!=='support_agent'||!String(mappings[x].actor_ref||'').startsWith('support_agent:')))
    return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  const fetchImpl=env.ENVIRONMENT!=='production'&&typeof env.SUPPORT_RESEND_FETCH==='function'?env.SUPPORT_RESEND_FETCH:fetch;
  const message={
    from:'MUSITU Axiom Support <support@mftintelligence.com>',
    to:recipients,
    subject:'MUSITU Axiom Support · '+kind.replace(/_/g,' '),
    text:'Case '+cid+'\nEvent '+kind+'\nOpen Support Operations: https://support-ops.mftintelligence.com/\n\nThis alert contains case metadata only.'
  };
  let response;
  try{
    response=await fetchImpl('https://api.resend.com/emails',{
      method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'axiom-support-'+id},
      body:JSON.stringify(message),signal:AbortSignal.timeout(15000)
    });
  }catch{return Object.freeze({delivered:false,reason:'DELIVERY_FAILED'});}
  if (![200,201,202].includes(response?.status))return Object.freeze({delivered:false,reason:'DELIVERY_FAILED'});
  let result;
  try{result=await response.json();}catch{return Object.freeze({delivered:false,reason:'DELIVERY_FAILED'});}
  if(!/^[a-z0-9-]{10,}$/i.test(String(result?.id||'')))return Object.freeze({delivered:false,reason:'DELIVERY_FAILED'});
  return Object.freeze({delivered:true,receipt_id:String(result.id)});
}
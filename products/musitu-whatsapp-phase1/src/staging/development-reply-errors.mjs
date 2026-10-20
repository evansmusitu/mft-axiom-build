// Fixed public reasons only. Never forward provider messages, tokens, payloads,
// SQL errors, recipient identifiers or arbitrary exception text to the browser.
const failures=Object.freeze({
 META_CREDENTIAL_REJECTED:[503,'Meta rejected the messaging credential. An administrator must renew it before another send. No reply was sent.'],
 META_ACCESS_DENIED:[503,'Meta denied access to the test account. An administrator must check its permissions before another send. No reply was sent.'],
 META_APP_ID_REJECTED:[503,'The messaging credential did not pass the MUSITU app check. An administrator must check the integration. No reply was sent.'],
 META_TEST_PHONE_REJECTED:[503,'The test phone could not be verified. An administrator must check the integration. No reply was sent.'],
 DEVELOPMENT_SENDING_DISABLED:[503,'Development sending is unavailable. An administrator must check the test configuration.'],
 CUSTOMER_OPT_OUT:[409,'This conversation is opted out. Explicit renewed consent is required before messaging can resume. No reply was sent.'],
 SESSION_WINDOW_CLOSED:[409,'The customer-service reply window is closed or the selected message is no longer current. Refresh the conversation before reviewing a reply.'],
 DEVELOPMENT_REPLY_CONFLICT:[409,'A reply attempt already exists for this incoming message. Check its status before taking another action.'],
 DEVELOPMENT_UNCERTAIN_ATTEMPT:[409,'An earlier reply has an uncertain outcome. Do not send again; reconciliation is required.']
});
export function publicDevelopmentReplyFailure(error){
 const code=error?.message;
 if(typeof code!=='string'||!Object.hasOwn(failures,code))return null;
 return {status:failures[code][0],body:{error:code}};
}
export function developmentReplyFailureNotice(code){
 return typeof code==='string'&&Object.hasOwn(failures,code)?failures[code][1]:'Reply was denied or its outcome is unavailable. Check reply status before taking another action.';
}

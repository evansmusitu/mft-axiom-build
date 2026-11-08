/** Reviewed operator replacement only. No network, credentials or writes. */
export function validateReceiverCallback(value){
 let url;try{url=new URL(value);}catch{}
 if(typeof value!=='string'||value.length>512||!url||url.href!==value||url.protocol!=='https:'||!/^musitu-whatsapp-meta-receiver-20261015-[a-z0-9]+-evansmusitu\.vercel\.app$/.test(url.hostname)||url.pathname!=='/api/meta/webhook'||url.search||url.hash||url.username||url.password||url.port)throw Error('ISOLATED_CALLBACK_REQUIRED');
 return value;
}
export function assertExpectedReceiverSubscription({subscriptions,target,expectedPrevious}={}){
 validateReceiverCallback(target);validateReceiverCallback(expectedPrevious);
 if(!Array.isArray(subscriptions)||subscriptions.length>50)throw Error('UNEXPECTED_EXISTING_APP_CALLBACK');
 const existing=subscriptions.filter(x=>x?.object==='whatsapp_business_account');
 if(existing.length!==1||existing[0].active!==true||![target,expectedPrevious].includes(existing[0].callback_url)||!Array.isArray(existing[0].fields)||existing[0].fields.length!==1||(typeof existing[0].fields[0]==='string'?existing[0].fields[0]:existing[0].fields[0]?.name)!=='messages')throw Error('UNEXPECTED_EXISTING_APP_CALLBACK');
 return existing[0].callback_url!==target;
}

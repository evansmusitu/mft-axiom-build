export function configuration(env){
 const address=String(env.MMF_MAILBOX_ADDRESS||"").toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{0,63}@mftintelligence\.com$/.test(address)||!env.MMF_DB||!env.MMF_RAW||!env.MMF_OWNER_EMAIL||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.MMF_ACCESS_ISSUER||"")||!env.MMF_ACCESS_AUD)throw Error("CONFIG_REQUIRED");
 const origin=String(env.MMF_ORIGIN||"");if(!/^https:\/\/[a-z0-9-]+\.mftintelligence\.com$/.test(origin))throw Error("ORIGIN_REQUIRED");
 return {address,origin,owner:String(env.MMF_OWNER_EMAIL).toLowerCase(),issuer:env.MMF_ACCESS_ISSUER,aud:env.MMF_ACCESS_AUD,send:env.MMF_SEND_ENABLED==="true",receive:env.MMF_RECEIVE_ENABLED==="true",productionRoute:env.MMF_EXISTING_ROUTE_APPROVED==="true",forward:env.MMF_FORWARD_TO||""}
}
export function authorizeClaims(payload,c,now=Math.floor(Date.now()/1000)){
 return !!payload&&payload.iss===c.issuer&&(Array.isArray(payload.aud)?payload.aud.includes(c.aud):payload.aud===c.aud)&&typeof payload.email==="string"&&payload.email.toLowerCase()===c.owner&&Number.isFinite(payload.exp)&&payload.exp>now&&Number.isFinite(payload.iat)&&payload.iat<=now+60&&payload.iat>=now-86400&&(!payload.nbf||payload.nbf<=now)
}
export function validRecipient(s){return typeof s==="string"&&s.length<=254&&/^[^\s@,;<>]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)}
export function validateDraft(d){if(!d||typeof d!=="object"||typeof d.to!=="string"||d.to.length>254||typeof d.subject!=="string"||d.subject.length>300||/[\r\n]/.test(d.subject)||typeof d.body!=="string"||d.body.length>100000)throw Error("INVALID_DRAFT");return {to:d.to.trim(),subject:d.subject,body:d.body}}
export function canReceive(c,to){return c.receive&&String(to).toLowerCase()===c.address&&(c.address==="mail-pilot@mftintelligence.com"||(c.productionRoute&&validRecipient(c.forward)&&c.forward.toLowerCase()!==c.address))}
export function canMutate(req,c){return req.headers.get("origin")===c.origin&&req.headers.get("x-mmf-action")==="1"&&req.headers.get("content-type")?.split(";")[0]==="application/json"}
export function canSend(c,d){return c.send&&validRecipient(d.to)&&typeof d.subject==="string"&&d.subject.trim().length>0&&typeof d.body==="string"&&d.body.trim().length>0}
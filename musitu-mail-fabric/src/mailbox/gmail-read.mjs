// Server only: obtain the access token from the authenticated user's isolated OAuth session. Never import in the browser.
export function createGmailReadAdapter({accessToken,fetchImpl=fetch}){
 if(typeof accessToken!=="string"||!accessToken||/[\s\x00-\x1f]/.test(accessToken))throw Error("GMAIL_TOKEN_REQUIRED");
 const base="https://gmail.googleapis.com/gmail/v1/users/me/messages";
 const url=(path,pairs)=>base+path+"?"+pairs.map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&");
 async function read(u){let response;try{response=await fetchImpl(u,{method:"GET",headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"},redirect:"error",cache:"no-store"})}catch{throw Error("GMAIL_NETWORK_ERROR")}if(!response.ok)throw Error(response.status===401?"GMAIL_REAUTH_REQUIRED":response.status===403?"GMAIL_ACCESS_DENIED":response.status===429?"GMAIL_RATE_LIMITED":"GMAIL_REQUEST_FAILED");try{return await response.json()}catch{throw Error("GMAIL_RESPONSE_INVALID")}}
 const validId=id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 return Object.freeze({
 async list({folder="inbox",query="",pageToken="",limit=25}={}){
  const labels={inbox:"INBOX",starred:"STARRED",sent:"SENT",drafts:"DRAFT",trash:"TRASH",all:null};
  if(!Object.prototype.hasOwnProperty.call(labels,folder)||typeof query!=="string"||query.length>1000||typeof pageToken!=="string"||pageToken.length>2048||!Number.isInteger(limit)||limit<1||limit>50)throw Error("GMAIL_LIST_INPUT_INVALID");
  const p=[["maxResults",String(limit)]];if(labels[folder])p.push(["labelIds",labels[folder]]);if(folder==="trash")p.push(["includeSpamTrash","true"]);if(query)p.push(["q",query]);if(pageToken)p.push(["pageToken",pageToken]);
  const d=await read(url("",p));if(!d||typeof d!=="object"||(d.messages!==undefined&&!Array.isArray(d.messages)))throw Error("GMAIL_RESPONSE_INVALID");const messages=d.messages??[];if(messages.length>limit||messages.some(m=>!validId(m?.id)))throw Error("GMAIL_RESPONSE_INVALID");return {messages:messages.map(m=>({id:m.id,threadId:typeof m.threadId==="string"?m.threadId:null})),nextPageToken:typeof d.nextPageToken==="string"?d.nextPageToken:null};
 },
 async getMetadata(id){
  if(!validId(id))throw Error("GMAIL_MESSAGE_ID_INVALID");
  const p=[["format","metadata"],...["From","To","Subject","Date"].map(h=>["metadataHeaders",h])];
  const d=await read(url("/"+id,p));if(d?.id!==id||!Array.isArray(d.payload?.headers))throw Error("GMAIL_RESPONSE_INVALID");
  const get=name=>{const value=d.payload.headers.find(h=>typeof h?.name==="string"&&h.name.toLowerCase()===name.toLowerCase())?.value;return typeof value==="string"?value:""};
  return {id,from:get("From"),to:get("To"),subject:get("Subject"),date:get("Date"),snippet:typeof d.snippet==="string"?d.snippet:"",labels:Array.isArray(d.labelIds)?d.labelIds.filter(x=>typeof x==="string"):[]};
 }
 })
}

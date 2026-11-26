import test from 'node:test';
import {createGmailReadAdapter} from '../src/mailbox/gmail-read.mjs';
async function runGmailChecks(createGmailReadAdapter){
 const calls=[];let code=200;const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:code===200,status:code,json:async()=>url.includes("/abc?")?{id:"abc",payload:{headers:[{name:"Subject",value:"Sample"}]},labelIds:["INBOX"]}:{messages:[{id:"abc",threadId:"def"}],nextPageToken:"next"}}};
 const assert=(x,m)=>{if(!x)throw Error(m)};const rejects=async(f,m)=>{let e;try{await f()}catch(err){e=err.message}assert(e===m,"Expected "+m+", got "+e)};
 const a=createGmailReadAdapter({accessToken:"test-token",fetchImpl});
 const r=await a.list({query:"from:example.invalid",folder:"trash",limit:10});assert(r.messages[0].id==="abc"&&r.nextPageToken==="next"&&calls[0].url.includes("q=from%3Aexample.invalid")&&calls[0].url.includes("includeSpamTrash=true"),"list mapping");
 assert(calls[0].options.method==="GET"&&calls[0].options.redirect==="error"&&calls[0].options.headers.Authorization==="Bearer test-token","read boundary");
 assert((await a.getMetadata("abc")).subject==="Sample","metadata");
 await rejects(()=>a.getMetadata("../wrong"),"GMAIL_MESSAGE_ID_INVALID");await rejects(()=>a.list({limit:51}),"GMAIL_LIST_INPUT_INVALID");assert(calls.length===2,"invalid requests must not fetch");
 code=401;await rejects(()=>a.list(),"GMAIL_REAUTH_REQUIRED");code=429;await rejects(()=>a.list(),"GMAIL_RATE_LIMITED");
 return ["list mapping","GET-only auth boundary","metadata mapping","invalid input blocked","401 reauth","429 rate limit"];
}
test('read-only Gmail adapter with mocked provider',async()=>{console.log(await runGmailChecks(createGmailReadAdapter));});

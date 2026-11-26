import test from 'node:test';
import {createMailbox} from '../src/mailbox/model.mjs';
function runChecks(createMailbox){
 const assert=(x,m)=>{if(!x)throw Error(m)};const throws=(f,m)=>{let error;try{f()}catch(e){error=e.message}assert(error===m,`expected ${m}, got ${error}`)};let seq=0;
 const create=()=>createMailbox([{id:"a",folder:"inbox",from:"Alice",to:"demo@example.invalid",subject:"Hello",body:"project launch",date:"2026-11-26T10:00:00Z",read:false,starred:false}],()=>`d${++seq}`,()=>"2026-11-26T11:00:00Z");
 const cases=[
 ["search and isolated copies",()=>{const x=create();assert(x.list("inbox","launch").length===1,"search");assert(x.list("inbox","nothing").length===0,"nonmatch");x.get("a").subject="changed";assert(x.get("a").subject==="Hello","copy")}],
 ["read and star",()=>{const x=create();x.markRead("a");x.star("a");assert(x.get("a").read&&x.list("starred").length===1,"flags");x.star("a");assert(x.list("starred").length===0,"unstar")}],
 ["archive and restore",()=>{const x=create();x.move("a","archive");assert(x.list("inbox").length===0&&x.list("archive").length===1,"archive");x.move("a","trash");x.move("a","inbox");assert(x.list("archive").length===1,"restore original")}],
 ["draft and simulated send",()=>{const x=create();let d=x.saveDraft({to:"person@example.invalid",subject:"Test",body:"Hi"});x.saveDraft({to:d.to,subject:"Updated",body:"New"},d.id);assert(x.list("drafts").length===1,"draft update");assert(x.simulateSend(d.id).simulated===true&&x.list("sent").length===1,"simulation");throws(()=>x.simulateSend(d.id),"NOT_DRAFT")}],
 ["invalid send and delete guard",()=>{const x=create();const d=x.saveDraft({to:"bad",subject:"Test",body:""});throws(()=>x.simulateSend(d.id),"INVALID_MESSAGE");throws(()=>x.deleteForever("a"),"TRASH_REQUIRED");x.move("a","trash");x.deleteForever("a");throws(()=>x.get("a"),"MESSAGE_NOT_FOUND")}],
 ["draft trash restore",()=>{const x=create();const d=x.saveDraft({to:"",subject:"",body:""});x.move(d.id,"trash");x.move(d.id,"inbox");assert(x.get(d.id).folder==="drafts","draft recovery")}]
 ];for(const [name,fn] of cases){fn()}return cases.map(([n])=>n)
}
test('mailbox state transitions and validation',()=>{console.log(runChecks(createMailbox));});

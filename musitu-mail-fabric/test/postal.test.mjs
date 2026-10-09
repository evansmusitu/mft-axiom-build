import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostalProvider} from '../src/providers.mjs';

test('Postal transport requires explicit network permission and HTTPS origin',()=>{
 assert.throws(()=>createPostalProvider({apiKey:'demo-secret',baseUrl:'https://mail.example.org'}),/explicit opt-in/);
 assert.throws(()=>createPostalProvider({apiKey:'demo-secret',baseUrl:'http://mail.example.org',allowNetwork:true}),/HTTPS/);
 assert.throws(()=>createPostalProvider({apiKey:'demo-secret',baseUrl:'https://localhost',allowNetwork:true}),/HTTPS/);
});
test('Postal adapter transforms verified API acceptance without leaking raw provider id',async()=>{
 const seen=[];const transport=createPostalProvider({apiKey:'test-postal-server-key',baseUrl:'https://mail.example.org',allowNetwork:true,fetchImpl:async(url,init)=>{
  seen.push({url,init});return {status:200,json:async()=>({status:'success',data:{message_id:'sensitive-id@rp.mail.example.org'}})};
 }});
 const msg={from:'alerts@example.org',to:'member@example.net',subject:'Notice',text:'transaction notice'};
 const result=await transport.send(msg,'stable-idempotency-key');
 assert.equal(result.outcome,'accepted');assert.match(result.providerId,/^postal-[a-f0-9]{64}$/);
 assert.equal(seen[0].url,'https://mail.example.org/api/v1/send/message');
 assert.equal(seen[0].init.headers['X-Server-API-Key'],'test-postal-server-key');
 assert.deepEqual(JSON.parse(seen[0].init.body),{to:['member@example.net'],from:'alerts@example.org',subject:'Notice',plain_body:'transaction notice'});
 assert.equal(JSON.stringify(result).includes('sensitive-id@'),false);
});
test('Postal provider timeout and ambiguous status do not fabricate success',async()=>{
 const provider=createPostalProvider({apiKey:'test-postal-server-key',baseUrl:'https://mail.example.org',allowNetwork:true,fetchImpl:async()=>{throw Error('socket timeout')}});
 assert.equal((await provider.send({to:'a@b.co'},'x')).outcome,'unknown');
 const bad=createPostalProvider({apiKey:'test-postal-server-key',baseUrl:'https://mail.example.org',allowNetwork:true,fetchImpl:async()=>({status:503})});
 assert.equal((await bad.send({to:'a@b.co'},'x')).outcome,'unknown');
});

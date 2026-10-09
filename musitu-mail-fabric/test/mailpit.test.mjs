import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createMailpitTestProvider} from '../src/testing/mailpit-smtp.mjs';

async function smtpFixture({rejectRcpt=false}={}){
 const messages=[];
 const server=createServer(socket=>{
   socket.write('220 mailpit-test ESMTP\r\n');
   let buffer='',mode='command',data=[];
   socket.on('data',b=>{
     buffer+=b.toString('utf8');
     while(buffer.includes('\r\n')){
       const ix=buffer.indexOf('\r\n'),line=buffer.slice(0,ix);buffer=buffer.slice(ix+2);
       if(mode==='data'){
         if(line==='.') {messages.push(data.join('\n'));data=[];mode='command';socket.write('250 queued\r\n');}
         else data.push(line);
       }else if(/^EHLO /i.test(line))socket.write('250-localhost\r\n250 PIPELINING\r\n');
       else if(/^MAIL FROM:/i.test(line))socket.write('250 sender accepted\r\n');
       else if(/^RCPT TO:/i.test(line))socket.write(rejectRcpt?'550 recipient blocked\r\n':'250 recipient accepted\r\n');
       else if(line==='DATA'){mode='data';socket.write('354 end with dot\r\n');}
       else if(line==='QUIT'){socket.write('221 bye\r\n');socket.end();}
       else socket.write('500 command rejected\r\n');
     }
   });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {port:server.address().port,messages,close:async()=>new Promise(resolve=>server.close(resolve))};
}
const email={from:'alerts@example.org',to:'test@example.net',subject:'Proof test',text:'First line\n.\nLast line'};
test('Mailpit test SMTP adapter injects no external connection, submits valid message with dot stuffing',async t=>{
 const f=await smtpFixture();t.after(f.close);
 const adapter=createMailpitTestProvider({host:'127.0.0.1',port:f.port,enabled:true});
 const outcome=await adapter.send(email,'testmail-stable-key');
 assert.equal(outcome.outcome,'accepted');
 assert.equal(f.messages.length,1);assert.match(f.messages[0],/Subject: Proof test/);
 assert.match(f.messages[0],/\.\./);assert.match(f.messages[0],/Last line/);
});
test('Mailpit adapter is disabled by default and never connects to remote domains',async t=>{
 assert.throws(()=>createMailpitTestProvider({host:'smtp.example.net',enabled:true}),/loopback/);
 const f=await smtpFixture();t.after(f.close);
 const p=createMailpitTestProvider({host:'127.0.0.1',port:f.port});
 assert.deepEqual(await p.send(email,'key'),{outcome:'rejected'});
 assert.equal(f.messages.length,0);
});
test('Mailpit SMTP rejection becomes provider rejection',async t=>{
 const f=await smtpFixture({rejectRcpt:true});t.after(f.close);
 const p=createMailpitTestProvider({host:'127.0.0.1',port:f.port,enabled:true});
 const out=await p.send(email,'key');assert.equal(out.outcome,'rejected');
 assert.equal(f.messages.length,0);
});
const liveHost=process.env.MAILPIT_INTEGRATION==='1';
test('optional real Mailpit integration via localhost SMTP+HTTP', {skip:!liveHost},async()=>{
 const p=createMailpitTestProvider({enabled:true,host:'127.0.0.1',port:1025});
 const out=await p.send({...email,subject:'MUSITU mailpit real test '+Date.now()},'real-mailpit-test');
 assert.equal(out.outcome,'accepted');
 const result=await fetch('http://127.0.0.1:8025/api/v1/messages');
 assert.equal(result.status,200);
 const body=await result.text();assert.ok(body.includes('MUSITU mailpit real test'));
});

import {connect} from 'node:net';
/** Loopback-only SMTP test transport; never use as a production external delivery provider. */
export function createMailpitTestProvider({host='127.0.0.1',port=1025,enabled=false,timeoutMs=5000}={}){
  if(!['localhost','127.0.0.1','::1'].includes(host))throw TypeError('Mailpit testing requires loopback only');
  if(!Number.isInteger(port)||port<1||port>65535)throw TypeError('Invalid Mailpit SMTP port');
  return {name:'mailpit-testing-only',region:'us-east-1',async send(message){
    if(!enabled)return {outcome:'rejected'};
    const {from,to,subject,text}=message||{};
    const addr=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
    if(!addr.test(from||'')||!addr.test(to||'')||typeof subject!=='string'||/[\r\n\0]/.test(subject)||typeof text!=='string')return {outcome:'rejected'};
    const socket=connect({host,port}),responses=[];
    let buffered='',current=null,waiter=null,failed=false;
    const release=value=>{if(waiter){const w=waiter;waiter=null;w(value);}else responses.push(value);};
    socket.setTimeout(timeoutMs);
    socket.on('timeout',()=>{failed=true;release(null);socket.destroy();});
    socket.on('error',()=>{failed=true;release(null);});
    socket.on('close',()=>{failed=true;release(null);});
    socket.on('data',raw=>{
      buffered+=raw.toString('utf8');
      while(buffered.includes('\r\n')){
        const i=buffered.indexOf('\r\n'),line=buffered.slice(0,i);buffered=buffered.slice(i+2);
        const m=line.match(/^(\d{3})([- ])(.*)$/);if(!m){failed=true;release(null);socket.destroy();break;}
        if(current!==null&&current!==m[1]){failed=true;release(null);socket.destroy();break;}
        current=m[2]==='-'?m[1]:null;
        if(m[2]===' ')release(Number(m[1]));
      }
    });
    const read=()=>responses.length?Promise.resolve(responses.shift()):failed?Promise.resolve(null):new Promise(resolve=>{waiter=resolve;});
    const command=async text=>{socket.write(text+'\r\n');return read();};
    let accepted=false;
    try{
      if(await read()!==220)return {outcome:'unknown'};
      if(await command('EHLO localhost')!==250)return {outcome:'unknown'};
      if(await command('MAIL FROM:<'+from+'>')!==250)return {outcome:'rejected'};
      const rcpt=await command('RCPT TO:<'+to+'>');if(rcpt!==250)return {outcome:rcpt>=500?'rejected':'unknown'};
      if(await command('DATA')!==354)return {outcome:'unknown'};
      const body=text.replace(/\r?\n/g,'\n').split('\n').map(x=>x.startsWith('.')?'.'+x:x).join('\r\n');
      const payload=`From: <${from}>\r\nTo: <${to}>\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`;
      socket.write(payload);
      const code=await read();accepted=code===250;
      return {outcome:accepted?'accepted':code>=500?'rejected':'unknown'};
    }catch{return {outcome:'unknown'};}
    finally{socket.end();socket.destroy();}
  }};
}

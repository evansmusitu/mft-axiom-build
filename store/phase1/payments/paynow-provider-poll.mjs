/**
 * MUSITU Store V2 — private operator-only independently fetched Paynow status.
 * Paynow specifies an empty HTTP POST to the initiation-origin poll URL:
 * https://developers.paynow.co.zw/docs/paynow/polling_status/
 * No payment creation, auto-entitlement, refund, settlement, consumer API,
 * redirect following, merchant logging, or production exposure is provided.
 */
import {request as httpsRequest} from 'node:https';
import {verifyPaynowStatusUpdate} from './paynow-review.mjs';
import {recordPaynowReviewEvent} from './paynow-review-ledger.mjs';

const MAX_REPLY=12*1024;
const TIMEOUT_MS=8000;
const POLL_PATH=/^\/Interface\/CheckPayment\/\?guid=[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function deny(reason){throw Error('private Paynow provider poll: '+reason);}
function safeEndpoint(urlText){
  if(typeof urlText!=='string'||urlText.length>512)deny('trusted poll URL required');
  let url;try{url=new URL(urlText);}catch{deny('invalid trusted poll URL');}
  if(url.protocol!=='https:'||url.hostname!=='www.paynow.co.zw'||url.port!==''
     ||url.username||url.password||url.hash||url.href!==urlText||
     !POLL_PATH.test(url.pathname+url.search)||
     url.searchParams.size!==1||!url.searchParams.has('guid'))
     deny('untrusted provider poll host or endpoint');
  return url;
}
function requestStatus(url,requestImpl){
  return new Promise((resolve,reject)=>{
    let completed=false;
    let absoluteDeadline=null;
    const finish=(error,bytes)=>{
      if(completed)return;
      completed=true;
      if(absoluteDeadline!==null)clearTimeout(absoluteDeadline);
      if(error)reject(error instanceof Error?error:Error('provider request unavailable'));
      else resolve(bytes);
    };
    let req;
    let responseStarted=false;
    try{
      req=requestImpl(url,{method:'POST',
        headers:{Accept:'application/x-www-form-urlencoded, text/plain',
          'Content-Length':'0'},
        rejectUnauthorized:true,servername:'www.paynow.co.zw'},res=>{
        responseStarted=true;
        if(res.statusCode!==200){
          if(typeof res.resume==='function')res.resume();
          finish(Error('provider HTTP status is not 200; redirects forbidden'));
          return;
        }
        const mime=String(res.headers?.['content-type']??'').split(';')[0].trim().toLowerCase();
        if(mime && mime!=='text/plain'&&mime!=='application/x-www-form-urlencoded'){
          if(typeof res.resume==='function')res.resume();
          finish(Error('provider content-type rejected'));
          return;
        }
        let count=0;
        const chunks=[];
        res.on('error',()=>finish(Error('provider response transport failure')));
        res.on('aborted',()=>finish(Error('provider response aborted')));
        res.on('close',()=>finish(Error('private Paynow provider poll: provider response closed before completion')));
        res.on('data',chunk=>{
          if(completed)return;
          const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
          count+=bytes.length;
          if(count>MAX_REPLY){
            finish(Error('provider response exceeds maximum size'));
            // Not all CI test doubles implement destroy(). Production does.
            if(typeof res.destroy==='function')res.destroy();
            return;
          }
          chunks.push(bytes);
        });
        res.on('end',()=>{
          if(!completed)finish(null,Buffer.concat(chunks));
        });
      });
      if(!req||typeof req.setTimeout!=='function'||typeof req.end!=='function')
        deny('unsupported private HTTPS client');
      req.on('error',()=>finish(Error('provider HTTPS request failed')));
      req.on('close',()=>{
        if(!responseStarted)finish(Error('private Paynow provider poll: provider request closed before completion'));
      });
      req.setTimeout(TIMEOUT_MS,()=>{
        finish(Error('provider HTTPS timeout; review held'));
        if(typeof req.destroy==='function')req.destroy();
      });
      // req.setTimeout() is an idle timeout, not a total wall-clock
      // deadline; a malicious peer can send one byte periodically forever.
      absoluteDeadline=setTimeout(()=>{
        finish(Error('private Paynow provider poll: absolute provider response deadline exceeded'));
        if(typeof req.destroy==='function')req.destroy();
      },TIMEOUT_MS);
      // Critically no POST body, no credentials, no automatic redirect.
      req.end();
    }catch{
      finish(Error('provider HTTPS transport unavailable'));
    }
  });
}
/**
 * The injected requestImpl is only for synthetic CI transport tests.
 * Production uses Node's native authenticated HTTPS request with host
 * and TLS name pinned to Paynow, and must be invoked by a trusted operator.
 */
export async function pollAndRecordPaynowReviewEvent({
  ledgerDirectory,callbackBody,integrationKey,order,requestImpl
}={}){
  if(requestImpl!==undefined&&process.env.CI!=='true')
    deny('mock provider transport is restricted to isolated CI');
  // Validate the callback before any outbound egress. The trusted order
  // and integration key must come from operator custody, never applicants.
  verifyPaynowStatusUpdate({body:callbackBody,integrationKey,order});
  const endpoint=safeEndpoint(order.pollurl);
  const polledBody=await requestStatus(endpoint,requestImpl??httpsRequest);
  // This checks the independently obtained Paynow SHA512 message and
  // writes durable, private REVIEW_ONLY evidence, never access rights.
  return recordPaynowReviewEvent({
    ledgerDirectory,callbackBody,polledBody,integrationKey,order
  });
}

#!/usr/bin/env node
/** Independent, offline trust-chain verifier. No key material or email content is printed. */
import {readFileSync} from 'node:fs';
import {verifyCurrentReceipt} from './transitions.mjs';
const args=process.argv.slice(2);
const flags=['--receipt','--root-key','--transitions','--trusted-head','--tenant'];
if(args.length!==flags.length*2||args.some((v,i)=>i%2===0&&!flags.includes(v))||new Set(args.filter((_,i)=>i%2===0)).size!==flags.length){
 process.stderr.write('REQUIRED: --receipt FILE --root-key FILE --transitions FILE --trusted-head SHA256 --tenant ID\n');process.exit(2);
}
const opts={};for(let i=0;i<args.length;i+=2)opts[args[i]]=args[i+1];
try{
 const proof=JSON.parse(readFileSync(opts['--receipt'],'utf8'));
 const transitions=JSON.parse(readFileSync(opts['--transitions'],'utf8'));
 const rootPublicKey=readFileSync(opts['--root-key'],'utf8');
 if(!verifyCurrentReceipt(proof,{tenantId:opts['--tenant'],rootPublicKey,transitions,trustedHead:opts['--trusted-head']}))throw Error('INVALID_EVIDENCE');
 process.stdout.write('VERIFIED_CURRENT_KEY: signed communication evidence integrity only; no inbox or legal delivery proof\n');
}catch{process.stderr.write('INVALID_OR_UNTRUSTED_EVIDENCE\n');process.exit(1);}

#!/usr/bin/env node
/** Independently verify a MUSITU signed evidence chain against an out-of-band pinned public key. */
import {readFileSync} from 'node:fs';
import {verifyProof} from './evidence.mjs';
const args=process.argv.slice(2);
const value=key=>{const k=args.indexOf(key);return k>=0&&k+1<args.length?args[k+1]:null;};
const receipt=value('--receipt'),pinned=value('--trusted-key');
if(!pinned){process.stderr.write('TRUST_ANCHOR_REQUIRED\n');process.exit(2);}
if(!receipt||args.length!==4||args[0]!=='--receipt'||args[2]!=='--trusted-key'){
 process.stderr.write('USAGE: node src/verify-cli.mjs --receipt receipt.json --trusted-key pinned.pem\n');process.exit(2);
}
try{
 const publicKey=readFileSync(pinned,'utf8');
 const proof=JSON.parse(readFileSync(receipt,'utf8'));
 if(!verifyProof(proof,{trustedPublicKey:publicKey})){process.stderr.write('INVALID_EVIDENCE\n');process.exit(1);}
 process.stdout.write('VERIFIED: signed evidence integrity (not inbox delivery or human reading)\n');
}catch{process.stderr.write('INVALID_EVIDENCE\n');process.exit(1);}

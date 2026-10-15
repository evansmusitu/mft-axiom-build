import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
// Serve no source as static assets. Vercel bundles the api function's imports
// separately; the published static output is deliberately empty.
await mkdir(new URL('../public/',import.meta.url),{recursive:true});
if(process.argv[2])execFileSync(process.execPath,[new URL('./qualify-receiver.mjs',import.meta.url).pathname,process.argv[2]],{stdio:'inherit'});
console.log('MUSITU_INGRESS_BUILD: empty static directory; callback function only');

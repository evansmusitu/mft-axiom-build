import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
// Serve no source as static assets. Vercel bundles the api function's imports
// separately. Vercel requires a nonempty output directory, so the only static
// artifact is a harmless robots exclusion; catch-all routing also denies it.
await mkdir(new URL('../public/',import.meta.url),{recursive:true});
await writeFile(new URL('../public/robots.txt',import.meta.url),'User-agent: *\nDisallow: /\n');
if(process.argv[2]==='--configured')execFileSync(process.execPath,[new URL('./qualify-configured-receiver.mjs',import.meta.url).pathname,process.argv[3]],{stdio:'inherit'});
else if(process.argv[2])execFileSync(process.execPath,[new URL('./qualify-receiver.mjs',import.meta.url).pathname,process.argv[2]],{stdio:'inherit'});
console.log('MUSITU_INGRESS_BUILD: robots-only static directory; callback function only');

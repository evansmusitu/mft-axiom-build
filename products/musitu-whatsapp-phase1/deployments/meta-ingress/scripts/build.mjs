import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {validateReceiverCallback} from './receiver-callback-guard.mjs';
// Serve no source as static assets. Vercel bundles the api function's imports
// separately. Vercel requires a nonempty output directory, so the only static
// artifact is a harmless robots exclusion; catch-all routing also denies it.
await mkdir(new URL('../public/',import.meta.url),{recursive:true});
await writeFile(new URL('../public/robots.txt',import.meta.url),'User-agent: *\nDisallow: /\n');
if(process.argv[2]==='--replace'){
 // Compact reviewed operator command for hosting's bounded build-command field.
 // Only deployment suffixes of this one existing receiver project are allowed.
 const ids=process.argv.slice(3);
 if(ids.length!==2||ids.some(id=>!(/^[a-z0-9]{5,20}$/).test(id)))throw Error('RECEIVER_DEPLOYMENT_IDS_REQUIRED');
 const [target,previous]=ids.map(id=>validateReceiverCallback(`https://musitu-whatsapp-meta-receiver-20261015-${id}-evansmusitu.vercel.app/api/meta/webhook`));
 const run=(name,...args)=>execFileSync(process.execPath,[new URL(name,import.meta.url).pathname,...args],{stdio:'inherit'});
 run('./qualify-configured-receiver.mjs',new URL(target).origin);
 run('./configure-meta-app-webhook.mjs',target,previous);
 run('./read-meta-app-webhook.mjs',target);
}
else if(process.argv[2]==='--configure-meta-webhook')execFileSync(process.execPath,[new URL('./configure-meta-app-webhook.mjs',import.meta.url).pathname,process.argv[3],process.argv[4]],{stdio:'inherit'});
else if(process.argv[2]==='--app-webhook')execFileSync(process.execPath,[new URL('./read-meta-app-webhook.mjs',import.meta.url).pathname,...(process.argv[3]?[process.argv[3]]:[])],{stdio:'inherit'});
else if(process.argv[2]==='--configured')execFileSync(process.execPath,[new URL('./qualify-configured-receiver.mjs',import.meta.url).pathname,process.argv[3]],{stdio:'inherit'});
else if(process.argv[2])execFileSync(process.execPath,[new URL('./qualify-receiver.mjs',import.meta.url).pathname,process.argv[2]],{stdio:'inherit'});
console.log('MUSITU_INGRESS_BUILD: robots-only static directory; callback function only');

import {readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,join} from 'node:path';
import {createHash} from 'node:crypto';

// Explicitly package the callback's import closure. No dashboard, identity
// sessions, environment files, test fixtures or migration credentials ship here.
const root=resolve(import.meta.dirname,'..');
const target=join(root,'deployments/meta-ingress/runtime');
const files=new Map();
async function visit(path){
 const name=relative(root,path);
 if(!name.startsWith('src/')||name.includes('..'))throw Error('INGRESS_SOURCE_OUTSIDE_SRC');
 if(files.has(name))return;
 const body=await readFile(path,'utf8');files.set(name,body);
 for(const match of body.matchAll(/(?:import\s+(?:[^;]*?\s+from\s*)?|export\s+[^;]*?\s+from\s*)['"]([^'"]+)['"]/g)){
  const specifier=match[1];
  if(specifier.startsWith('.'))await visit(resolve(dirname(path),specifier));
  else if(!specifier.startsWith('node:')&&specifier!=='pg')throw Error('INGRESS_DEPENDENCY_NOT_ALLOWED');
 }
 if(/\bimport\s*\(/.test(body))throw Error('INGRESS_DYNAMIC_IMPORT_NOT_ALLOWED');
}
await visit(join(root,'src/staging/meta-ingress.mjs'));
await visit(join(root,'src/adapters/meta-development-http.mjs'));
const expected=[...files].sort(([a],[b])=>a.localeCompare(b));
const manifest=Object.fromEntries(expected.map(([name,body])=>[name,createHash('sha256').update(body).digest('hex')]));
if(process.argv.includes('--check')){
 const found=[];
 async function list(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await list(path);else if(entry.isFile())found.push(relative(target,path));else throw Error('INGRESS_NON_REGULAR_FILE');}}
 await list(target);
 const names=[...files.keys(),'source-digests.json'].sort();
 if(JSON.stringify(found.sort())!==JSON.stringify(names))throw Error('INGRESS_UNEXPECTED_FILE');
 const actual=JSON.parse(await readFile(join(target,'source-digests.json'),'utf8'));
 if(JSON.stringify(actual)!==JSON.stringify(manifest))throw Error('INGRESS_BUNDLE_STALE');
 for(const [name,body] of expected)if(await readFile(join(target,name),'utf8')!==body)throw Error('INGRESS_BUNDLE_STALE');
 console.log('INGRESS_BUNDLE_CURRENT',expected.length);
}else{
 await rm(target,{recursive:true,force:true});
 for(const [name,body] of expected){const to=join(target,name);await mkdir(dirname(to),{recursive:true});await writeFile(to,body);}
 await writeFile(join(target,'source-digests.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('INGRESS_BUNDLE_PREPARED',expected.length);
}

/** Package original modules: import.meta.url-based source commitments retain
 * their original files and native Node 24 TypeScript semantics. No .env copying.
 */
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,copyFileSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const directory=mkdtempSync(join(tmpdir(),'axiom-hosted-pg-bundle-')),assembly=join(directory,'assembly'),output=join(assembly,'index.mjs'),archive=join(directory,'function.zip');
mkdirSync(assembly);
const sources=['qualification/whole-system-20261029/hosted-postgres-function.mjs','reasoning/phase1/src','reasoning/phase1/spec','reasoning/phase1/package.json','reasoning/phase2/src','reasoning/phase2/sql','reasoning/phase2/package.json','reasoning/phase2/package-lock.json','reasoning/phase2/node_modules'];
function copyTree(source,destination){
  if(statSync(source).isDirectory()){mkdirSync(destination,{recursive:true});for(const name of readdirSync(source))copyTree(join(source,name),join(destination,name));}
  else{mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination);}
}
for(const relative of sources)copyTree(join(root,relative),join(assembly,relative));
writeFileSync(output,"export {default} from './qualification/whole-system-20261029/hosted-postgres-function.mjs';\n");
execFileSync('zip',['-q','-X','-r',archive,'.'],{cwd:assembly,stdio:'pipe'});
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const moduleHashes={};
function manifest(path,prefix=''){
  for(const item of readdirSync(path,{withFileTypes:true})){const relative=prefix+item.name;if(item.isDirectory())manifest(join(path,item.name),relative+'/');else moduleHashes[relative]=digest(join(path,item.name));}
}
manifest(assembly);
const result={archive,index:output,source_sha256:digest(join(root,sources[0])),archive_sha256:digest(archive),archive_bytes:readFileSync(archive).byteLength,files:moduleHashes};
writeFileSync(join(directory,'build.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({archive,index:output,source_sha256:result.source_sha256,archive_sha256:result.archive_sha256,archive_bytes:result.archive_bytes,file_count:Object.keys(moduleHashes).length,build_manifest:join(directory,'build.json')}));

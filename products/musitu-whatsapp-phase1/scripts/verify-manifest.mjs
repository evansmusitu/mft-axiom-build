/** Local source integrity verifier. Detects missing, modified AND unlisted
 * executable source. A writable manifest cannot certify provenance alone;
 * validate the outer ZIP digest from a separately trusted record as well.
 */
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,sep,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const entries=readFileSync(resolve(root,'docs/phase1/SOURCE_MANIFEST.sha256'),'utf8').trim().split('\n');
const listed=new Set();
for(const entry of entries){
  const matched=entry.match(/^([0-9a-f]{64})  ([^\n]+)$/);
  if(!matched)throw new Error('MALFORMED_SOURCE_MANIFEST');
  const [,expected,filename]=matched;
  const path=resolve(root,filename);
  if(!path.startsWith(root+sep)||listed.has(filename))throw new Error('SOURCE_PATH_OUT_OF_ROOT_OR_DUPLICATE');
  const actual=createHash('sha256').update(readFileSync(path)).digest('hex');
  if(expected!==actual)throw new Error(`SOURCE_DIGEST_MISMATCH:${filename}`);
  listed.add(filename);
}
function checkComplete(dir){
 for(const item of readdirSync(resolve(root,dir),{withFileTypes:true})){
  const child=join(dir,item.name);
  if(item.name==='__pycache__')continue;
  if(item.isDirectory())checkComplete(child);
  else if(item.isFile()&&!item.name.endsWith('.pyc')){
   if(!listed.has(child))throw new Error(`SOURCE_UNTRACKED_FILE:${child}`);
  }else if(item.isSymbolicLink())throw new Error(`SOURCE_SYMLINK_NOT_ALLOWED:${child}`);
 }
}
for(const sourceRoot of ['src','test','scripts','db','.github','app','public'])checkComplete(sourceRoot);
console.log(`LOCAL_SOURCE_MANIFEST_PASS (${listed.size} tracked files; source tree completeness checked)`);

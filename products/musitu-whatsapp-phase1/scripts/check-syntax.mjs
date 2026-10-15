import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
let count=0;
function inspect(dir){
 for(const item of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,item.name);
  if(item.isDirectory())inspect(path);
  else if(item.isFile()&&item.name.endsWith('.mjs')){
   execFileSync(process.execPath,['--check',path],{stdio:'pipe'});count++;
  }
 }
}
for(const dir of ['src','test','scripts','deployments/meta-ingress/api','deployments/meta-ingress/runtime'])inspect(join(root,dir));
console.log(`ALL_MJS_SYNTAX_PASS (${count} files)`);

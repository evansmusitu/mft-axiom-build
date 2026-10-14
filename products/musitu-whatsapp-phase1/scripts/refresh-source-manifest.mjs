import {readdirSync,readFileSync,writeFileSync}from'node:fs';
import{join,relative,resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),items=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(['node_modules','.next','.git','.vercel','evidence'].includes(e.name)||(e.name.startsWith('.env')&&e.name!=='.env.example')||e.name.startsWith('.private'))continue;const path=join(dir,e.name);if(e.isDirectory())walk(path);else if(e.isFile()&&relative(root,path)!=='docs/phase1/SOURCE_MANIFEST.sha256')items.push(relative(root,path));}}
walk(root);items.sort();writeFileSync(join(root,'docs/phase1/SOURCE_MANIFEST.sha256'),items.map(p=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex')+'  '+p+'\n').join(''));
console.log('SOURCE_MANIFEST_REFRESHED',items.length);

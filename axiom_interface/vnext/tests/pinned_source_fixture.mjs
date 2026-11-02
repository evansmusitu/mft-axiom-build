// Historical deployment evidence is preserved as inert, hash-checked fixtures.
// These checks do not qualify a current account, environment or deployment.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url);
const archive=new URL('qualification/whole-system-20261029/pinned-runtime-fixtures/',root);
const manifest=JSON.parse(fs.readFileSync(new URL('MANIFEST.json',archive),'utf8'));
export function pinnedSource(relative){
  relative=relative.replace(/^(\.\.\/){3}/,'');
  if(Object.hasOwn(manifest.files,relative)){
    const path=new URL(relative,archive),bytes=fs.readFileSync(path);
    if(createHash('sha256').update(bytes).digest('hex')!==manifest.files[relative])throw new Error('historical source fixture integrity mismatch');
    return path;
  }
  return new URL(relative,root);
}

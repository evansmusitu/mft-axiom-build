/** B27 GitHub workflow trust boundary (never an independent custodian signoff). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(fileURLToPath(new URL(p,root)),'utf8');

test('B27 candidate and two-host PR workflows have read-only tokens and nonpersisted checkout',()=>{
  for(const path of ['.github/workflows/axiom-b27-security-authority2-candidate.yml',
    '.github/workflows/axiom-b27-two-host-replay.yml']){
    const source=read(path);
    assert.match(source,/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    assert.doesNotMatch(source,/^\s+(?:contents|id-token|actions|issues|pull-requests):\s*write\s*$/m);
    assert.doesNotMatch(source,/secrets\.|pull_request_target|^\s+push:/m);
    const matches=[...source.matchAll(/^[ ]+- uses: actions\/checkout@[0-9a-f]{40}(?:\s*\n[ ]+with:\s*\n[ ]+persist-credentials:\s*false)?/gm)];
    assert.ok(matches.length>0,path+': no pinned checkout');
    for(const match of matches)assert.match(match[0],/persist-credentials:\s*false/,path+': checkout token must not persist');
  }
});

test('B27 independent administrator and global rollback release veto cannot be mistaken for a green candidate',()=>{
  const source=read('.github/workflows/axiom-b27-security-authority2-candidate.yml');
  assert.match(source,/independent-custody-release-veto:/);
  assert.match(source,/needs:\s*candidate/);
  const block=source.slice(source.indexOf('independent-custody-release-veto:'));
  assert.match(block,/B27_GLOBAL_NONROLLBACK_NOT_YET_PROVEN/);
  assert.match(block,/INDEPENDENT_CUSTODY_AND_SEPARATE_HOST_PROVIDER_ACCEPTANCE_PENDING/);
  assert.match(block,/^\s+exit 1\s*$/m);
});

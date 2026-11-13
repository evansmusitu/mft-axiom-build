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

function assertFatalCustodyVeto(source){
  assert.match(source,/independent-custody-release-veto:/);
  const block=source.slice(source.indexOf('independent-custody-release-veto:'));
  assert.match(block,/needs:\s*candidate/);
  // The same exit 1 could be silently bypassed by an added job-level if
  // or continue-on-error. Reject these waiver forms in the review workflow.
  assert.doesNotMatch(block,/^\s*(?:if|continue-on-error):/m);
  assert.match(block,/B27_GLOBAL_NONROLLBACK_NOT_YET_PROVEN/);
  assert.match(block,/INDEPENDENT_CUSTODY_AND_SEPARATE_HOST_PROVIDER_ACCEPTANCE_PENDING/);
  assert.match(block,/^\s+exit 1\s*$/m);
}
test('B27 independent administrator and global rollback release veto cannot be mistaken for a green candidate',()=>{
 const source=read('.github/workflows/axiom-b27-security-authority2-candidate.yml');
 assertFatalCustodyVeto(source);
});
test('B27 release veto rejects conditional skip, continue-on-error and no-exit mutations',()=>{
 const source=read('.github/workflows/axiom-b27-security-authority2-candidate.yml');
 for(const [label,mutated] of [
  ['skip',source.replace('    needs: candidate','    needs: candidate\n    if: false')],
  ['ignore-errors',source.replace('      - name: Block global B27 release until provider-origin and destructive acceptance',
    '      - name: Block global B27 release until provider-origin and destructive acceptance\n        continue-on-error: true')],
  ['no-exit',source.replace('          exit 1','          echo BYPASS')]
 ]){
  assert.notEqual(mutated,source,label+': negative mutation failed to apply');
  assert.throws(()=>assertFatalCustodyVeto(mutated),undefined,label+': release veto bypass accepted');
 }
});

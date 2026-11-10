import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// This is only a source contract; a real deployment and custody audit are separate gates.
const path=new URL('./wrangler.example.toml',import.meta.url);
const config=readFileSync(path,'utf8');
const value=(key)=>{
  const matches=[...config.matchAll(new RegExp('^\\s*'+key+'\\s*=\\s*([^#\\n]+)','gm'))];
  assert.equal(matches.length,1,'one explicit '+key+' key required');
  return matches[0][1].trim().replace(/^"|"$/g,'');
};
test('candidate Wrangler R2 binding is pinned to independently inventoried A2 bucket',()=>{
  assert.equal(value('bucket_name'),'musitu-axiom-b27-highwater-a2');
  assert.equal(value('binding'),'HIGHWATER_WORM');
});
test('candidate Wrangler cannot implicitly publish workers.dev or previews',()=>{
  assert.equal(value('workers_dev'),'false');
  assert.equal(value('preview_urls'),'false');
  assert.doesNotMatch(config,/^\\s*(route|routes)\\s*=/m);
});
test('candidate Wrangler uses the observed A2 account rather than production OAuth',()=>{
  assert.equal(value('account_id'),'67469478aa9349fa0a57fe3a72da200a');
});
test('candidate Wrangler retains missing-secrets and independent custodian release veto',()=>{
  assert.match(config,/NO activation\/bootstrap endpoint/);
  assert.match(config,/NOT satisfied/);
});

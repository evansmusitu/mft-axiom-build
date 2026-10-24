import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const raw=readFileSync(join(here,'wrangler.private.toml'),'utf8');
test('undelivered Cloudflare Worker has no public ingress, DB or charged resources',()=>{
  const lines=raw.split(/\r?\n/).map(x=>x.trim())
    .filter(x=>x&&!x.startsWith('#'));
  assert.ok(lines.includes('workers_dev = false'));
  assert.ok(lines.includes('preview_urls = false'));
  assert.ok(lines.includes('name = "lifeline-mt5-d1-private-isolated"'));
  assert.ok(lines.includes('account_id = "93f395f5121954671f92fffa453d6b61"'));
  assert.equal(lines.some(x=>/^\[\[?/.test(x)),false,
    'nothing gets bound or publicly routed before resource preflight');
  assert.equal(lines.some(x=>/^route\s*=|^routes\s*=|^database_id\s*=/.test(x)),false);
});

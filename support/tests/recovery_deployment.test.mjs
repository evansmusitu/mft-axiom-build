import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('recovery surface is excluded from traditional search discovery',async()=>{
  const [robots,html]=await Promise.all([
    readFile(new URL('../robots.txt',import.meta.url),'utf8'),
    readFile(new URL('../recovery/index.html',import.meta.url),'utf8'),
  ]);
  assert.match(robots,/Disallow: \/recovery\//);
  assert.match(html,/noindex,nofollow,noarchive/i);
});

test('recovery deployment handoff requires Access before UI, additive schema, and distinct approver',async()=>{
  const text=await readFile(new URL('../recovery/DEPLOYMENT.md',import.meta.url),'utf8');
  assert.match(text,/production_authority:\s*false/i);
  assert.match(text,/support\.mftintelligence\.com\/recovery/);
  assert.match(text,/Cloudflare Access/i);
  assert.match(text,/before.*recovery.*surface|recovery.*surface.*before/is);
  assert.match(text,/SUPPORT_RECOVERY_ACCESS_TEAM_DOMAIN/);
  assert.match(text,/SUPPORT_RECOVERY_ACCESS_AUD/);
  assert.match(text,/additive/i);
  assert.match(text,/independent approver/i);
  assert.match(text,/different|distinct/i);
  assert.match(text,/Time Travel/i);
  assert.match(text,/no raw email|raw email.*not stored/i);
});

test('production bundle handoff explicitly includes recovery HTML and JS assets',async()=>{
  const text=await readFile(new URL('../recovery/DEPLOYMENT.md',import.meta.url),'utf8');
  assert.match(text,/support\/recovery\/index\.html/);
  assert.match(text,/support\/recovery\/app\.js/);
  assert.match(text,/\/recovery\/app\.js/);
  assert.match(text,/\/recovery\/api\//);
});

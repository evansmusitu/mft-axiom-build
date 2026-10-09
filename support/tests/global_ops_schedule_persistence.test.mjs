// Global Support cron must reassert after every public Worker replacement.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

for(const rel of [
  '../../.github/workflows/axiom-global-support-inbound-email-deploy.yml',
  '../../.github/workflows/axiom-global-support-operator-email-alerts.yml',
]){
  test('public Worker redeploy reasserts Global Support cron: '+rel,async()=>{
    const text=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.match(text,/workers\/scripts\/musitu-axiom-support\/schedules/);
    assert.match(text,/\*\/5 \* \* \* \*/);
    assert.match(text,/support cron missing|scheduled_every_5_minutes|cron.*5/i);
  });
}

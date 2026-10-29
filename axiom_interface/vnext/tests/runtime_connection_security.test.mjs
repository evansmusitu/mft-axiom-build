import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createFixedResearch} from '../../../ops/axiom_runtime_task_api.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('research transport can contact only fixed HTTPS providers',async()=>{
  const seen=[];
  const research=createFixedResearch(async url=>{
    seen.push(new URL(url));
    if(new URL(url).hostname==='en.wikipedia.org')return Response.json({query:{pages:{1:{index:1,title:'Result',fullurl:'https://en.wikipedia.org/wiki/Result',extract:'Untrusted retrieved data.'}}}});
    return Response.json({articles:[]});
  });
  const sources=await research('https://169.254.169.254/latest/meta-data and file:///etc/passwd');
  assert.deepEqual([...new Set(seen.map(url=>url.hostname))].sort(),['api.gdeltproject.org','en.wikipedia.org']);
  assert.ok(seen.every(url=>url.protocol==='https:'));
  assert.equal(sources[0].url,'https://en.wikipedia.org/wiki/Result');
});

test('research uses the bounded same-host Wikimedia REST fallback without a paid key',async()=>{
  const seen=[];
  const research=createFixedResearch(async url=>{
    const target=new URL(url);seen.push(target);
    if(target.pathname==='/w/rest.php/v1/search/page')return Response.json({pages:[{key:'42_(number)',title:'42 (number)',description:'Natural number',excerpt:'42 is the natural number after 41.'}]});
    return new Response('unavailable',{status:503});
  });
  const sources=await research('meaning of 42');
  assert.equal(sources.length,1);
  assert.equal(sources[0].url,'https://en.wikipedia.org/wiki/42_(number)');
  assert.match(sources[0].excerpt,/natural number after 41/i);
  assert.deepEqual([...new Set(seen.map(url=>url.hostname))].sort(),['api.gdeltproject.org','en.wikipedia.org']);
  assert.ok(seen.every(url=>url.protocol==='https:'));
});

test('research rejects provider redirects instead of following them to an untrusted host',async()=>{
  const research=createFixedResearch(async (_url,init)=>{
    assert.equal(init.redirect,'manual');
    return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'}});
  });
  await assert.rejects(()=>research('redirect attack'),/redirect rejected/i);
});

test('same-origin API requires session rate limit and complete runtime while browser has no credential path',()=>{
  const api=read('ops/axiom_runtime_task_api.mjs'),bridge=read('ops/axiom_runtime_bridge.mjs'),client=read('axiom_interface/vnext/runtime_execution_client.mjs'),ui=read('axiom_interface/vnext/runtime_execution_ui.js');
  for(const marker of ['authenticated_session_required','origin_rejected','TASK_RATE_LIMITER','operation_count===74','fixed_research_origins'])assert.ok(api.includes(marker),`API missing ${marker}`);
  for(const marker of ['count!==74','tools.length!==74','ONE_REQUEST','raw_credential_persisted:false','customer_metered:true'])assert.ok(bridge.includes(marker),`bridge missing ${marker}`);
  for(const source of [client,ui]){
    assert.doesNotMatch(source,/localStorage|sessionStorage/);
    assert.doesNotMatch(source,/authorization\s*:/i);
    assert.doesNotMatch(source,/x-musitu-control|MUSITU_CONTROL_SECRET/);
  }
  assert.doesNotMatch(ui,/innerHTML\s*=/);
});

test('runtime task service fails closed on partial catalogs and treats retrieved text as data only',()=>{
  const service=read('axiom_interface/vnext/runtime_task_service.mjs');
  for(const marker of ['count!==74','tools.length!==74','planned operation is not present','DATA_ONLY_NO_INSTRUCTION_AUTHORITY','research synthesis did not bind any supplied source'])assert.ok(service.includes(marker),`service missing ${marker}`);
  assert.doesNotMatch(service,/production_authority\s*:\s*true/i);
});

test('isolated qualification workflow has no production route or reusable production authority',()=>{
  const workflow=read('.github/workflows/axiom-runtime-connection-staging-canary.yml');
  for(const marker of ['musitu-axiom-runtime-staging','musitu-axiom-runtime-canary','mft-axiom-modal-edge-stage','production_authority\':False','partial_connection_accepted\':False'])assert.ok(workflow.includes(marker),`workflow missing ${marker}`);
  assert.equal(/custom_domains|routes\s*=|wrangler\s+deploy[^\n]*production/i.test(workflow),false);
  assert.equal(workflow.includes('axiom.mftintelligence.com'),false);
});

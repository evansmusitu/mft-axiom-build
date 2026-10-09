import assert from 'node:assert/strict';
import test from 'node:test';
import statusWorker from '../status_worker.js';

function env(incidents=[]){
  return {
    SUPPORT_API:{
      fetch:async request=>{
        const url=new URL(request.url);
        assert.equal(url.pathname,'/api/v1/status');
        return new Response(JSON.stringify({schema:'musitu.axiom.support-public-status.v1',incidents}),{
          status:200,headers:{'content-type':'application/json'}
        });
      }
    }
  };
}

test('dedicated status Worker exposes only public status metadata',async()=>{
  const e=env([{incident_id:'AXI-0123456789ABCDEF',title:'Synthetic incident',severity:'P1',state:'MONITORING',public_summary:'Monitoring recovery.',updated_at:'2026-10-09T16:00:00Z'}]);
  const api=await statusWorker.fetch(new Request('https://status.example/api/status'),e);
  assert.equal(api.status,200);
  const body=await api.json();
  assert.equal(body.incidents.length,1);
  assert.equal(body.incidents[0].title,'Synthetic incident');
  assert.equal('details' in body.incidents[0],false);
  assert.equal(api.headers.get('access-control-allow-origin'),'*');
  assert.match(api.headers.get('cache-control'),/max-age/);
});

test('status HTML is public, self-contained and does not expose support controls',async()=>{
  const response=await statusWorker.fetch(new Request('https://status.example/'),env([]));
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/MUSITU Axiom Service Status/i);
  assert.match(html,/\/api\/status/);
  assert.doesNotMatch(html,/recovery code|operator|internal note|case submission/i);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});

test('status Worker permits only read-only status routes',async()=>{
  const e=env([]);
  assert.equal((await statusWorker.fetch(new Request('https://status.example/unknown'),e)).status,404);
  assert.equal((await statusWorker.fetch(new Request('https://status.example/api/status',{method:'POST'}),e)).status,405);
  assert.equal((await statusWorker.fetch(new Request('https://status.example/',{method:'HEAD'}),e)).status,200);
});

test('status Worker fails closed when the support service binding is unavailable',async()=>{
  const response=await statusWorker.fetch(new Request('https://status.example/api/status'),{});
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error,'STATUS_SOURCE_UNAVAILABLE');
});

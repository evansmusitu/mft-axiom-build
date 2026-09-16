import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));const vnext=path.resolve(here,'..');const root=path.resolve(vnext,'../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('repository truth preserves phone evidence and the tablet-only blocker',()=>{
  const matrix=JSON.parse(read('docs/axiom_final_product/FA16_ACCEPTANCE_MATRIX.json'));
  assert.equal(matrix.real_device,'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER');assert.equal(matrix.real_phone_evidence,'EVIDENCED');assert.equal(matrix.tablet_evidence,'DEFERRED_PENDING_FUTURE_CUSTOMER');assert.equal(matrix.phase_exit_earned,false);assert.equal(matrix.phase_progression_authorized,true);assert.equal(matrix.software_implementation_verified,false);assert.equal(matrix.production_authority,false);assert.equal(matrix.external_offline_execution,false);assert.equal(matrix.legacy_phase_14_unchanged,true);
  assert.equal(matrix.phone_evidence_sha256,'03478e2f17eb82f68417c826e86c29a1fed716d57d5fbe1e81f4d5f1c49a42f6');
});

test('service worker keeps sensitive surfaces network-only and requires explicit update activation',()=>{
  const worker=read('axiom_interface/vnext/fa16_service_worker.js');
  for(const marker of ['api','mcp','auth','oauth','session','billing','health','Set-Cookie','no-store','private'])assert.ok(worker.includes(marker),`missing ${marker}`);
  assert.ok(worker.includes('SHELL_URLS.has(url.toString())'),'arbitrary same-origin static resources must not enter the shell cache');
  assert.equal(worker.includes("'./','./index.html'"),false,'scope root must not be precached as a potentially personalized document');
  assert.ok(worker.includes("event.data?.type==='AXIOM_FA16_ACTIVATE_UPDATE'"));
  assert.equal(/install[\s\S]{0,400}skipWaiting\(/.test(worker),false,'install handler must not automatically activate a new worker');
});

test('manifest and application shell expose bounded PWA integration',()=>{
  const manifest=JSON.parse(read('axiom_interface/vnext/manifest.webmanifest'));const index=read('axiom_interface/vnext/index.html');
  assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./#/home');
  for(const marker of ['manifest.webmanifest','fa16_mobile_pwa.css','fa16_mobile_pwa_ui.js','fa16-mobile-you'])assert.ok(index.includes(marker),`index missing ${marker}`);
});

test('offline engine has no external executor or device self-certification path',()=>{
  const engine=read('axiom_interface/vnext/fa16_pwa_engine.js');
  for(const marker of ["externalOfflineExecution:false","realDeviceStatus:'REAL_PHONE_EVIDENCED_TABLET_PENDING_CUSTOMER'","tabletEvidence:'DEFERRED_PENDING_FUTURE_CUSTOMER'","phoneEvidenceSha256:PREEXISTING_PHONE_EVIDENCE.evidence_sha256",'phaseExitEarned:false','emulation_may_substitute:false',"typeof verifyAttestation!=='function'"])assert.ok(engine.includes(marker),`truth marker missing ${marker}`);
  for(const forbidden of ['wrangler deploy','kubectl apply','terraform apply','productionAuthority:true','phaseExitEarned:true'])assert.equal(engine.includes(forbidden),false,`forbidden authority marker ${forbidden}`);
});

test('reconnect probe uses the service-worker network-only health seam',()=>{
  const ui=read('axiom_interface/vnext/fa16_mobile_pwa_ui.js');
  assert.ok(ui.includes("new URL('/health',location.origin)"));assert.ok(ui.includes("cache:'no-store'"));
  assert.equal(ui.includes("fetch('./manifest.webmanifest'"),false);
});

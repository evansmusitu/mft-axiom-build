import test from 'node:test';
import assert from 'node:assert/strict';
import {assertInstallCarrier, assertInstallController} from './install-carrier-contract.mjs';

const fallback='<a class="button tertiary" href="/store/open">Open in browser</a>';
const carrier={
  android:'intent://app/chemistry?action=update#Intent;scheme=musitustore;package=com.musitu.store;end',
  ios:'sidestore://install?url=https%3A%2F%2Fpayments.mftintelligence.com%2Fstore%2Fios%2FChemistry.ipa',
  web:'https://payments.mftintelligence.com/chemistry/install',
};
const anchor=(platform)=>'<a class="button" href="'+carrier[platform]+'">Install</a>'+fallback;
const button=(platform)=>'<button type="button" class="button" data-musitu-install-target="'+carrier[platform]+'">Install</button>'+fallback;
const invoke=(markup,platform='ios',action='update')=>assertInstallCarrier(markup,{platform,action});

test('legacy iOS SideStore anchor is recognized without hiding the browser fallback',()=>{
  assert.equal(invoke(anchor('ios')),'legacy-anchor');
});
test('controlled iOS SideStore button is recognized as a distinct transport',()=>{
  assert.equal(invoke(button('ios')),'controlled-button');
});
test('controlled Android intent carries the exact requested operation and package',()=>{
  assert.equal(invoke(button('android'),'android'),'controlled-button');
});
test('controlled web PWA target is allowed',()=>{
  assert.equal(invoke(button('web'),'web'),'controlled-button');
});
test('missing install target is rejected',()=>{
  assert.throws(()=>invoke(fallback),/install target/);
});
test('wrong Android operation is rejected',()=>{
  assert.throws(()=>invoke(button('android'),'android','repair'),/install target/);
});
test('wrong package identity is rejected',()=>{
  assert.throws(()=>invoke(button('android').replace('com.musitu.store','com.attacker.store'),'android'),/install target/);
});
test('wrong platform carrier is rejected',()=>{
  assert.throws(()=>invoke(button('web'),'ios'),/install target/);
});
test('duplicate button and anchor carrier is rejected',()=>{
  assert.throws(()=>invoke(button('ios')+anchor('ios')),/more than one|mixed/);
});
test('modern button cannot also expose a clickable native carrier URL',()=>{
  assert.throws(()=>invoke(button('ios')+'<a href="sidestore://install?url=another">Unsafe</a>'),/mixed|more than one/);
});
test('raw APK or IPA download links are rejected',()=>{
  assert.throws(()=>invoke(button('ios')+'<a href="https://payments.mftintelligence.com/store/evil.apk">Download</a>'),/package download/);
});
test('browser fallback is mandatory',()=>{
  assert.throws(()=>invoke(button('ios').replace(fallback,'')),/browser fallback/);
});
test('modern button requires JS controller binding',()=>{
  assert.throws(()=>assertInstallController('navigator.serviceWorker.register(...)',{transport:'controlled-button'}),/controller/);
  assert.doesNotThrow(()=>assertInstallController('document.querySelectorAll("[data-musitu-install-target]").forEach(musituBindInstallControl);',{transport:'controlled-button'}));
});
test('legacy links do not require modern controller',()=>{
  assert.doesNotThrow(()=>assertInstallController('',{transport:'legacy-anchor'}));
});

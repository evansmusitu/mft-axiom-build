import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_SHELL_JS} from './app-shell.mjs';

test('finalized Scientific Response Graph separates review presentation from response state',()=>{
  assert.match(APP_SHELL_JS,/let viewMode=response\.activeMode/);
  assert.match(APP_SHELL_JS,/const boardRefs=\(\)=>\{const panel=panelFor\(viewMode\)/);
  assert.match(APP_SHELL_JS,/const modeObjects=\(\)=>response\.objects\.filter\(o=>o\.mode===viewMode\)/);
  assert.match(APP_SHELL_JS,/const modeEdges=\(\)=>response\.edges\.filter\(e=>e\.mode===viewMode\)/);
  assert.match(APP_SHELL_JS,/if\(!response\.finalized\)\{response\.activeMode=mode;trace\('mode',mode\);persist\(\);\}/);
});

test('finalized local review lock survives reload and blocks destructive clear until explicit reopen',()=>{
  assert.match(APP_SHELL_JS,/finalized:parsed\.finalized===true/);
  assert.match(APP_SHELL_JS,/\[data-sr-reset\]'\)\.forEach\(el=>\{el\.disabled=locked\}\)/);
  assert.match(APP_SHELL_JS,/\[data-sr-reset\]'\)\?\.addEventListener\('click',\(\)=>\{if\(response\.finalized\)return;/);
  assert.match(APP_SHELL_JS,/response\.finalized=false;trace\('reopen'\);persist\(\);paintLock\(\)/);
});

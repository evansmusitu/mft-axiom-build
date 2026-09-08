from pathlib import Path

APP = Path('commerce/chemistry/storefront/app-shell.mjs')
MATRIX = Path('commerce/chemistry/storefront/install-browser-matrix.mjs')
UNIT = Path('commerce/chemistry/storefront/scientific-response.test.mjs')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


text = APP.read_text()
text = replace_once(
    text,
    "if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.schema===SR_SCHEMA&&Array.isArray(parsed.objects)&&Array.isArray(parsed.edges)&&Array.isArray(parsed.ink))response={...blank(),...parsed,argument:{...blank().argument,...(parsed.argument||{})},activeMode:modes.has(parsed.activeMode)?parsed.activeMode:'equation',finalized:false};}",
    "if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.schema===SR_SCHEMA&&Array.isArray(parsed.objects)&&Array.isArray(parsed.edges)&&Array.isArray(parsed.ink))response={...blank(),...parsed,argument:{...blank().argument,...(parsed.argument||{})},activeMode:modes.has(parsed.activeMode)?parsed.activeMode:'equation',finalized:parsed.finalized===true};}",
    'persist finalized lock',
)
text = replace_once(
    text,
    "  let selected=[];\n  let activeStroke=null;\n  let drag=null;",
    "  let selected=[];\n  let activeStroke=null;\n  let drag=null;\n  let viewMode=response.activeMode;",
    'separate review view state',
)
text = replace_once(
    text,
    "sr.querySelectorAll('[data-sr-symbol],[data-sr-add],[data-sr-connect],[data-sr-link-representation],[data-sr-delete],[data-sr-ink-undo],[data-sr-ink-clear]').forEach(el=>{el.disabled=locked});",
    "sr.querySelectorAll('[data-sr-symbol],[data-sr-add],[data-sr-connect],[data-sr-link-representation],[data-sr-delete],[data-sr-ink-undo],[data-sr-ink-clear],[data-sr-reset]').forEach(el=>{el.disabled=locked});",
    'lock destructive clear',
)
text = replace_once(
    text,
    "  const boardRefs=()=>{const panel=panelFor(response.activeMode);return {board:panel?.querySelector('[data-sr-board]'),links:panel?.querySelector('[data-sr-links]'),empty:panel?.querySelector('[data-sr-empty]')}};\n  const setMode=mode=>{\n    if(!modes.has(mode))return;\n    response.activeMode=mode;\n    sr.querySelectorAll('[data-sr-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.srMode===mode)));\n    sr.querySelectorAll('[data-sr-panel]').forEach(p=>p.hidden=p.dataset.srPanel!==mode);\n    trace('mode',mode);if(!response.finalized)persist();renderSummary();\n    if(mode==='ink')resizeInk();else if(['structure','mechanism','graph','apparatus','particle'].includes(mode))renderBoard();\n  };",
    "  const boardRefs=()=>{const panel=panelFor(viewMode);return {board:panel?.querySelector('[data-sr-board]'),links:panel?.querySelector('[data-sr-links]'),empty:panel?.querySelector('[data-sr-empty]')}};\n  const setMode=mode=>{\n    if(!modes.has(mode))return;\n    viewMode=mode;\n    if(!response.finalized){response.activeMode=mode;trace('mode',mode);persist();}\n    sr.querySelectorAll('[data-sr-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.srMode===mode)));\n    sr.querySelectorAll('[data-sr-panel]').forEach(p=>p.hidden=p.dataset.srPanel!==mode);\n    renderSummary();\n    if(mode==='ink')resizeInk();else if(['structure','mechanism','graph','apparatus','particle'].includes(mode))renderBoard();\n  };",
    'presentation-only review navigation',
)
text = replace_once(
    text,
    "  const modeObjects=()=>response.objects.filter(o=>o.mode===response.activeMode);\n  const modeEdges=()=>response.edges.filter(e=>e.mode===response.activeMode);",
    "  const modeObjects=()=>response.objects.filter(o=>o.mode===viewMode);\n  const modeEdges=()=>response.edges.filter(e=>e.mode===viewMode);",
    'render review mode without changing response',
)
text = replace_once(
    text,
    "sr.querySelector('[data-sr-reset]')?.addEventListener('click',()=>{response=blank();selected=[];",
    "sr.querySelector('[data-sr-reset]')?.addEventListener('click',()=>{if(response.finalized)return;response=blank();selected=[];",
    'block clear while locked',
)
APP.write_text(text)

m = MATRIX.read_text()
old_matrix = """  const frozenAfter=JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
  assert.deepEqual(frozenAfter,frozenBefore,'view-only navigation mutated a finalized Scientific Response Graph');

  await page.locator('[data-sr-reopen]').click();
  assert.equal(await page.locator('[data-sr-add=\"atom\"]').first().isDisabled(),false);"""
new_matrix = """  const frozenAfter=JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
  assert.deepEqual(frozenAfter,frozenBefore,'view-only navigation mutated a finalized Scientific Response Graph');
  assert.equal(await page.locator('[data-sr-reset]').isDisabled(),true,'finalized response allowed destructive clear before reopen');

  const frozenStorageBeforeReload=await page.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
  await page.reload({waitUntil:'networkidle'});
  assert.match(await page.locator('[data-sr-status]').textContent()||'',/locked for review/i,'finalized response did not stay locked across reload');
  assert.equal(await page.locator('[data-sr-equation]').getAttribute('readonly'),'','finalized equation became editable after reload');
  assert.equal(await page.locator('[data-sr-reset]').isDisabled(),true,'destructive clear unlocked after reload');
  const frozenStorageAfterReload=await page.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
  assert.equal(frozenStorageAfterReload,frozenStorageBeforeReload,'reload mutated persisted finalized Scientific Response Graph');
  const frozenAfterReload=JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
  assert.deepEqual(frozenAfterReload,frozenBefore,'reload changed finalized Scientific Response Graph semantics');

  await page.locator('[data-sr-reopen]').click();
  assert.equal(await page.locator('[data-sr-add=\"atom\"]').first().isDisabled(),false);
  assert.equal(await page.locator('[data-sr-reset]').isDisabled(),false);"""
m = replace_once(m, old_matrix, new_matrix, 'browser immutable/reload regression')
MATRIX.write_text(m)

u = UNIT.read_text()
old_unit = """  assert.match(APP_SHELL_JS,/panelFor=mode=>/);
  assert.match(APP_SHELL_JS,/boardRefs=\\(\\)=>/);
  assert.match(APP_SHELL_JS,/paintLock=\\(\\)=>/);"""
new_unit = """  assert.match(APP_SHELL_JS,/panelFor=mode=>/);
  assert.match(APP_SHELL_JS,/let viewMode=response\\.activeMode/);
  assert.match(APP_SHELL_JS,/boardRefs=\\(\\)=>/);
  assert.match(APP_SHELL_JS,/modeObjects=\\(\\)=>response\\.objects\\.filter\\(o=>o\\.mode===viewMode\\)/);
  assert.match(APP_SHELL_JS,/finalized:parsed\\.finalized===true/);
  assert.match(APP_SHELL_JS,/if\\(!response\\.finalized\\)\\{response\\.activeMode=mode;trace\\('mode',mode\\);persist\\(\\);\\}/);
  assert.match(APP_SHELL_JS,/paintLock=\\(\\)=>/);"""
u = replace_once(u, old_unit, new_unit, 'unit finalization contract')
UNIT.write_text(u)

print('MUSITU_SRG_FINALIZATION_PATCH=APPLIED')

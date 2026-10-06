import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

async function scanPage({browser, viewport, reducedMotion='no-preference', label}) {
  const context = await browser.newContext({viewport, reducedMotion});
  const page = await context.newPage();
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({status:204, body:''}));
  await page.goto('http://127.0.0.1:4173/index.html', {waitUntil:'domcontentloaded'});

  const axe = await new AxeBuilder({page})
    .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
    .analyze();

  const serious = axe.violations.filter(v => ['serious','critical'].includes(String(v.impact||'')));
  const allViolationIds = axe.violations.map(v => v.id).sort();

  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName?.toLowerCase() || '',
    className: document.activeElement?.className || '',
    href: document.activeElement?.getAttribute?.('href') || '',
  }));
  const skipFirst = firstFocus.tag === 'a' && String(firstFocus.className).split(/\s+/).includes('skip') && firstFocus.href === '#main';

  let reachedFirstControl = false;
  for (let i=0; i<40; i+=1) {
    const current = await page.evaluate(() => ({
      name: document.activeElement?.getAttribute?.('name') || '',
      tag: document.activeElement?.tagName?.toLowerCase() || '',
    }));
    if (current.name === 'surface' && current.tag === 'select') { reachedFirstControl = true; break; }
    await page.keyboard.press('Tab');
  }

  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainExists: Boolean(document.querySelector('main#main')),
    formLabelCount: document.querySelectorAll('form label').length,
    unlabeledNamedControls: [...document.querySelectorAll('input[name],select[name],textarea[name]')].filter(el => {
      if (el.closest('label')) return false;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
      return true;
    }).map(el => el.getAttribute('name')),
    statusLive: document.querySelector('#form-status')?.getAttribute('aria-live') || '',
  }));

  const scrollBehavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  await context.close();

  return {
    label,
    viewport,
    reduced_motion: reducedMotion,
    axe_violation_count: axe.violations.length,
    axe_violation_ids: allViolationIds,
    axe_serious_or_critical_count: serious.length,
    skip_link_first_keyboard_target: skipFirst,
    first_form_control_reachable_by_tab: reachedFirstControl,
    no_horizontal_overflow: geometry.scrollWidth <= geometry.innerWidth + 1,
    semantic_main_present: geometry.mainExists,
    form_label_count: geometry.formLabelCount,
    unlabeled_named_controls: geometry.unlabeledNamedControls,
    live_status_region: geometry.statusLive === 'polite',
    reduced_motion_scroll_behavior_auto: reducedMotion !== 'reduce' ? null : scrollBehavior === 'auto',
  };
}

export async function verifyAccessibilityReality({now=new Date().toISOString()}={}) {
  const browser = await chromium.launch({headless:true});
  try {
    const desktop = await scanPage({browser, viewport:{width:1440,height:1000}, label:'desktop'});
    const mobile = await scanPage({browser, viewport:{width:390,height:844}, label:'mobile'});
    const reduced = await scanPage({browser, viewport:{width:1440,height:1000}, reducedMotion:'reduce', label:'reduced-motion'});

    const views=[desktop,mobile,reduced];
    const failures=[];
    for(const v of views){
      if(v.axe_serious_or_critical_count!==0) failures.push(`${v.label}: axe serious/critical violations=${v.axe_serious_or_critical_count}`);
      if(!v.skip_link_first_keyboard_target) failures.push(`${v.label}: skip link is not first keyboard target`);
      if(!v.first_form_control_reachable_by_tab) failures.push(`${v.label}: first form control is not keyboard reachable`);
      if(!v.no_horizontal_overflow) failures.push(`${v.label}: horizontal overflow present`);
      if(!v.semantic_main_present) failures.push(`${v.label}: semantic main missing`);
      if(v.unlabeled_named_controls.length) failures.push(`${v.label}: unlabeled controls present`);
      if(!v.live_status_region) failures.push(`${v.label}: polite live status missing`);
    }
    if(reduced.reduced_motion_scroll_behavior_auto!==true) failures.push('reduced-motion: scroll behavior is not auto');

    const basis=JSON.stringify(views);
    return {
      schema:'musitu.axiom.support-readiness-evidence.v1',
      gate:'ACCESSIBILITY_REALITY',
      status:failures.length?'FAIL':'PASS',
      verified_at:now,
      verifier_ref:'github-actions:playwright-chromium+axe',
      artifact_sha256:sha256(basis),
      browser:'chromium',
      desktop,
      mobile,
      reduced_motion:reduced,
      failures,
      real_browser_rendering:true,
      real_physical_device_user_tested:false,
      public_origin_used:false,
      public_support_deployed:false,
      secret_exposed:false,
    };
  } finally {
    await browser.close();
  }
}

export async function main(){
  const evidence=await verifyAccessibilityReality();
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  await writeFile('support-accessibility-reality.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile('support-accessibility-reality.json.sha256',`${digest}  support-accessibility-reality.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,
    status:evidence.status,
    evidence_sha256:digest,
    failures:evidence.failures,
    violation_ids:[...new Set([evidence.desktop,evidence.mobile,evidence.reduced_motion].flatMap(v=>v.axe_violation_ids))].sort(),
  })+'\n');
  if(evidence.status!=='PASS') process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();

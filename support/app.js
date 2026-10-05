import {inspectSecretMaterial} from './control_plane.js';

const form = document.querySelector('#support-form');
const status = document.querySelector('#form-status');
const receipt = document.querySelector('#case-receipt');
const submit = form?.querySelector('button[type="submit"]');
const value = (data, name) => String(data.get(name) || '').trim();
let turnstileToken = '';
let turnstileWidget;

async function initializeTurnstile() {
  try {
    const response = await fetch('/api/v1/config', {headers: {'accept': 'application/json'}});
    const config = await response.json();
    if (!response.ok || !config.turnstile_sitekey) throw new Error('Anti-abuse protection is unavailable.');
    for (let attempt = 0; attempt < 100 && !window.turnstile; attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    if (!window.turnstile) throw new Error('Anti-abuse protection did not load.');
    turnstileWidget = window.turnstile.render('#turnstile-widget', {
      sitekey: config.turnstile_sitekey,
      action: config.turnstile_action,
      callback: token => { turnstileToken = token; submit.disabled = false; status.textContent = ''; },
      'expired-callback': () => { turnstileToken = ''; submit.disabled = true; status.textContent = 'The anti-abuse check expired. Complete it again.'; },
      'error-callback': () => { turnstileToken = ''; submit.disabled = true; status.textContent = 'The anti-abuse check could not be completed.'; },
    });
  } catch (error) {
    submit.disabled = true;
    status.textContent = error.message;
  }
}

function payloadFromForm() {
  const data = new FormData(form);
  return {
    surface: value(data, 'surface'), category: value(data, 'category'), affected_scope: value(data, 'affected_scope'),
    summary: value(data, 'summary'), description: value(data, 'description'), reproduction: value(data, 'reproduction'), impact: value(data, 'impact'),
    active_exploitation: data.get('active_exploitation') === 'on', safety_impact: data.get('safety_impact') === 'on',
    evidence_refs: [], consent_to_process: data.get('consent_to_process') === 'on',
  };
}

form?.addEventListener('submit', async event => {
  event.preventDefault(); receipt.hidden = true; status.textContent = '';
  if (!form.reportValidity()) return;
  if (!turnstileToken) { status.textContent = 'Complete the anti-abuse check first.'; return; }
  const payload = payloadFromForm();
  const secretCheck = inspectSecretMaterial(payload);
  if (!secretCheck.safe) {
    status.textContent = `Potential secret detected in ${[...new Set(secretCheck.findings.map(item => item.path.replace('intake.', '')))].join(', ')}. Remove it and try again. Nothing was sent.`;
    return;
  }
  submit.disabled = true; status.textContent = 'Creating an encrypted support case…';
  try {
    const response = await fetch('/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...payload, turnstile_token: turnstileToken})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'The secure case could not be created. Nothing was stored.');
    document.querySelector('#receipt-title').textContent = result.case.case_id;
    document.querySelector('#recovery-code').textContent = result.recovery_code;
    document.querySelector('#receipt-priority').textContent = `${result.case.priority} · ${result.case.state}`;
    receipt.hidden = false; form.reset(); status.textContent = 'Case created successfully.'; receipt.focus();
  } catch (error) { status.textContent = error.message; }
  finally {
    turnstileToken = '';
    if (window.turnstile && turnstileWidget !== undefined) window.turnstile.reset(turnstileWidget);
  }
});

document.querySelector('#copy-code')?.addEventListener('click', async () => {
  const code = document.querySelector('#recovery-code').textContent;
  try { await navigator.clipboard.writeText(code); status.textContent = 'Recovery code copied.'; }
  catch { status.textContent = 'Copy was unavailable. Select and save the recovery code manually.'; }
});

initializeTurnstile();

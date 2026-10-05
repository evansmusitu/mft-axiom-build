import {inspectSecretMaterial} from './control_plane.js';

const form = document.querySelector('#support-form');
const status = document.querySelector('#form-status');
const receipt = document.querySelector('#case-receipt');
const value = (data, name) => String(data.get(name) || '').trim();

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
  const payload = payloadFromForm();
  const secretCheck = inspectSecretMaterial(payload);
  if (!secretCheck.safe) {
    status.textContent = `Potential secret detected in ${[...new Set(secretCheck.findings.map(item => item.path.replace('intake.', '')))].join(', ')}. Remove it and try again. Nothing was sent.`;
    return;
  }
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; status.textContent = 'Creating an encrypted support case…';
  try {
    const response = await fetch('/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'The secure case could not be created. Nothing was stored.');
    document.querySelector('#receipt-title').textContent = result.case.case_id;
    document.querySelector('#recovery-code').textContent = result.recovery_code;
    document.querySelector('#receipt-priority').textContent = `${result.case.priority} · ${result.case.state}`;
    receipt.hidden = false; form.reset(); status.textContent = 'Case created successfully.'; receipt.focus();
  } catch (error) { status.textContent = error.message; }
  finally { submit.disabled = false; }
});

document.querySelector('#copy-code')?.addEventListener('click', async () => {
  const code = document.querySelector('#recovery-code').textContent;
  try { await navigator.clipboard.writeText(code); status.textContent = 'Recovery code copied.'; }
  catch { status.textContent = 'Copy was unavailable. Select and save the recovery code manually.'; }
});

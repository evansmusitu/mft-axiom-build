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


const accessForm = document.querySelector('#case-access-form');
const accessStatus = document.querySelector('#case-access-status');
const thread = document.querySelector('#case-thread');
const replyForm = document.querySelector('#case-reply');
const replyStatus = document.querySelector('#case-reply-status');
let activeCaseSession = null;

const escapeHtml = input => String(input ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function normalizedCaseId(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizedRecoveryCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function caseApi(path, {method = 'GET', body = null} = {}) {
  if (!activeCaseSession) throw new Error('Open the secure conversation first.');
  const headers = {
    'accept': 'application/json',
    'Authorization': `Support ${activeCaseSession.recoveryCode}`,
  };
  if (body !== null) headers['content-type'] = 'application/json';
  const response = await fetch(path, {method, headers, body: body === null ? undefined : JSON.stringify(body)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || (response.status === 404 ? 'Case or recovery code was not recognized.' : result.error || 'The secure case request failed.'));
  return result;
}

function renderCustomerThread(value) {
  document.querySelector('#case-thread-title').textContent = value.case.case_id;
  document.querySelector('#case-thread-state').textContent = `${value.case.priority || ''} · ${value.case.state || ''}`;
  const original = document.querySelector('#case-original');
  original.innerHTML = `<article><h4>${escapeHtml(value.details?.summary || 'Original support request')}</h4><p>${escapeHtml(value.details?.description || '')}</p></article>`;
  const messages = document.querySelector('#case-messages');
  messages.innerHTML = (value.messages || []).length
    ? value.messages.map(message => {
        const author = message.type === 'AGENT_REPLY' ? 'MUSITU Support' : message.type === 'SYSTEM_EVENT' ? 'Case update' : 'You';
        return `<article class="customer-message ${escapeHtml(message.type.toLowerCase())}"><header><strong>${author}</strong><time datetime="${escapeHtml(message.created_at)}">${escapeHtml(new Date(message.created_at).toLocaleString())}</time></header><p>${escapeHtml(message.body)}</p></article>`;
      }).join('')
    : '<p class="fine">No follow-up messages yet.</p>';
  thread.hidden = false;
  document.querySelector('#close-case-session').hidden = false;
}

async function refreshCustomerThread() {
  if (!activeCaseSession) return;
  accessStatus.textContent = 'Loading encrypted conversation…';
  const value = await caseApi(`/api/v1/cases/${encodeURIComponent(activeCaseSession.caseId)}`);
  renderCustomerThread(value);
  accessStatus.textContent = 'Secure conversation loaded.';
}

accessForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!accessForm.reportValidity()) return;
  const data = new FormData(accessForm);
  const caseId = normalizedCaseId(data.get('case_id'));
  const recoveryCode = normalizedRecoveryCode(data.get('recovery_code'));
  activeCaseSession = {caseId, recoveryCode};
  accessStatus.textContent = 'Opening secure conversation…';
  try {
    await refreshCustomerThread();
    accessForm.querySelector('[name="recovery_code"]').value = '';
  } catch (error) {
    activeCaseSession = null;
    thread.hidden = true;
    document.querySelector('#close-case-session').hidden = true;
    accessStatus.textContent = error.message;
  }
});

replyForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeCaseSession || !replyForm.reportValidity()) return;
  const data = new FormData(replyForm);
  const body = String(data.get('body') || '').trim();
  const secretCheck = inspectSecretMaterial({body}, 'message');
  if (!secretCheck.safe) {
    replyStatus.textContent = 'Potential secret detected. Remove credentials or payment secrets before sending.';
    return;
  }
  const button = replyForm.querySelector('button[type="submit"]');
  button.disabled = true;
  replyStatus.textContent = 'Encrypting and sending reply…';
  try {
    await caseApi(`/api/v1/cases/${encodeURIComponent(activeCaseSession.caseId)}/messages`, {method: 'POST', body: {body}});
    replyForm.reset();
    replyStatus.textContent = 'Reply sent.';
    await refreshCustomerThread();
  } catch (error) {
    replyStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#refresh-case-thread')?.addEventListener('click', async () => {
  try { await refreshCustomerThread(); }
  catch (error) { accessStatus.textContent = error.message; }
});

document.querySelector('#close-case-session')?.addEventListener('click', () => {
  activeCaseSession = null;
  accessForm?.reset();
  replyForm?.reset();
  thread.hidden = true;
  document.querySelector('#close-case-session').hidden = true;
  accessStatus.textContent = 'Recovery code forgotten from this page.';
  replyStatus.textContent = '';
});

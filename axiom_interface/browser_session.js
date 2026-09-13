const ENDPOINT = './.well-known/axiom-session';
const GUEST_KEY = 'axiom.browser.guest-session.v1';
const SESSION_SCHEMA = 'musitu.axiom.browser-session.v1';
const ALLOWED_FIELDS = new Set(['schema','authenticated','subject','display_name','session_id','assurance','expires_at','sign_in_path']);
const SECRET_FIELD = /^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|secret/i;
const MODES = Object.freeze({guest:'GUEST_BROWSER_WORKSPACE', authenticated:'AUTHENTICATED_SAME_ORIGIN_SESSION'});

const clean = (value, limit = 180) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);

export function rejectSecretFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw new DOMException('session response contained forbidden credential material', 'SecurityError');
    rejectSecretFields(child);
  }
}

function guestId(storage) {
  try {
    const existing = clean(storage?.getItem(GUEST_KEY), 100);
    if (/^guest_[A-Za-z0-9_-]{8,90}$/.test(existing)) return existing;
    const created = `guest_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
    storage?.setItem(GUEST_KEY, created);
    return created;
  } catch {
    return 'guest_ephemeral';
  }
}

function guestState(storage, reason = 'UNAUTHENTICATED') {
  return {
    schema:'musitu.axiom.browser-session-state.v1',
    mode:MODES.guest,
    authenticated:false,
    subject:null,
    displayName:'Guest workspace',
    sessionId:guestId(storage),
    assurance:'NONE',
    expiresAt:null,
    signInHref:null,
    reason,
  };
}

function sameOriginHref(path) {
  if (!path) return null;
  const href = new URL(clean(path, 500), document.baseURI);
  if (href.origin !== location.origin || !/^https?:$/.test(href.protocol)) throw new DOMException('session action must remain same-origin', 'SecurityError');
  if (/\.(?:apk|aab|ipa|dmg|pkg|exe|msi|zip)(?:[?#]|$)/i.test(href.href)) throw new DOMException('session action cannot target an installer', 'SecurityError');
  return href.href;
}

function authenticatedState(payload) {
  rejectSecretFields(payload);
  if (Object.keys(payload).some(key => !ALLOWED_FIELDS.has(key))) throw new DOMException('session response contained unsupported fields', 'SecurityError');
  if (payload.schema !== SESSION_SCHEMA || payload.authenticated !== true) throw new DOMException('invalid authenticated session response', 'SecurityError');
  const subject = clean(payload.subject, 180), displayName = clean(payload.display_name, 120), sessionId = clean(payload.session_id, 180);
  if (!subject || !displayName || !sessionId) throw new DOMException('authenticated session identity is incomplete', 'SecurityError');
  const expiresAt = clean(payload.expires_at, 80);
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw new DOMException('authenticated session is expired', 'SecurityError');
  return {
    schema:'musitu.axiom.browser-session-state.v1',
    mode:MODES.authenticated,
    authenticated:true,
    subject,
    displayName,
    sessionId,
    assurance:clean(payload.assurance, 100) || 'SERVER_SESSION',
    expiresAt:expiresAt || null,
    signInHref:sameOriginHref(payload.sign_in_path),
    reason:'RESTORED_FROM_SAME_ORIGIN_COOKIE',
  };
}

async function readSession(storage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const endpoint = new URL(ENDPOINT, document.baseURI);
    if (endpoint.origin !== location.origin) throw new DOMException('session endpoint must be same-origin', 'SecurityError');
    const response = await fetch(endpoint, {method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
    if ([401,403,404].includes(response.status)) return guestState(storage, 'UNAUTHENTICATED');
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw new DOMException('session endpoint rejected', 'SecurityError');
    const text = await response.text();
    if (text.length > 8192) throw new DOMException('session response exceeded limit', 'SecurityError');
    return authenticatedState(JSON.parse(text));
  } catch (error) {
    return guestState(storage, error?.name === 'SecurityError' ? 'SESSION_REJECTED' : 'SESSION_ENDPOINT_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

function render(state) {
  const button = document.querySelector('#session-button');
  const name = document.querySelector('#session-name');
  const summary = document.querySelector('#session-summary');
  const detail = document.querySelector('#session-detail');
  const signIn = document.querySelector('#session-sign-in');
  document.documentElement.dataset.sessionMode = state.authenticated ? 'authenticated' : 'guest';
  if (name) name.textContent = state.displayName;
  if (button) button.setAttribute('aria-label', `Account: ${state.displayName}`);
  if (summary) summary.textContent = state.authenticated ? `Signed in as ${state.displayName}.` : 'Using a browser-local guest workspace.';
  if (detail) detail.textContent = state.authenticated
    ? 'Identity was restored by a same-origin HttpOnly cookie. No bearer token is stored in browser storage.'
    : 'The application remains usable locally. Account-only capabilities stay unavailable until the deployment host provides an authenticated session.';
  if (signIn) {
    signIn.hidden = !state.signInHref;
    if (state.signInHref) signIn.href = state.signInHref;
    else signIn.removeAttribute('href');
  }
}

export function initBrowserSession({emit = () => {}, storage = window.sessionStorage} = {}) {
  let state = guestState(storage, 'CHECKING_SAME_ORIGIN_SESSION');
  const dialog = document.querySelector('#session-dialog');
  const refresh = async () => {
    state = await readSession(storage);
    render(state);
    emit('session.restore', {state:state.authenticated ? 'authenticated' : 'guest'});
    return structuredClone(state);
  };
  if (dialog && !dialog.dataset.sessionEvents) {
    dialog.dataset.sessionEvents = 'installed';
    document.querySelector('#session-button')?.addEventListener('click', () => dialog.showModal());
    document.querySelector('#session-close')?.addEventListener('click', () => dialog.close());
    document.querySelector('#session-refresh')?.addEventListener('click', () => { void refresh(); });
  }
  render(state);
  const api = Object.freeze({refresh, getState:() => structuredClone(state), modes:MODES});
  window.AxiomBrowserSession = api;
  window.AxiomBrowserSessionReady = refresh();
  return api;
}

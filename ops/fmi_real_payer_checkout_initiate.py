import hashlib
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get('FMI_PUBLIC_BASE', '').rstrip('/')
PLAN = os.environ.get('FMI_PLAN', '').strip().upper()
AUTH = os.environ.get('FMI_PAYER_AUTHORIZATION', '').strip()

EXPECTED = {
    'FOUNDING': {'amount_cents': 4900, 'phrase': 'AUTHORIZE_FMI_FOUNDING_USD_49'},
    'PRO': {'amount_cents': 14900, 'phrase': 'AUTHORIZE_FMI_PRO_USD_149'},
}

if not BASE:
    raise SystemExit('FMI_PUBLIC_BASE is required')
if PLAN not in EXPECTED:
    raise SystemExit('unsupported plan')
if AUTH != EXPECTED[PLAN]['phrase']:
    raise SystemExit('payer authorization phrase mismatch; refusing to create checkout')


def req(path, method='GET', obj=None, bearer=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'MUSITU-FMI-Real-Payer-Certification/1.0'}
    data = None
    if obj is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(obj, separators=(',', ':')).encode()
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    q = urllib.request.Request(BASE + path, headers=headers, method=method, data=data)
    try:
        with urllib.request.urlopen(q, timeout=30) as r:
            raw = r.read()
            return r.status, json.loads(raw or b'{}')
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            body = json.loads(raw or b'{}')
        except Exception:
            body = {'raw': raw[:300].decode('utf-8', 'ignore')}
        return e.code, body

code, health = req('/healthz')
if code != 200 or health.get('authority') != 'PAPER_SHADOW_ONLY':
    raise SystemExit('FMI authority health gate failed')

code, billing = req('/v1/billing/healthz')
if code != 200 or billing.get('ok') is not True or billing.get('settlement_certified') is not False:
    raise SystemExit('billing health gate failed')

code, catalog = req('/v1/billing/catalog')
plans = catalog.get('plans') or {}
item = plans.get(PLAN) or {}
if code != 200 or int(item.get('amount_cents', -1)) != EXPECTED[PLAN]['amount_cents'] or item.get('currency') != 'USD':
    raise SystemExit('server-side catalog mismatch')

stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
email = f'fmi-settlement-cert-{stamp}-{secrets.token_hex(4)}@example.invalid'
code, signup = req('/v1/signup', 'POST', {'email': email})
if code != 201 or signup.get('ok') is not True or signup.get('plan') != 'FREE':
    raise SystemExit('certification customer signup failed: ' + str((code, signup)))
api_key = signup.get('api_key') or ''
customer_id = signup.get('customer_id') or ''
if len(api_key) < 20 or not customer_id:
    raise SystemExit('signup did not return usable ephemeral credential')

code, checkout = req('/v1/billing/checkout', 'POST', {'plan': PLAN}, bearer=api_key)
if code != 201 or checkout.get('ok') is not True:
    raise SystemExit('provider checkout initiation failed: ' + str((code, checkout)))
if checkout.get('plan') != PLAN or int(checkout.get('amount_cents', -1)) != EXPECTED[PLAN]['amount_cents']:
    raise SystemExit('checkout server-price mismatch')
if checkout.get('currency') != 'USD' or checkout.get('payment_status') != 'pending' or checkout.get('settlement_certified') is not False:
    raise SystemExit('checkout response contract mismatch')
try:
    u = urllib.parse.urlparse(checkout.get('browser_url') or '')
except Exception:
    u = None
if not u or u.scheme != 'https' or u.hostname not in {'paynow.co.zw', 'www.paynow.co.zw'}:
    raise SystemExit('unsafe provider browser_url')
reference = checkout.get('reference') or ''
if not reference.startswith('FMI-'):
    raise SystemExit('invalid FMI checkout reference')

record = {
    'schema': 'musitu-fmi.real-payer-checkout-initiation.v1',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'customer_id': customer_id,
    'reference': reference,
    'plan': PLAN,
    'amount_cents': EXPECTED[PLAN]['amount_cents'],
    'currency': 'USD',
    'browser_url': checkout['browser_url'],
    'expires_at': checkout.get('expires_at'),
    'payment_status': 'pending',
    'provider': 'paynow',
    'payer_authorization_phrase_matched': True,
    'server_pricing_verified': True,
    'paper_shadow_authority_preserved': True,
    'real_money_settlement_certified': False,
    'api_key_persisted': False,
}
raw = (json.dumps(record, indent=2, sort_keys=True) + '\n').encode()
open('fmi-real-payer-checkout.json', 'wb').write(raw)
sha = hashlib.sha256(raw).hexdigest()
open('fmi-real-payer-checkout.sha256', 'w', encoding='utf-8').write(f'{sha}  fmi-real-payer-checkout.json\n')
print(json.dumps({
    'gate': 'PASS',
    'reference': reference,
    'plan': PLAN,
    'amount_cents': EXPECTED[PLAN]['amount_cents'],
    'provider_checkout_created': True,
    'real_money_settlement_certified': False,
    'api_key_logged_or_persisted': False,
    'artifact_sha256': sha,
}, sort_keys=True))

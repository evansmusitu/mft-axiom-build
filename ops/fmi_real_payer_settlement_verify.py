import hashlib
import json
import os
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = 'https://api.cloudflare.com/client/v4'
AID = os.environ['CLOUDFLARE_ACCOUNT_ID']
DBID = os.environ['FMI_DB_UUID']
BASE = os.environ['FMI_PUBLIC_BASE'].rstrip('/')
REF = os.environ['FMI_REFERENCE'].strip().upper()
PLAN = os.environ['FMI_EXPECTED_PLAN'].strip().upper()
CFH = {
    'X-Auth-Email': os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key': os.environ['CLOUDFLARE_GLOBAL_API_KEY'],
    'Content-Type': 'application/json',
    'User-Agent': 'MUSITU-FMI-Real-Settlement-Verify/1.0',
}
EXPECTED = {'FOUNDING': 4900, 'PRO': 14900}
if PLAN not in EXPECTED:
    raise SystemExit('unsupported expected plan')
if not REF.startswith('FMI-'):
    raise SystemExit('invalid reference')


def d1(sql, params=None):
    obj = {'sql': sql}
    if params is not None:
        obj['params'] = params
    q = urllib.request.Request(
        f'{API}/accounts/{AID}/d1/database/{DBID}/query',
        headers=CFH,
        method='POST',
        data=json.dumps(obj, separators=(',', ':')).encode(),
    )
    with urllib.request.urlopen(q, timeout=30) as r:
        x = json.load(r)
    if x.get('success') is False:
        raise RuntimeError('D1 API success=false')
    rows = []
    for rr in x.get('result') or []:
        if rr.get('success') is not True:
            raise RuntimeError('D1 query failed')
        rows.extend(rr.get('results') or [])
    return rows


def public(path, method='GET', obj=None, bearer=None):
    h = {'Accept': 'application/json', 'User-Agent': 'MUSITU-FMI-Real-Settlement-Verify/1.0'}
    data = None
    if obj is not None:
        h['Content-Type'] = 'application/json'
        data = json.dumps(obj, separators=(',', ':')).encode()
    if bearer:
        h['Authorization'] = 'Bearer ' + bearer
    q = urllib.request.Request(BASE + path, headers=h, method=method, data=data)
    try:
        with urllib.request.urlopen(q, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            x = json.loads(raw or b'{}')
        except Exception:
            x = {}
        return e.code, x

hc, health = public('/healthz')
if hc != 200 or health.get('authority') != 'PAPER_SHADOW_ONLY':
    raise SystemExit('paper/shadow authority regression')
bc, billing_health = public('/v1/billing/healthz')
if bc != 200 or billing_health.get('ok') is not True:
    raise SystemExit('billing health regression')

rows = d1('SELECT reference,customer_id,plan,amount_cents,currency,status,paynow_reference,created_at,completed_at FROM billing_checkout_intents WHERE reference=?1 LIMIT 1', [REF])
if len(rows) != 1:
    raise SystemExit('checkout intent not found')
intent = rows[0]
if intent.get('plan') != PLAN or int(intent.get('amount_cents', -1)) != EXPECTED[PLAN] or intent.get('currency') != 'USD':
    raise SystemExit('settlement intent price/plan mismatch')
if intent.get('status') != 'paid' or not intent.get('paynow_reference') or not intent.get('completed_at'):
    raise SystemExit('checkout is not yet provider-settled')
customer_id = intent['customer_id']

customers = d1('SELECT id,plan,status FROM customers WHERE id=?1 LIMIT 1', [customer_id])
if len(customers) != 1 or customers[0].get('status') != 'active' or customers[0].get('plan') != PLAN:
    raise SystemExit('customer entitlement transition missing')
subs = d1("SELECT id,provider,provider_reference,plan,status,amount_cents,currency,period_start,period_end FROM billing_subscriptions WHERE customer_id=?1 AND status='active'", [customer_id])
if len(subs) != 1:
    raise SystemExit('expected exactly one active subscription')
sub = subs[0]
if sub.get('provider') != 'paynow' or sub.get('plan') != PLAN or int(sub.get('amount_cents', -1)) != EXPECTED[PLAN] or sub.get('currency') != 'USD':
    raise SystemExit('active subscription mismatch')
if not sub.get('provider_reference'):
    raise SystemExit('provider reference missing')

before_events = d1("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'", [customer_id])
before_event_count = int(before_events[0]['n']) if before_events else 0
before_subs = d1("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'", [customer_id])
before_sub_count = int(before_subs[0]['n']) if before_subs else 0
if before_event_count < 1 or before_sub_count != 1:
    raise SystemExit('pre-idempotency evidence missing')

token = secrets.token_urlsafe(36)
key_hash = hashlib.sha256(token.encode()).hexdigest()
key_id = 'key_settlecert_' + secrets.token_hex(12)
ts = datetime.now(timezone.utc).isoformat()
d1("INSERT INTO api_keys(id,customer_id,key_hash,status,created_at) VALUES(?1,?2,?3,'active',?4)", [key_id, customer_id, key_hash, ts])
temp_key_deleted = False
try:
    pc, poll = public('/v1/billing/poll', 'POST', {'reference': REF}, bearer=token)
    if pc != 200 or poll.get('ok') is not True or poll.get('paid') is not True or poll.get('idempotent') is not True:
        raise SystemExit('provider re-poll did not prove idempotent paid replay: ' + str((pc, poll)))
finally:
    d1('DELETE FROM api_keys WHERE id=?1', [key_id])
    temp_key_deleted = True

left = d1('SELECT count(*) AS n FROM api_keys WHERE id=?1', [key_id])
if int(left[0]['n']) != 0:
    raise SystemExit('temporary certification key cleanup failed')
after_events = d1("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'", [customer_id])
after_event_count = int(after_events[0]['n']) if after_events else 0
after_subs = d1("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'", [customer_id])
after_sub_count = int(after_subs[0]['n']) if after_subs else 0
if after_event_count != before_event_count or after_sub_count != before_sub_count:
    raise SystemExit('idempotency replay duplicated entitlement state')

hc2, health2 = public('/healthz')
if hc2 != 200 or health2.get('authority') != 'PAPER_SHADOW_ONLY':
    raise SystemExit('post-settlement paper/shadow authority regression')

record = {
    'schema': 'musitu-fmi.real-payer-settlement-certification.v1',
    'verified_at': datetime.now(timezone.utc).isoformat(),
    'reference': REF,
    'customer_id': customer_id,
    'plan': PLAN,
    'amount_cents': EXPECTED[PLAN],
    'currency': 'USD',
    'provider': 'paynow',
    'provider_reference_present': True,
    'intent_status': 'paid',
    'customer_entitlement_transition': 'PASS',
    'active_subscription_count': after_sub_count,
    'plan_activated_event_count': after_event_count,
    'provider_repoll_paid': True,
    'provider_repoll_idempotent': True,
    'duplicate_subscription_created': False,
    'duplicate_plan_activation_event_created': False,
    'temporary_verification_key_deleted': temp_key_deleted,
    'paper_shadow_authority_preserved': True,
    'live_trading_authorized': False,
    'model_authorized_trade_execution': False,
    'production_model_authority': False,
    'real_money_settlement_tested': True,
    'single_real_payer_settlement_certified': True,
    'global_claim_admission_pending': True,
}
raw = (json.dumps(record, indent=2, sort_keys=True) + '\n').encode()
open('fmi-real-payer-settlement-certification.json', 'wb').write(raw)
sha = hashlib.sha256(raw).hexdigest()
open('fmi-real-payer-settlement-certification.sha256', 'w', encoding='utf-8').write(f'{sha}  fmi-real-payer-settlement-certification.json\n')
print(json.dumps({
    'gate': 'PASS',
    'reference': REF,
    'plan': PLAN,
    'amount_cents': EXPECTED[PLAN],
    'provider_settlement': 'PAID',
    'idempotent_repoll': 'PASS',
    'temporary_key_deleted': True,
    'paper_shadow_authority_preserved': True,
    'single_real_payer_settlement_certified': True,
    'global_claim_admission_pending': True,
    'evidence_sha256': sha,
}, sort_keys=True))

import datetime, hashlib, json, os, pathlib, secrets, urllib.error, urllib.parse, urllib.request, uuid

CF_API = os.environ['CF_API'].rstrip('/')
ACCOUNT_ID = os.environ['ACCOUNT_ID']
DB_ID = os.environ['FMI_DB_UUID']
PUBLIC_BASE = os.environ['PUBLIC_BASE'].rstrip('/')
PLAN = 'FOUNDING'
EXPECTED_AMOUNT = 4900
EXPECTED_CURRENCY = 'USD'
EXPECTED_PRICE_ID = 'fmi-founding-monthly'
CF_HEADERS = {
    'X-Auth-Email': os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key': os.environ['CLOUDFLARE_API_KEY'],
    'Accept': 'application/json',
    'User-Agent': 'MUSITU-FMI-Revenue-Checkout-Initiate/1.0',
}

def http(url, method='GET', headers=None, body=None, timeout=60):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()

def api(path, method='GET', obj=None, bearer=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'MUSITU-FMI-Revenue-Checkout-Initiate/1.0'}
    body = None
    if obj is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(obj, separators=(',', ':')).encode()
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    code, rh, raw = http(PUBLIC_BASE + path, method, headers, body)
    try:
        out = json.loads(raw or b'{}')
    except Exception:
        out = {}
    return code, rh, out

def d1(sql, params=None):
    headers = dict(CF_HEADERS)
    headers['Content-Type'] = 'application/json'
    obj = {'sql': sql}
    if params is not None:
        obj['params'] = params
    code, _, raw = http(
        f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query',
        'POST', headers, json.dumps(obj, separators=(',', ':')).encode(), 45
    )
    if code != 200:
        raise RuntimeError(f'D1 HTTP {code}')
    payload = json.loads(raw or b'{}')
    if payload.get('success') is False:
        raise RuntimeError('D1 success=false')
    rows = []
    for item in payload.get('result') or []:
        if item.get('success') is not True:
            raise RuntimeError('D1 statement failed')
        rows.extend(item.get('results') or [])
    return rows

def paynow_https(value):
    try:
        u = urllib.parse.urlparse(str(value or ''))
        return u.scheme == 'https' and u.hostname in ('paynow.co.zw', 'www.paynow.co.zw')
    except Exception:
        return False

def mask(value):
    if value:
        print('::add-mask::' + str(value))

def digest(value):
    return hashlib.sha256(str(value).encode()).hexdigest()

# Refuse to create a second live certification checkout.
existing = d1("SELECT reference,status,expires_at FROM billing_checkout_intents WHERE customer_id LIKE 'cert_fmi_real_money_%' ORDER BY created_at DESC")
now = datetime.datetime.now(datetime.timezone.utc)
for row in existing:
    status = str(row.get('status') or '').lower()
    exp_raw = str(row.get('expires_at') or '')
    try:
        exp = datetime.datetime.fromisoformat(exp_raw.replace('Z', '+00:00'))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        exp = None
    if status in ('pending', 'initiated', 'created') and exp and exp > now:
        raise RuntimeError('unexpired FMI certification checkout already exists; refusing duplicate')
    if status == 'paid':
        raise RuntimeError('paid FMI certification checkout already exists; reconcile instead of creating another')

suffix = uuid.uuid4().hex
email = f'cert-fmi-real-money-{suffix}@invalid.example'
customer_id = None
api_key = None
reference = None
browser_url = None
provider_created = False

signup_code, _, signup = api('/v1/signup', 'POST', {'email': email})
if signup_code != 201:
    raise RuntimeError(f'FMI signup failed HTTP {signup_code}: {signup.get("error")}')
customer_id = str(signup.get('customer_id') or '')
api_key = str(signup.get('api_key') or '')
mask(customer_id); mask(api_key)
if not customer_id or not api_key or str(signup.get('plan') or '').upper() != 'FREE':
    raise RuntimeError('FMI signup response contract mismatch')

try:
    # Mark this disposable certification identity in D1 without changing its FREE authority.
    d1("UPDATE customers SET name='MUSITU FMI real-money certification customer' WHERE id=?1", [customer_id])
    checkout_code, _, checkout = api('/v1/billing/checkout', 'POST', {'plan': PLAN}, api_key)
    if checkout_code not in (200, 201):
        raise RuntimeError(f'FMI checkout initiation failed HTTP {checkout_code}: {checkout.get("error")}')
    reference = str(checkout.get('reference') or '')
    browser_url = str(checkout.get('browser_url') or '')
    mask(reference); mask(browser_url)
    if not reference or not paynow_https(browser_url):
        raise RuntimeError('FMI checkout response missing safe Paynow URL/reference')
    provider_created = True

    rows = d1("SELECT reference,customer_id,plan,amount_cents,currency,status,browser_url,poll_url,paynow_reference,created_at,expires_at,completed_at FROM billing_checkout_intents WHERE reference=?1 LIMIT 2", [reference])
    if len(rows) != 1:
        raise RuntimeError('FMI checkout intent not persisted exactly once')
    r = rows[0]
    if r.get('customer_id') != customer_id:
        raise RuntimeError('FMI checkout customer mismatch')
    if (r.get('plan'), int(r.get('amount_cents') or 0), r.get('currency')) != (PLAN, EXPECTED_AMOUNT, EXPECTED_CURRENCY):
        raise RuntimeError('FMI persisted checkout pricing mismatch')
    if str(r.get('status') or '').lower() not in ('pending', 'initiated', 'created'):
        raise RuntimeError('FMI checkout not in unpaid canonical state')
    if not paynow_https(r.get('browser_url')) or not paynow_https(r.get('poll_url')):
        raise RuntimeError('FMI persisted Paynow URL contract invalid')
    if r.get('paynow_reference') or r.get('completed_at'):
        raise RuntimeError('FMI unpaid checkout unexpectedly contains settlement evidence')
    try:
        exp = datetime.datetime.fromisoformat(str(r.get('expires_at') or '').replace('Z', '+00:00'))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        raise RuntimeError('FMI checkout expiry invalid')
    if exp <= datetime.datetime.now(datetime.timezone.utc):
        raise RuntimeError('FMI checkout already expired')

    cust = d1('SELECT plan,status FROM customers WHERE id=?1 LIMIT 2', [customer_id])
    if len(cust) != 1 or str(cust[0].get('plan') or '').upper() != 'FREE' or cust[0].get('status') != 'active':
        raise RuntimeError('FMI certification customer authority changed before payment')
    subs = d1("SELECT count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 AND status='active'", [customer_id])
    if int(subs[0]['n']) != 0:
        raise RuntimeError('FMI unpaid checkout created active subscription')
    acts = d1("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'", [customer_id])
    if int(acts[0]['n']) != 0:
        raise RuntimeError('FMI unpaid checkout emitted PLAN_ACTIVATED')

    # Remove all bearer keys for this certification identity before payer action.
    d1('DELETE FROM api_keys WHERE customer_id=?1', [customer_id])
    remaining = d1('SELECT count(*) AS n FROM api_keys WHERE customer_id=?1', [customer_id])
    if int(remaining[0]['n']) != 0:
        raise RuntimeError('FMI certification identity retained API keys')

    pathlib.Path('OPEN_PAYNOW_FMI_CERTIFICATION_CHECKOUT.txt').write_text(
        'MUSITU Frontier Market Intelligence real-money certification checkout\n\n'
        'Plan: FOUNDING\nAmount: USD 49.00\nPurpose: one genuine non-test payment to certify the FMI-specific settlement and entitlement path\n\n'
        'Open this Paynow URL before it expires:\n' + browser_url + '\n',
        encoding='utf-8'
    )

    evidence = {
        'schema': 'musitu.fmi.real-money-certification-checkout-initiation.v1',
        'gate': 'FMI_REAL_MONEY_CERTIFICATION_CHECKOUT_READY',
        'plan': PLAN,
        'price_id': EXPECTED_PRICE_ID,
        'amount_cents': EXPECTED_AMOUNT,
        'currency': EXPECTED_CURRENCY,
        'provider': 'paynow',
        'provider_checkout_created': True,
        'payment_completed': False,
        'intent_status': r.get('status'),
        'checkout_http': checkout_code,
        'checkout_not_expired': True,
        'reference_sha256': digest(reference),
        'customer_id_sha256': digest(customer_id),
        'temporary_signup_api_keys_deleted': True,
        'active_subscription_count': 0,
        'plan_activated_event_count': 0,
        'customer_plan_before_payment': 'FREE',
        'raw_api_key_published': False,
        'raw_customer_id_published': False,
        'raw_reference_published': False,
        'payer_url_logged': False,
        'payer_url_artifact_only': True,
        'production_worker_mutation': False,
        'live_trading_authorized': False,
        'trade_execution_authorized': False,
        'profitability': 'NOT_YET_CERTIFIED',
        'superiority': 'NOT_CERTIFIED',
    }
    raw = (json.dumps(evidence, indent=2, sort_keys=True) + '\n').encode()
    pathlib.Path('fmi-real-money-certification-checkout-initiation.json').write_bytes(raw)
    ev_sha = hashlib.sha256(raw).hexdigest()
    pathlib.Path('fmi-real-money-certification-checkout-initiation.sha256').write_text(
        ev_sha + '  fmi-real-money-certification-checkout-initiation.json\n', encoding='utf-8'
    )
    print(json.dumps({
        'gate': evidence['gate'],
        'plan': PLAN,
        'amount_cents': EXPECTED_AMOUNT,
        'currency': EXPECTED_CURRENCY,
        'provider_checkout_created': True,
        'payment_completed': False,
        'checkout_not_expired': True,
        'temporary_signup_api_keys_deleted': True,
        'raw_api_key_published': False,
        'raw_customer_id_published': False,
        'raw_reference_published': False,
        'payer_url_logged': False,
        'evidence_sha256': ev_sha,
    }, sort_keys=True))
finally:
    # If checkout creation failed before provider state was persisted, remove the disposable signup customer.
    if customer_id and not provider_created:
        try:
            d1('DELETE FROM api_keys WHERE customer_id=?1', [customer_id])
            d1('DELETE FROM customers WHERE id=?1', [customer_id])
        except Exception:
            pass

import datetime, hashlib, json, os, urllib.error, urllib.parse, urllib.request

CF_API = os.environ['CF_API'].rstrip('/')
ACCOUNT_ID = os.environ['ACCOUNT_ID']
DB_ID = os.environ['FMI_DB_UUID']
PUBLIC_BASE = os.environ['PUBLIC_BASE'].rstrip('/')
REFERENCE = os.environ.get('TARGET_REFERENCE', '').strip()
CF_HEADERS = {
    'X-Auth-Email': os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key': os.environ['CLOUDFLARE_API_KEY'],
    'Accept': 'application/json',
    'User-Agent': 'MUSITU-FMI-Revenue-State-Probe/1.0',
}

def http(url, method='GET', headers=None, body=None, timeout=45):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()

def d1(sql, params=None):
    headers = dict(CF_HEADERS)
    headers['Content-Type'] = 'application/json'
    payload = {'sql': sql}
    if params is not None:
        payload['params'] = params
    code, _, raw = http(
        f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query',
        'POST', headers, json.dumps(payload, separators=(',', ':')).encode()
    )
    if code != 200:
        raise RuntimeError(f'D1 HTTP {code}')
    obj = json.loads(raw or b'{}')
    if obj.get('success') is False:
        raise RuntimeError('D1 success=false')
    rows = []
    for item in obj.get('result') or []:
        if item.get('success') is not True:
            raise RuntimeError('D1 statement failed')
        rows.extend(item.get('results') or [])
    return rows

def public(path):
    code, headers, raw = http(
        PUBLIC_BASE + path,
        'GET',
        {'Accept': 'application/json', 'User-Agent': 'MUSITU-FMI-Revenue-State-Probe/1.0'}
    )
    try:
        obj = json.loads(raw or b'{}')
    except Exception:
        obj = {}
    return code, {k.lower(): v for k, v in headers.items()}, obj

def sha(v):
    return hashlib.sha256(str(v or '').encode()).hexdigest() if v else None

def parse_time(v):
    if not v:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone.utc)
    except Exception:
        return None

now = datetime.datetime.now(datetime.timezone.utc)
health_code, health_headers, health = public('/v1/billing/healthz?revenue_probe=1')
catalog_code, catalog_headers, catalog = public('/v1/billing/catalog?revenue_probe=1')

summary_rows = d1("SELECT status,plan,currency,count(*) AS n FROM billing_checkout_intents GROUP BY status,plan,currency ORDER BY status,plan,currency")
active_subs = d1("SELECT plan,status,count(*) AS n FROM billing_subscriptions GROUP BY plan,status ORDER BY plan,status")
activation_count = d1("SELECT count(*) AS n FROM lifecycle_events WHERE event_name='PLAN_ACTIVATED'")

out = {
    'schema': 'musitu.fmi.revenue-state-probe.v1',
    'gate': 'FMI_REVENUE_STATE_READONLY_PASS',
    'mutation_performed': False,
    'secret_values_read_or_logged': False,
    'public_base': PUBLIC_BASE,
    'billing_health_http': health_code,
    'billing_health_ok': health.get('ok'),
    'settlement_certified_flag': health.get('settlement_certified'),
    'catalog_http': catalog_code,
    'catalog': catalog.get('plans'),
    'checkout_status_summary': summary_rows,
    'subscription_summary': active_subs,
    'plan_activated_event_count': int((activation_count or [{'n': 0}])[0].get('n') or 0),
}

if REFERENCE:
    rows = d1("SELECT reference,customer_id,plan,amount_cents,currency,status,browser_url,poll_url,paynow_reference,created_at,expires_at,updated_at,completed_at FROM billing_checkout_intents WHERE reference=?1 LIMIT 2", [REFERENCE])
    if len(rows) > 1:
        raise RuntimeError('target reference is not unique')
    if not rows:
        out['target'] = {'present': False, 'reference_sha256': sha(REFERENCE)}
    else:
        r = rows[0]
        exp = parse_time(r.get('expires_at'))
        customer = str(r.get('customer_id') or '')
        subs = d1("SELECT plan,status,count(*) AS n FROM billing_subscriptions WHERE customer_id=?1 GROUP BY plan,status ORDER BY plan,status", [customer])
        acts = d1("SELECT count(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'", [customer])
        cust = d1("SELECT plan,status FROM customers WHERE id=?1 LIMIT 2", [customer])
        browser = str(r.get('browser_url') or '')
        poll = str(r.get('poll_url') or '')
        def paynow_https(v):
            try:
                u = urllib.parse.urlparse(v)
                return u.scheme == 'https' and u.hostname in ('paynow.co.zw', 'www.paynow.co.zw')
            except Exception:
                return False
        out['target'] = {
            'present': True,
            'reference_sha256': sha(r.get('reference')),
            'customer_id_sha256': sha(customer),
            'plan': r.get('plan'),
            'amount_cents': r.get('amount_cents'),
            'currency': r.get('currency'),
            'status': r.get('status'),
            'created_at': r.get('created_at'),
            'expires_at': r.get('expires_at'),
            'updated_at': r.get('updated_at'),
            'completed_at_present': bool(r.get('completed_at')),
            'paynow_reference_present': bool(r.get('paynow_reference')),
            'browser_url_present': bool(browser),
            'browser_url_https_paynow': paynow_https(browser) if browser else False,
            'poll_url_present': bool(poll),
            'poll_url_https_paynow': paynow_https(poll) if poll else False,
            'expired_now': bool(exp and exp <= now),
            'customer_rows': len(cust),
            'customer_plan': cust[0].get('plan') if len(cust) == 1 else None,
            'customer_status': cust[0].get('status') if len(cust) == 1 else None,
            'subscription_summary': subs,
            'plan_activated_event_count': int((acts or [{'n': 0}])[0].get('n') or 0),
        }

blob = (json.dumps(out, indent=2, sort_keys=True) + '\n').encode()
open('fmi-revenue-state-probe.json', 'wb').write(blob)
digest = hashlib.sha256(blob).hexdigest()
open('fmi-revenue-state-probe.sha256', 'w').write(digest + '  fmi-revenue-state-probe.json\n')
print(json.dumps({
    'gate': out['gate'],
    'billing_health_http': out['billing_health_http'],
    'settlement_certified_flag': out['settlement_certified_flag'],
    'target': out.get('target'),
    'evidence_sha256': digest,
    'mutation_performed': False,
    'secret_values_read_or_logged': False,
}, sort_keys=True))

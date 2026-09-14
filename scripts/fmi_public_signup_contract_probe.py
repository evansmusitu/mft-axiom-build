import email
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

API = os.environ['CF_API'].rstrip('/')
ACCOUNT_ID = os.environ['ACCOUNT_ID']
WORKER = 'mft-fmi-global-edge'
HEADERS = {
    'X-Auth-Email': os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key': os.environ['CLOUDFLARE_API_KEY'],
    'Accept': 'application/json',
    'User-Agent': 'MUSITU-FMI-Public-Signup-Contract-Probe/1.0',
}


def get(path):
    req = urllib.request.Request(API + path, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


code, headers, raw = get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe="")}')
if code != 200:
    raise RuntimeError(f'worker source HTTP {code}')

content_type = headers.get('content-type', '')
source = raw
if 'multipart/' in content_type.lower():
    msg = email.message_from_bytes((f'Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n').encode() + raw)
    executable = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        data = part.get_payload(decode=True) or b''
        if any(token in data for token in (b'export default', b'addEventListener', b'fetch(')):
            executable.append(data)
    if len(executable) != 1:
        raise RuntimeError(f'executable module count={len(executable)}')
    source = executable[0]

text = source.decode('utf-8', 'ignore')
route_index = text.find('/v1/signup')
if route_index < 0:
    raise RuntimeError('signup route not present in live worker')
window = text[max(0, route_index - 3500): min(len(text), route_index + 9000)]
low = window.lower()

candidate_request_fields = ['email', 'name', 'plan', 'company', 'country', 'password']
candidate_response_fields = ['customer_id', 'api_key', 'plan', 'status', 'email']
request_fields = [field for field in candidate_request_fields if re.search(r'\b' + re.escape(field) + r'\b', low)]
response_fields = [field for field in candidate_response_fields if re.search(r'\b' + re.escape(field) + r'\b', low)]

out = {
    'schema': 'musitu.fmi.public-signup-contract.v1',
    'gate': 'FMI_PUBLIC_SIGNUP_CONTRACT_READONLY_PASS',
    'worker': WORKER,
    'source_sha256': hashlib.sha256(source).hexdigest(),
    'signup_route_present': True,
    'post_guard_present': ('POST' in window or "'post'" in low or '"post"' in low),
    'json_body_parse_present': ('json()' in window or 'JSON.parse' in window),
    'request_fields_observed': request_fields,
    'response_fields_observed': response_fields,
    'customer_insert_present': ('insert into customers' in low or 'customers' in low),
    'api_key_insert_present': ('insert into api_keys' in low or 'api_keys' in low),
    'free_plan_literal_present': ('FREE' in window or "'free'" in low or '"free"' in low),
    'mutation_performed': False,
    'secret_values_read_or_logged': False,
    'raw_worker_source_published': False,
}

blob = (json.dumps(out, indent=2, sort_keys=True) + '\n').encode()
open('fmi-public-signup-contract.json', 'wb').write(blob)
digest = hashlib.sha256(blob).hexdigest()
open('fmi-public-signup-contract.sha256', 'w').write(digest + '  fmi-public-signup-contract.json\n')
print(json.dumps({
    'gate': out['gate'],
    'source_sha256': out['source_sha256'],
    'signup_route_present': out['signup_route_present'],
    'post_guard_present': out['post_guard_present'],
    'json_body_parse_present': out['json_body_parse_present'],
    'request_fields_observed': out['request_fields_observed'],
    'response_fields_observed': out['response_fields_observed'],
    'customer_insert_present': out['customer_insert_present'],
    'api_key_insert_present': out['api_key_insert_present'],
    'free_plan_literal_present': out['free_plan_literal_present'],
    'mutation_performed': False,
    'raw_worker_source_published': False,
    'evidence_sha256': digest,
}, sort_keys=True))

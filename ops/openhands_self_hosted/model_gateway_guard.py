"""Bounded S2 model access admission for a future isolated broker service.

No HTTP listener, no provider connection and no authority issuer exist here.
Tests use a fake transport; runtime/model qualification remains NOT_PROVEN.
The signing key and provider credentials must be held OUTSIDE agent containers.
"""
import hashlib
import hmac
import json
import math
import re
import threading
import time


class ModelAccessDenied(ValueError):
    pass


class ModelTransportError(RuntimeError):
    pass


CAPABILITY_SCHEMA = 'musitu.axiom.trackb.model-capability.v1'
_FIELDS = frozenset({
    'schema', 'tenant_id', 'project_id', 'work_id', 'workload_identity_id',
    'provider', 'model', 'risk_class', 'external_model_read_authorized',
    'builder_id', 'independent_approver_id', 'max_calls',
    'max_output_tokens_per_call', 'not_before_unix', 'expires_unix',
    'nonce', 'request_sha256', 'data_classification',
    'external_prompt_egress_authorized',
    'production_authority', 'release_authority',
    'certification_authority',
})
_REQUEST_FIELDS = frozenset({'model', 'messages', 'max_output_tokens'})
_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$')
_NONCE = re.compile(r'^[0-9a-f]{32,64}$')
_SHA = re.compile(r'^[0-9a-f]{64}$')
_PROVIDER_ORIGIN = 'api.openai.com'
_PROVIDER_PATH = '/v1/chat/completions'
_TEST_MODEL = 'gpt-4.1-mini'
_MAX_VALIDITY_SECONDS = 60
_MAX_ALLOWED_REQUEST_BYTES = 32768


def _deny(message):
    raise ModelAccessDenied(message)


def _is_int(value):
    return type(value) is int


def _normalized_id(name, value):
    if type(value) is not str or not _ID.fullmatch(value) or '..' in value:
        _deny('invalid ' + name)
    return value


def _canonical_bytes(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, OverflowError):
        _deny('invalid canonical model authority envelope')


class ModelGatewayGuard:
    """Validates an externally signed, per-operation S2 grant before transport."""

    def __init__(self, *, signing_key, provider_credential, transport, clock=time.time,
                 reservation_ledger=None):
        if type(signing_key) is not bytes or len(signing_key) < 32:
            raise ValueError('independent model policy signing key required')
        if type(provider_credential) is not str or not provider_credential.strip():
            raise ValueError('broker-only provider credential required')
        if not callable(transport) or not callable(clock):
            raise TypeError('transport and clock required')
        self._signing_key = signing_key
        self._credential = provider_credential
        self._transport = transport
        self._clock = clock
        if reservation_ledger is not None and not callable(getattr(reservation_ledger,'reserve',None)):
            raise TypeError('transactional model reservation ledger required')
        self._ledger = reservation_ledger
        self._reservations = {}
        self._lock = threading.Lock()

    def _verify(self, capability, signature, workload_identity_id):
        if type(capability) is not dict or set(capability) != _FIELDS:
            _deny('model capability requires exact signed fields')
        if type(signature) is not str or not _SHA.fullmatch(signature):
            _deny('model capability signature invalid')
        actual = hmac.new(self._signing_key, _canonical_bytes(capability),
                          hashlib.sha256).hexdigest()
        if not hmac.compare_digest(actual, signature):
            _deny('model capability signature does not match')
        if capability['schema'] != CAPABILITY_SCHEMA:
            _deny('model capability schema mismatch')
        for field in ('tenant_id', 'project_id', 'work_id',
                      'workload_identity_id', 'builder_id', 'independent_approver_id'):
            _normalized_id(field, capability[field])
        if type(workload_identity_id) is not str or workload_identity_id != capability['workload_identity_id']:
            _deny('workload identity binding mismatch')
        if capability['builder_id'] == capability['independent_approver_id']:
            _deny('builder cannot be independent approver')
        if (capability['provider'] != 'openai' or capability['model'] != _TEST_MODEL or
                capability['risk_class'] != 'S2' or
                capability['external_model_read_authorized'] is not True):
            _deny('provider, model or S2 authority not admitted')
        if any(capability[k] is not False for k in
               ('production_authority', 'release_authority', 'certification_authority')):
            _deny('model capability cannot acquire production/release authority')
        calls = capability['max_calls']
        tokens = capability['max_output_tokens_per_call']
        if not _is_int(calls) or not 1 <= calls <= 10:
            _deny('capability model-call budget invalid')
        if not _is_int(tokens) or not 1 <= tokens <= 512:
            _deny('capability output-token budget invalid')
        start = capability['not_before_unix']
        expiry = capability['expires_unix']
        if (not _is_int(start) or not _is_int(expiry)
                or not 0 < expiry - start <= _MAX_VALIDITY_SECONDS):
            _deny('capability lifetime not admitted')
        now = self._clock()
        if (type(now) not in (int, float) or not math.isfinite(now)
                or now < start or now >= expiry):
            _deny('model capability expired or not yet active')
        if capability['data_classification'] != 'synthetic-public':
            _deny('private or unclassified prompts are not approved for external model egress')
        if capability['external_prompt_egress_authorized'] is not True:
            _deny('external prompt egress is not authorized')
        if (type(capability['request_sha256']) is not str or
                not _SHA.fullmatch(capability['request_sha256'])):
            _deny('signed exact model request digest missing')
        if type(capability['nonce']) is not str or not _NONCE.fullmatch(capability['nonce']):
            _deny('invalid model operation nonce')
        return actual

    def _request(self, request, capability):
        if type(request) is not dict or set(request) != _REQUEST_FIELDS:
            _deny('model request requires exact permitted fields')
        if hashlib.sha256(_canonical_bytes(request)).hexdigest() != capability['request_sha256']:
            _deny('model request payload differs from independently authorized digest')
        if request['model'] != capability['model']:
            _deny('model request target drift')
        limit = request['max_output_tokens']
        if not _is_int(limit) or not 1 <= limit <= capability['max_output_tokens_per_call']:
            _deny('model output-token allowance exceeded')
        messages = request['messages']
        if type(messages) is not list or not 1 <= len(messages) <= 20:
            _deny('model messages invalid')
        for message in messages:
            if type(message) is not dict or set(message) != {'role', 'content'}:
                _deny('model message schema invalid')
            if message['role'] not in ('system', 'user', 'assistant'):
                _deny('model message role not admitted')
            if type(message['content']) is not str or len(message['content']) > 8192:
                _deny('model message content exceeds limits')
        payload = {
            'model': capability['model'],
            'messages': messages,
            'max_completion_tokens': limit,
            'stream': False,
        }
        if len(_canonical_bytes(payload)) > _MAX_ALLOWED_REQUEST_BYTES:
            _deny('model request total bytes exceed limit')
        return payload

    def submit(self, *, capability, signature, request, workload_identity_id):
        binding = self._verify(capability, signature, workload_identity_id)
        body = self._request(request, capability)
        nonce = capability['nonce']
        # Reservation happens BEFORE any external call, under a single lock.
        # Failed calls also consume the slot, deliberately fail-closed.
        if self._ledger is not None:
            try:
                reserved=self._ledger.reserve(nonce=nonce,binding=binding,
                                              max_calls=capability['max_calls'])
            except Exception:
                raise ModelAccessDenied('model budget reservation denied or unavailable') from None
            if type(reserved) is not int or not 1 <= reserved <= capability['max_calls']:
                _deny('model reservation ledger violated bounded receipt contract')
        else:
            # Pure unit-test/local CI mode, NEVER a production cost gate.
            with self._lock:
                existing = self._reservations.get(nonce)
                if existing is not None and existing['binding'] != binding:
                    _deny('model capability nonce reused across authority envelopes')
                if existing is None:
                    existing = {'binding': binding, 'used': 0}
                    self._reservations[nonce] = existing
                if existing['used'] >= capability['max_calls']:
                    _deny('model capability call budget exhausted')
                existing['used'] += 1
                reserved = existing['used']
        try:
            result = self._transport(_PROVIDER_ORIGIN, _PROVIDER_PATH,
                                     self._credential, body, 20)
        except Exception:
            raise ModelTransportError('model transport failed without leaking credentials') from None
        if type(result) is not dict or 'choices' not in result:
            raise ModelTransportError('model transport returned invalid response')
        try:
            encoded = _canonical_bytes(result)
        except ModelAccessDenied:
            raise ModelTransportError('model transport returned unserializable response') from None
        if len(encoded) > 1024 * 1024 or self._credential.encode('utf-8') in encoded:
            raise ModelTransportError('model transport response rejected')
        receipt = {
            'schema': 'musitu.axiom.trackb.model-gateway-receipt.v1',
            'workload_identity_id': capability['workload_identity_id'],
            'tenant_id': capability['tenant_id'],
            'project_id': capability['project_id'],
            'work_id': capability['work_id'],
            'capability_sha256': hashlib.sha256(_canonical_bytes(capability)).hexdigest(),
            'model': capability['model'],
            'data_classification': 'synthetic-public',
            'request_sha256': capability['request_sha256'],
            'calls_reserved': reserved,
            'max_calls': capability['max_calls'],
            'budget_backend': 'LOCAL_SQLITE' if self._ledger is not None else 'EPHEMERAL_CI_ONLY',
            'provider_transport_attempted': True,
            'live_runtime_qualification': 'NOT_PROVEN',
            'release_authority': False,
            'production_authority': False,
            'certification_authority': False,
        }
        return receipt, result

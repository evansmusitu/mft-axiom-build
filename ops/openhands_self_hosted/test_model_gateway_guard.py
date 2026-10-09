"""B2 signed, bounded model-gateway admission tests (no external model calls)."""
import base64
import hashlib
import hmac
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from model_gateway_guard import ModelGatewayGuard, ModelAccessDenied, ModelTransportError

SIGNER = b's' * 32
ACTOR = 'axiom-worker-01'


def issued_claims(**override):
    c = {
        'schema': 'musitu.axiom.trackb.model-capability.v1',
        'tenant_id': 'tenant_alpha',
        'project_id': 'project_alpha',
        'work_id': 'work_alpha',
        'workload_identity_id': ACTOR,
        'provider': 'openai',
        'model': 'gpt-4.1-mini',
        'risk_class': 'S2',
        'external_model_read_authorized': True,
        'builder_id': ACTOR,
        'independent_approver_id': 'independent-policy-gateway',
        'max_calls': 2,
        'max_output_tokens_per_call': 128,
        'not_before_unix': 1000,
        'expires_unix': 1060,
        'nonce': 'a' * 32,
        'production_authority': False,
        'release_authority': False,
        'certification_authority': False,
    }
    c.update(override)
    return c


def sign(claims, key=SIGNER):
    canonical = json.dumps(claims, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hmac.new(key, canonical, hashlib.sha256).hexdigest()


def work(model='gpt-4.1-mini', max_output_tokens=100, **extra):
    return {'model': model, 'messages': [
        {'role':'system','content':'Return a single word.'},
        {'role':'user','content':'test'}],
        'max_output_tokens': max_output_tokens, **extra}


class GatewayGuardTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.now = 1020
        def upstream(origin, path, credential, body, timeout_seconds):
            self.calls.append((origin,path,credential,body,timeout_seconds))
            return {'choices':[{'message':{'role':'assistant','content':'PASS'}}]}
        self.transport=upstream
        self.guard=ModelGatewayGuard(signing_key=SIGNER, provider_credential='FAKE_ONLY',
                                     transport=self.transport, clock=lambda:self.now)

    def submit(self, claims=None, signature=None, request=None, actor=ACTOR):
        claims = issued_claims() if claims is None else claims
        signature = sign(claims) if signature is None else signature
        request = work() if request is None else request
        return self.guard.submit(capability=claims, signature=signature,
                                 request=request, workload_identity_id=actor)

    def test_signed_capability_and_secret_redaction(self):
        receipt, response = self.submit()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][0], 'api.openai.com')
        self.assertEqual(self.calls[0][1], '/v1/chat/completions')
        self.assertEqual(self.calls[0][2], 'FAKE_ONLY')
        self.assertEqual(receipt['calls_reserved'], 1)
        self.assertEqual(receipt['max_calls'], 2)
        self.assertEqual(receipt['live_runtime_qualification'], 'NOT_PROVEN')
        self.assertFalse(receipt['production_authority'])
        self.assertNotIn('FAKE_ONLY', repr(receipt)+repr(response))
        self.assertNotIn('Return a single word.', repr(receipt))
        self.assertEqual(response['choices'][0]['message']['content'],'PASS')

    def test_tampering_unapproved_role_and_wrong_key_rejected(self):
        c=issued_claims()
        for altered,sig,who in [
            ({**c, 'max_calls':100},sign(c),ACTOR),
            (c,sign(c,b'wrong'*8),ACTOR),
            (c,sign(c),'different-worker'),
            ({**c,'builder_id':'identical','independent_approver_id':'identical'},None,ACTOR),
            ({**c,'risk_class':'S3'},None,ACTOR),
            ({**c,'external_model_read_authorized':False},None,ACTOR),
            ({**c,'production_authority':True},None,ACTOR)
        ]:
            with self.subTest(altered=altered,who=who), self.assertRaises(ModelAccessDenied):
                self.submit(altered, sig if sig is not None else sign(altered), actor=who)
        self.assertEqual(self.calls,[])

    def test_expired_or_future_authorizations_rejected(self):
        for change in ({'expires_unix':1019},{'not_before_unix':1021},{'expires_unix':1100}):
            c=issued_claims(**change)
            with self.subTest(change=change), self.assertRaises(ModelAccessDenied):
                self.submit(c)
        self.assertEqual(self.calls,[])

    def test_payload_requires_bounded_messages_and_exact_fields(self):
        invalid=[
            {**work(), 'base_url':'https://evil.com'},
            {**work(), 'api_key':'please-leak'},
            {**work(), 'stream':True},
            work(model='unapproved-model'),
            work(max_output_tokens=129),
            work(max_output_tokens=0),
            {'model':'gpt-4.1-mini','messages':[],'max_output_tokens':20},
            {'model':'gpt-4.1-mini','messages':[{'role':'tool','content':'cmd'}],'max_output_tokens':20},
            {'model':'gpt-4.1-mini','messages':[{'role':'user','content':'test','url':'https://bad'}],'max_output_tokens':20}
        ]
        for req in invalid:
            with self.subTest(req=req), self.assertRaises(ModelAccessDenied):
                self.submit(request=req)
        self.assertEqual(self.calls,[])

    def test_budget_enforced_without_third_model_call(self):
        for _ in range(2):
            self.submit()
        with self.assertRaises(ModelAccessDenied):
            self.submit()
        self.assertEqual(len(self.calls),2)

    def test_distinct_nonce_separates_budget_without_cross_tenant_replay(self):
        self.submit()
        altered=issued_claims(nonce='b'*32,tenant_id='tenant_beta')
        self.submit(altered)
        self.assertEqual(len(self.calls),2)

    def test_failed_transport_consumes_reservation_and_does_not_expose_token(self):
        def fail(*args):
            raise RuntimeError('network error includes secret token FAKE_ONLY')
        self.guard=ModelGatewayGuard(signing_key=SIGNER, provider_credential='FAKE_ONLY',
                                     transport=fail, clock=lambda:self.now)
        for _ in range(2):
            with self.assertRaises(ModelTransportError) as ctx:
                self.submit()
            self.assertNotIn('FAKE_ONLY',str(ctx.exception))
        with self.assertRaises(ModelAccessDenied):
            self.submit()

    def test_concurrent_admission_respects_max_calls(self):
        barrier=threading.Barrier(12)
        def attempt(_):
            barrier.wait()
            try:
                self.submit()
                return True
            except ModelAccessDenied:
                return False
        with ThreadPoolExecutor(max_workers=12) as pool:
            results=list(pool.map(attempt,range(12)))
        self.assertEqual(sum(results),2)
        self.assertEqual(len(self.calls),2)

    def test_credential_never_fed_from_model_request(self):
        malicious={**work(), 'provider_credential':'attacker-controlled'}
        with self.assertRaises(ModelAccessDenied):
            self.submit(request=malicious)

    def test_missing_signing_key_rejected(self):
        with self.assertRaises((ValueError,TypeError)):
            ModelGatewayGuard(signing_key=b'weak', provider_credential='FAKE_ONLY',
                              transport=self.transport,clock=lambda:self.now)


if __name__=='__main__':
    unittest.main()

import hashlib
import importlib.util
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts/fmi_v9_5_atomic_promote.py'
spec = importlib.util.spec_from_file_location('v95', MODULE_PATH)
v95 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v95)


def set_env(monkeypatch):
    now=datetime.now(timezone.utc)
    values={
      'FMI_PUBLIC_EDGE_URL':'https://edge.example',
      'FMI_MARKET_PROBE_SYMBOL':'EURUSD',
      'FMI_MARKET_PROBE_HORIZON':'NEXT_4H',
      'FMI_MARKET_PROBE_MARKET_CLASS':'FOREX',
      'FMI_DEPLOYMENT_PROBE_API_KEY':'fmi_'+'7'*64,
      'TWELVE_DATA_API_KEY':'synthetic-provider-key',
      'TWELVE_DATA_LICENSE_AUTHORIZED':'true',
      'TWELVE_DATA_REDISTRIBUTION_AUTHORIZED':'true',
      'TWELVE_DATA_EXTERNAL_API_AUTHORIZED':'true',
      'TWELVE_DATA_RIGHTS_REFERENCE':'synthetic-rights-reference',
      'TWELVE_DATA_RIGHTS_EFFECTIVE_AT':(now-timedelta(days=1)).isoformat().replace('+00:00','Z'),
      'TWELVE_DATA_RIGHTS_EXPIRES_AT':(now+timedelta(days=30)).isoformat().replace('+00:00','Z'),
      'TWELVE_DATA_ALLOWED_MARKET_CLASSES':'FOREX,COMMODITIES,CRYPTO',
      'TWELVE_DATA_MAX_RETENTION_SECONDS':'86400',
      'TWELVE_DATA_ATTRIBUTION_REQUIRED':'true',
      'TWELVE_DATA_ATTRIBUTION_TEXT':'Data provided by Twelve Data',
      'TWELVE_DATA_ATTRIBUTION_URL':'https://twelvedata.com',
    }
    for k,v in values.items(): monkeypatch.setenv(k,v)
    return values


def body(monkeypatch, **updates):
    set_env(monkeypatch)
    rights,rh=v95.expected_rights()
    now=datetime.now(timezone.utc)
    x={
      'ok':True,'provider':'Twelve Data','symbol':'EURUSD','horizon':'NEXT_4H',
      'provider_health':'HEALTHY','returns':[.001,-.001,.002,-.0005,.0002,.0001],
      'context_hash':'a'*64,'provider_source_hash':'b'*64,'rights_hash':rh,'rights':rights,
      'routing':{'selected_provider':'Twelve Data','selected_role':'PRIMARY','fallback_used':False,'bearer_forwarded_to_provider':False,'customer_identity_forwarded_to_provider':False},
      'router':{'schema':'musitu.fmi.market-data-router.v1'},
      'attestation':{'integrity':'SERVER_ATTESTED','id':'mca_probe_123','analysis_input_hash':'c'*64,'expires_at':(now+timedelta(minutes=10)).isoformat().replace('+00:00','Z')},
      'provider_state':'BOUND','manual_fallback':False,
      'authority':{'paper_shadow_only':True,'live_trading':False,'trade_execution':False},
    }
    x.update(updates); return x


class Headers(dict):
    def get(self,k,default=None): return super().get(k.lower(),default)


class Response:
    def __init__(self, payload, status=200, cache='no-store'):
        self.status=status; self.payload=payload; self.headers=Headers({'cache-control':cache})
    def read(self,n=-1): return json.dumps(self.payload).encode()
    def __enter__(self): return self
    def __exit__(self,*a): return False


class FakePromotion:
    def __init__(self,tmp_path):
        self.output=tmp_path/'stage.json'; self.rolled_back=False; self.promoted=False
    def promote(self):
        self.promoted=True
        ev={'status':'PROMOTED_SOURCE_RIGHTS_CONFIG_AND_BINDINGS_VERIFIED','operations':['deploy_provider_private','content_put_v9_4_edge'],'secret_values_logged':False}
        self.output.write_text(json.dumps(ev))
        return ev
    def rollback(self): self.rolled_back=True


def test_expected_rights_hash_matches_stable_contract(monkeypatch):
    set_env(monkeypatch); rights,rh=v95.expected_rights()
    assert rights['provider']=='Twelve Data'
    assert rights['market_class']=='FOREX'
    assert rights['rights_reference_hash']==hashlib.sha256(b'synthetic-rights-reference').hexdigest()
    assert rh==v95.stable_hash(rights)


def test_probe_success_validates_attestation_rights_and_no_store(monkeypatch):
    payload=body(monkeypatch)
    opener=lambda req,timeout=45: Response(payload)
    got=v95.functional_probe(opener=opener,sleep=lambda _:None)
    assert got['attestation']['integrity']=='SERVER_ATTESTED'


def test_probe_rejects_tampered_rights_hash(monkeypatch):
    payload=body(monkeypatch,rights_hash='0'*64)
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None); assert False
    except RuntimeError as e: assert 'rights hash mismatch' in str(e)


def test_probe_rejects_rights_object_drift(monkeypatch):
    payload=body(monkeypatch); payload['rights']=dict(payload['rights']);payload['rights']['market_class']='COMMODITIES'
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None); assert False
    except RuntimeError as e: assert 'rights object mismatch' in str(e)


def test_probe_rejects_missing_server_attestation(monkeypatch):
    payload=body(monkeypatch);payload['attestation']['integrity']='UNATTESTED'
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None); assert False
    except RuntimeError as e: assert 'not server-attested' in str(e)


def test_probe_rejects_fallback(monkeypatch):
    payload=body(monkeypatch);payload['routing']['fallback_used']=True
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None); assert False
    except RuntimeError as e: assert 'unexpectedly used fallback' in str(e)


def test_probe_rejects_cacheable_response(monkeypatch):
    payload=body(monkeypatch)
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload,cache='public, max-age=60'),sleep=lambda _:None); assert False
    except RuntimeError as e: assert 'cache-control' in str(e)


def test_probe_rejects_private_value_leak(monkeypatch):
    payload=body(monkeypatch);payload['debug']='synthetic-rights-reference'
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None); assert False
    except RuntimeError as e: assert 'leaked a private value' in str(e)


def test_probe_key_sent_only_as_bearer(monkeypatch):
    payload=body(monkeypatch);seen={}
    def opener(req,timeout=45):
        seen['url']=req.full_url;seen['authorization']=req.get_header('Authorization');return Response(payload)
    v95.functional_probe(opener=opener,sleep=lambda _:None)
    assert seen['authorization']=='Bearer '+'fmi_'+'7'*64
    assert 'fmi_' not in seen['url']


def test_atomic_success_writes_only_final_public_safe_evidence(monkeypatch,tmp_path):
    payload=body(monkeypatch);p=FakePromotion(tmp_path);out=tmp_path/'final.json'
    a=v95.AtomicPromotion(p,out,probe=lambda:payload);ev=a.run()
    assert ev['status']=='PROMOTED_AND_FUNCTIONALLY_VERIFIED'
    assert ev['functional_market_context_probe']=='PASS'
    assert p.rolled_back is False
    raw=out.read_text()
    assert 'synthetic-rights-reference' not in raw and 'synthetic-provider-key' not in raw and ('fmi_'+'7'*64) not in raw
    assert not p.output.exists()


def test_atomic_probe_failure_rolls_back(monkeypatch,tmp_path):
    body(monkeypatch);p=FakePromotion(tmp_path);out=tmp_path/'final.json'
    def fail():raise RuntimeError('probe failed')
    try:v95.AtomicPromotion(p,out,probe=fail).run(); assert False
    except RuntimeError as e:assert 'probe failed' in str(e)
    assert p.rolled_back is True
    assert not out.exists()


def test_probe_market_class_must_be_in_allowed_rights(monkeypatch):
    set_env(monkeypatch);monkeypatch.setenv('FMI_MARKET_PROBE_MARKET_CLASS','EQUITIES')
    try:v95.expected_rights();assert False
    except RuntimeError as e:assert 'outside provider rights' in str(e)


def test_probe_rejects_authority_drift(monkeypatch):
    payload=body(monkeypatch);payload['authority']['live_trading']=True
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None);assert False
    except RuntimeError as e:assert 'authority drift' in str(e)


def test_probe_rejects_rights_authorization_drift(monkeypatch):
    set_env(monkeypatch);monkeypatch.setenv('TWELVE_DATA_EXTERNAL_API_AUTHORIZED','false')
    try:v95.expected_rights();assert False
    except RuntimeError as e:assert 'authorization drift' in str(e)


def test_probe_rejects_wrong_binding_state(monkeypatch):
    payload=body(monkeypatch);payload['provider_state']='NOT_BOUND'
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None);assert False
    except RuntimeError as e:assert 'binding state mismatch' in str(e)


def test_probe_requires_distinct_probe_and_provider_keys(monkeypatch):
    set_env(monkeypatch);monkeypatch.setenv('TWELVE_DATA_API_KEY','fmi_'+'7'*64)
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(body(monkeypatch)),sleep=lambda _:None);assert False
    except RuntimeError as e:assert 'distinct from provider key' in str(e)


def test_probe_requires_https_edge(monkeypatch):
    payload=body(monkeypatch);monkeypatch.setenv('FMI_PUBLIC_EDGE_URL','http://edge.example')
    try:v95.functional_probe(opener=lambda req,timeout=45:Response(payload),sleep=lambda _:None);assert False
    except RuntimeError as e:assert 'must use HTTPS' in str(e)

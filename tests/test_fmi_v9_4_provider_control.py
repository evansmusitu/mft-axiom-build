import importlib.util
import json
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

BASE = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('FMI_V94_PAYLOAD_ROOT','/tmp/fmi-v9-4-runtime'))
PROMOTE_PATH = BASE/'scripts/fmi_v9_4_provider_promote.py'
PREFLIGHT_PATH = BASE/'scripts/fmi_v9_4_provider_preflight.py'

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

prom = load('v94prom', PROMOTE_PATH)
pre = load('v94pre', PREFLIGHT_PATH)

BASE_ENV = {
    'FMI_EDGE': 'mft-fmi-global-edge',
    'FMI_BILLING': 'mft-fmi-billing',
    'FMI_ADAPTER': 'mft-fmi-modal-adapter',
    'FMI_DB_UUID': 'a03dc12d-8206-47be-b904-1f24e4e37d91',
    'FMI_MARKET_ROUTER': 'mft-fmi-market-router',
    'FMI_TWELVE_DATA_ADAPTER': 'mft-fmi-twelve-data-adapter',
    'TWELVE_DATA_LICENSE_AUTHORIZED': 'true',
    'TWELVE_DATA_REDISTRIBUTION_AUTHORIZED': 'true',
    'TWELVE_DATA_EXTERNAL_API_AUTHORIZED': 'true',
    'TWELVE_DATA_API_KEY': 'synthetic-test-provider-key',
    'TWELVE_DATA_ENTITLEMENT_LABEL': 'synthetic-commercial-entitlement',
    'TWELVE_DATA_FRESHNESS_LABEL': 'synthetic-realtime',
    'TWELVE_DATA_RIGHTS_REFERENCE': 'synthetic-rights-ref-not-a-real-license',
    'TWELVE_DATA_ALLOWED_MARKET_CLASSES': 'FOREX,COMMODITIES,CRYPTO',
    'TWELVE_DATA_MAX_RETENTION_SECONDS': '86400',
    'TWELVE_DATA_ATTRIBUTION_REQUIRED': 'true',
    'TWELVE_DATA_ATTRIBUTION_TEXT': 'Synthetic Twelve Data attribution',
    'TWELVE_DATA_ATTRIBUTION_URL': 'https://example.invalid/provider-rights-test',
}

def set_env(monkeypatch, **updates):
    now = datetime.now(timezone.utc)
    values = dict(BASE_ENV)
    values['TWELVE_DATA_RIGHTS_EFFECTIVE_AT'] = (now - timedelta(days=1)).isoformat().replace('+00:00','Z')
    values['TWELVE_DATA_RIGHTS_EXPIRES_AT'] = (now + timedelta(days=30)).isoformat().replace('+00:00','Z')
    values.update(updates)
    for k, v in values.items():
        monkeypatch.setenv(k, v)
    return values

class FakeCF:
    def __init__(self, fail_at=None, collision=False):
        self.fail_at = fail_at
        self.failed_once = False
        self.calls = []
        self.sources = {
            'mft-fmi-global-edge': b'live-edge',
            'mft-fmi-billing': b'billing',
            'mft-fmi-modal-adapter': b'adapter',
        }
        # Override hashes to exact expected by storing synthetic bytes plus monkeypatching sha in fixture.
        self.bindings = {
            'mft-fmi-global-edge': [
                {'type':'d1','name':'FMI_DB','id':'a03dc12d-8206-47be-b904-1f24e4e37d91'},
                {'type':'service','name':'FMI_KERNEL','service':'mft-fmi-modal-adapter'},
                {'type':'service','name':'FMI_BILLING','service':'mft-fmi-billing'},
            ]
        }
        self.exposure = {}
        self.secret_values = {}
        if collision:
            self.sources['mft-fmi-market-router'] = b'collision'

    def _call(self, op):
        self.calls.append(op)
        if self.fail_at == op and not self.failed_once:
            self.failed_once = True
            raise RuntimeError('synthetic failure at ' + op)

    def source(self, name, allow_missing=False):
        if name not in self.sources:
            if allow_missing:
                return None
            raise RuntimeError('missing source: '+name)
        return self.sources[name]

    def settings(self, name):
        return {'bindings': list(self.bindings.get(name, []))}

    def patch_settings(self, name, bindings):
        self._call('patch_settings:'+name)
        self.bindings[name] = [dict(x) for x in bindings]

    def subdomain(self, name):
        return dict(self.exposure.get(name, {'enabled':False,'previews_enabled':False}))

    def set_private(self, name):
        self._call('set_private:'+name)
        self.exposure[name] = {'enabled':False,'previews_enabled':False}

    def upload(self, name, src):
        self._call('upload:'+name)
        self.sources[name] = bytes(src)
        self.bindings.setdefault(name, [])

    def secret(self, name, key, value):
        self._call('secret:'+name+':'+key)
        self.secret_values.setdefault(name, {})[key] = value
        # Model Cloudflare settings secret bindings without exposing values.
        existing = {x.get('name'):x for x in self.bindings.setdefault(name, [])}
        existing[key] = {'type':'secret_text','name':key}
        self.bindings[name] = list(existing.values())

    def delete(self, name):
        self._call('delete:'+name)
        self.sources.pop(name, None)
        self.bindings.pop(name, None)
        self.exposure.pop(name, None)
        self.secret_values.pop(name, None)


def patch_expected_sha(monkeypatch):
    real_sha = prom.sha
    mapping = {
        b'live-edge': prom.EXPECTED['live_edge'],
        b'billing': prom.EXPECTED['billing'],
        b'adapter': prom.EXPECTED['adapter'],
    }
    def fake_sha(data):
        return mapping.get(bytes(data), real_sha(data))
    monkeypatch.setattr(prom, 'sha', fake_sha)


def build(monkeypatch, tmp_path, fail_at=None, collision=False):
    set_env(monkeypatch)
    patch_expected_sha(monkeypatch)
    cf = FakeCF(fail_at=fail_at, collision=collision)
    out = tmp_path/'promotion.json'
    p = prom.Promotion(cf, ROOT, out)
    return cf, p, out


def test_preflight_rights_gate_all_valid(monkeypatch):
    set_env(monkeypatch)
    r = pre.rights_gate()
    assert r and all(r.values())


def test_preflight_external_api_denied(monkeypatch):
    set_env(monkeypatch, TWELVE_DATA_EXTERNAL_API_AUTHORIZED='false')
    r = pre.rights_gate()
    assert r['external_api_authorized'] is False


def test_preflight_expired_window(monkeypatch):
    now = datetime.now(timezone.utc)
    set_env(monkeypatch,
            TWELVE_DATA_RIGHTS_EFFECTIVE_AT=(now-timedelta(days=3)).isoformat(),
            TWELVE_DATA_RIGHTS_EXPIRES_AT=(now-timedelta(days=1)).isoformat())
    assert pre.rights_gate()['rights_temporal_window_valid'] is False


def test_preflight_invalid_market_class(monkeypatch):
    set_env(monkeypatch, TWELVE_DATA_ALLOWED_MARKET_CLASSES='FOREX,EQUITIES')
    assert pre.rights_gate()['allowed_market_classes_valid'] is False


def test_preflight_attribution_requires_https_metadata(monkeypatch):
    set_env(monkeypatch, TWELVE_DATA_ATTRIBUTION_REQUIRED='true', TWELVE_DATA_ATTRIBUTION_URL='http://insecure.invalid')
    assert pre.rights_gate()['attribution_metadata_valid'] is False


def test_rights_absent_zero_mutation(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path)
    monkeypatch.setenv('TWELVE_DATA_REDISTRIBUTION_AUTHORIZED','false')
    try:
        p.promote()
        assert False, 'expected rights failure'
    except RuntimeError as e:
        assert 'rights gate' in str(e)
    assert cf.calls == []


def test_invalid_market_class_zero_mutation(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path)
    monkeypatch.setenv('TWELVE_DATA_ALLOWED_MARKET_CLASSES','FOREX,EQUITIES')
    try:
        p.promote(); assert False
    except RuntimeError as e:
        assert 'allowed market classes invalid' in str(e)
    assert cf.calls == []


def test_invalid_attribution_zero_mutation(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path)
    monkeypatch.setenv('TWELVE_DATA_ATTRIBUTION_URL','http://invalid.example')
    try:
        p.promote(); assert False
    except RuntimeError as e:
        assert 'attribution URL invalid' in str(e)
    assert cf.calls == []


def test_name_collision_zero_mutation(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path, collision=True)
    try:
        p.promote(); assert False
    except RuntimeError as e:
        assert 'planned private Worker name must be absent' in str(e)
    assert cf.calls == []


def test_happy_path_writes_all_rights_config_without_evidence_values(monkeypatch, tmp_path):
    cf, p, out = build(monkeypatch, tmp_path)
    ev = p.promote()
    assert ev['status'] == 'PROMOTED_SOURCE_RIGHTS_CONFIG_AND_BINDINGS_VERIFIED'
    assert ev['functional_market_context_probe'] == 'SEPARATE_REQUIRED'
    assert ev['secret_values_logged'] is False
    assert ev['live_trading'] is False and ev['trade_execution'] is False
    assert set(cf.secret_values[p.provider]) == set(prom.PROVIDER_CONFIG_NAMES)
    assert cf.secret_values[p.provider]['TWELVE_DATA_API_KEY'] == 'synthetic-test-provider-key'
    raw = out.read_text()
    assert 'synthetic-test-provider-key' not in raw
    assert 'synthetic-rights-ref-not-a-real-license' not in raw
    edge_bindings = {x['name']:x for x in cf.bindings[p.edge]}
    assert edge_bindings['FMI_MARKET_DATA']['service'] == p.router
    assert cf.exposure[p.provider]['enabled'] is False
    assert cf.exposure[p.router]['enabled'] is False
    assert 'mft-fmi-billing' in cf.sources and cf.sources['mft-fmi-billing'] == b'billing'
    assert 'mft-fmi-modal-adapter' in cf.sources and cf.sources['mft-fmi-modal-adapter'] == b'adapter'


def test_failure_after_edge_binding_rolls_back_exact_v81(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path, fail_at='upload:mft-fmi-global-edge')
    try:
        p.promote(); assert False
    except RuntimeError:
        pass
    assert cf.sources[p.edge] == b'live-edge'
    names = {x['name'] for x in cf.bindings[p.edge]}
    assert names == {'FMI_DB','FMI_KERNEL','FMI_BILLING'}
    assert p.router not in cf.sources and p.provider not in cf.sources
    rb = json.loads(Path('fmi-v9-4-provider-rollback-evidence.json').read_text())
    assert rb['rollback_verified'] is True
    assert rb['secret_values_logged'] is False


def test_failure_during_provider_config_rolls_back_and_deletes_private(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path, fail_at='secret:mft-fmi-twelve-data-adapter:TWELVE_DATA_RIGHTS_REFERENCE')
    try:
        p.promote(); assert False
    except RuntimeError:
        pass
    assert p.provider not in cf.sources and p.router not in cf.sources
    assert cf.sources[p.edge] == b'live-edge'


def test_candidate_hash_tamper_zero_mutation(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path)
    tampered = tmp_path/'payload'
    import shutil
    shutil.copytree(ROOT, tampered)
    q = tampered/'edge/fmi-market-data/RIGHTS_POLICY_CONTRACT.md'
    q.write_text(q.read_text()+'\nTAMPER\n')
    p = prom.Promotion(cf, tampered, tmp_path/'out.json')
    try:
        p.promote(); assert False
    except RuntimeError as e:
        assert 'candidate hash mismatch:rights_contract' in str(e)
    assert cf.calls == []

def test_preflight_attribution_false_needs_no_metadata(monkeypatch):
    set_env(monkeypatch,
            TWELVE_DATA_ATTRIBUTION_REQUIRED='false',
            TWELVE_DATA_ATTRIBUTION_TEXT='',
            TWELVE_DATA_ATTRIBUTION_URL='')
    r = pre.rights_gate()
    assert r['attribution_required_configured'] is True
    assert r['attribution_metadata_valid'] is True


def test_preflight_attribution_text_length_is_fail_closed(monkeypatch):
    set_env(monkeypatch,
            TWELVE_DATA_ATTRIBUTION_REQUIRED='true',
            TWELVE_DATA_ATTRIBUTION_TEXT='x'*161,
            TWELVE_DATA_ATTRIBUTION_URL='https://example.invalid/a')
    assert pre.rights_gate()['attribution_metadata_valid'] is False


def test_promotion_attribution_false_omits_optional_empty_secrets(monkeypatch, tmp_path):
    cf, p, out = build(monkeypatch, tmp_path)
    monkeypatch.setenv('TWELVE_DATA_ATTRIBUTION_REQUIRED','false')
    monkeypatch.setenv('TWELVE_DATA_ATTRIBUTION_TEXT','')
    monkeypatch.setenv('TWELVE_DATA_ATTRIBUTION_URL','')
    ev = p.promote()
    assert ev['status'] == 'PROMOTED_SOURCE_RIGHTS_CONFIG_AND_BINDINGS_VERIFIED'
    cfg = cf.secret_values[p.provider]
    assert 'TWELVE_DATA_ATTRIBUTION_TEXT' not in cfg
    assert 'TWELVE_DATA_ATTRIBUTION_URL' not in cfg
    assert cfg['TWELVE_DATA_ATTRIBUTION_REQUIRED'] == 'false'


def test_promotion_attribution_text_too_long_zero_mutation(monkeypatch, tmp_path):
    cf, p, _ = build(monkeypatch, tmp_path)
    monkeypatch.setenv('TWELVE_DATA_ATTRIBUTION_TEXT','x'*161)
    try:
        p.promote(); assert False
    except RuntimeError as e:
        assert 'attribution text too long' in str(e)
    assert cf.calls == []


def test_preflight_blocks_even_exact_existing_planned_worker(monkeypatch, tmp_path):
    set_env(monkeypatch)
    cf = FakeCF()
    cf.sources['mft-fmi-market-router'] = (ROOT/'edge/fmi-market-data/router.js').read_bytes()
    real_sha = pre.sha
    mapping = {
        b'live-edge': pre.EXPECTED['live_edge'],
        b'billing': pre.EXPECTED['billing'],
        b'adapter': pre.EXPECTED['adapter'],
    }
    monkeypatch.setattr(pre, 'sha', lambda b: mapping.get(bytes(b), real_sha(b)))
    monkeypatch.setattr(pre, 'CF', lambda: cf)
    out = tmp_path/'preflight.json'
    import sys
    monkeypatch.setattr(sys, 'argv', ['preflight','--payload-root',str(ROOT),'--output',str(out)])
    pre.main()
    state = json.loads(out.read_text())
    assert state['promotion_ready'] is False
    assert 'PLANNED_PRIVATE_WORKER_ALREADY_EXISTS:mft-fmi-market-router' in state['blockers']
    assert state['planned_workers']['mft-fmi-market-router']['state'] == 'EXACT_CANDIDATE'
    assert state['mutation_performed'] is False

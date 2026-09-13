import importlib.util, pathlib, os, json, tempfile, copy, hashlib
P=pathlib.Path(__file__).resolve().parents[1]/'scripts/fmi_v9_1_provider_promote.py'
s=importlib.util.spec_from_file_location('m',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

LIVE=b'live-edge'; BILL=b'billing'; ADAPT=b'adapter'; CAND=b'candidate-edge'; ROUTER=b'router'; PROVIDER=b'provider'
m.EXPECTED.update({'live_edge':m.sha(LIVE),'billing':m.sha(BILL),'adapter':m.sha(ADAPT),'candidate_edge':m.sha(CAND),'router':m.sha(ROUTER),'provider':m.sha(PROVIDER)})

class FakeCF:
    def __init__(self, fail=None, collision=False):
        self.aid='acct'; self.fail=fail; self.calls=[]
        self.workers={'edge':LIVE,'billing':BILL,'adapter':ADAPT}
        if collision:self.workers['router']=b'other'
        self.settings_map={'edge':{'bindings':[{'name':'FMI_DB','type':'d1','id':'db'},{'name':'FMI_KERNEL','type':'service','service':'adapter'},{'name':'FMI_BILLING','type':'service','service':'billing'}]}}
        self.sub={'billing':{'enabled':False,'previews_enabled':False},'adapter':{'enabled':False,'previews_enabled':False}}
        self.secrets={}
    def _hit(self,name):
        self.calls.append(name)
        if self.fail==name: raise RuntimeError('injected '+name)
    def source(self,name,allow_missing=False):
        if name not in self.workers:
            if allow_missing:return None
            raise RuntimeError('missing '+name)
        return self.workers[name]
    def settings(self,name):return copy.deepcopy(self.settings_map.get(name,{'bindings':[]}))
    def patch_settings(self,name,bindings):self._hit('patch:'+name);self.settings_map.setdefault(name,{})['bindings']=copy.deepcopy(bindings)
    def subdomain(self,name):return copy.deepcopy(self.sub.get(name,{'enabled':False,'previews_enabled':False}))
    def set_private(self,name):self._hit('private:'+name);self.sub[name]={'enabled':False,'previews_enabled':False}
    def upload(self,name,src):self._hit('upload:'+name);self.workers[name]=src;self.settings_map.setdefault(name,{'bindings':[]})
    def secret(self,name,key,value):self._hit('secret:'+key);self.secrets[(name,key)]='SET'
    def delete(self,name):self._hit('delete:'+name);self.workers.pop(name,None);self.settings_map.pop(name,None);self.sub.pop(name,None)
    def raw(self,*a,**k):return 200,{},b'{}'

def env():
    os.environ.update({'FMI_EDGE':'edge','FMI_BILLING':'billing','FMI_ADAPTER':'adapter','FMI_DB_UUID':'db','FMI_MARKET_ROUTER':'router','FMI_TWELVE_DATA_ADAPTER':'provider','TWELVE_DATA_LICENSE_AUTHORIZED':'true','TWELVE_DATA_REDISTRIBUTION_AUTHORIZED':'true','TWELVE_DATA_API_KEY':'fake-key','TWELVE_DATA_ENTITLEMENT_LABEL':'licensed','TWELVE_DATA_FRESHNESS_LABEL':'real_time','TWELVE_DATA_RIGHTS_REFERENCE':'contract-ref'})

def root(tmp):
    r=pathlib.Path(tmp);(r/'edge/fmi-global').mkdir(parents=True);(r/'edge/fmi-market-data/providers').mkdir(parents=True)
    (r/'edge/fmi-global/worker.js').write_bytes(CAND);(r/'edge/fmi-market-data/router.js').write_bytes(ROUTER);(r/'edge/fmi-market-data/providers/twelve-data-adapter.js').write_bytes(PROVIDER);return r

def test_rights_block_zero_mutation(tmp_path):
    env();os.environ['TWELVE_DATA_REDISTRIBUTION_AUTHORIZED']='false';cf=FakeCF();pr=m.Promotion(cf,root(tmp_path))
    try:pr.promote();assert False
    except RuntimeError:pass
    assert cf.calls==[] and cf.workers['edge']==LIVE

def test_collision_blocks_zero_mutation(tmp_path):
    env();cf=FakeCF(collision=True);pr=m.Promotion(cf,root(tmp_path))
    try:pr.promote();assert False
    except RuntimeError:pass
    assert cf.calls==[] and cf.workers['edge']==LIVE

def test_happy_order_and_protected_workers(tmp_path):
    env();cf=FakeCF();pr=m.Promotion(cf,root(tmp_path));ev=pr.promote()
    assert ev['status']=='PROMOTED_SOURCE_AND_BINDINGS_VERIFIED'
    assert cf.workers['edge']==CAND and cf.workers['router']==ROUTER and cf.workers['provider']==PROVIDER
    by={x['name']:x for x in cf.settings_map['edge']['bindings']};assert by['FMI_MARKET_DATA']['service']=='router'
    assert cf.workers['billing']==BILL and cf.workers['adapter']==ADAPT
    assert cf.sub['router']['enabled'] is False and cf.sub['provider']['enabled'] is False
    assert all(v=='SET' for v in cf.secrets.values())

def test_failure_after_binding_rolls_back(tmp_path):
    env();cf=FakeCF(fail='upload:edge');pr=m.Promotion(cf,root(tmp_path))
    try:pr.promote();assert False
    except RuntimeError:pass
    assert cf.workers['edge']==LIVE and 'router' not in cf.workers and 'provider' not in cf.workers
    assert {x['name'] for x in cf.settings_map['edge']['bindings']}=={'FMI_DB','FMI_KERNEL','FMI_BILLING'}
    assert cf.workers['billing']==BILL and cf.workers['adapter']==ADAPT

def test_failure_provider_privacy_rolls_back(tmp_path):
    env();cf=FakeCF(fail='private:provider');pr=m.Promotion(cf,root(tmp_path))
    try:pr.promote();assert False
    except RuntimeError:pass
    assert cf.workers['edge']==LIVE and 'provider' not in cf.workers and 'router' not in cf.workers

def test_no_rights_reference_logged(tmp_path):
    env();cf=FakeCF();out=tmp_path/'evidence.json';pr=m.Promotion(cf,root(tmp_path/'r'),out);ev=pr.promote();txt=out.read_text()
    assert 'contract-ref' not in txt and 'fake-key' not in txt and ev['secret_values_logged'] is False

from __future__ import annotations
import hashlib, json, time, uuid
from dataclasses import dataclass
from typing import Callable, Mapping, Any

ATOMIC_OPERATIONS=(
'algebra.expand','algebra.factor','algebra.polynomial_roots','algebra.simplify','algebra.solve','arithmetic.evaluate','calculus.diff','calculus.integrate','calculus.limit','calculus.product','calculus.series','calculus.sum','combinatorics.binomial','combinatorics.factorial','finance.beta','finance.black_scholes','finance.bond_price','finance.bond_yield','finance.compound','finance.cvar_historical','finance.drawdown','finance.duration','finance.greeks','finance.implied_vol','finance.monte_carlo_gbm','finance.npv','finance.portfolio_metrics','finance.returns','finance.var_historical','finance.var_parametric','geometry.area_circle','geometry.distance','geometry.volume_sphere','knowledge.constant','knowledge.element','linear.det','linear.eigen','linear.inv','linear.solve','numbertheory.factorint','numbertheory.gcd','numbertheory.isprime','numbertheory.lcm','numeric.integrate','numeric.interpolate','numeric.least_squares','numeric.ode','numeric.optimize_scalar','numeric.root','optimization.linear_program','optimization.quadratic','probability.binomial_pmf','probability.chi2_cdf','probability.exponential_cdf','probability.normal_cdf','probability.normal_ppf','probability.poisson_pmf','statistics.correlation','statistics.covariance','statistics.describe','statistics.normal_fit','statistics.quantile','statistics.regression','statistics.ttest_ind','statistics.zscore','timeseries.ewma','timeseries.moving_average','timeseries.rolling_volatility','transforms.fft','transforms.ifft','units.convert','verified.interval_eval','verify.crosscheck','verify.evaluate')
LANES=(
('quantitative',1),('research_source',2),('artifact_engine',3),('code_file',4),('browser_computer',5),('project_memory_context',6),('agents_mission_control',7),('automations_schedules',8),('mcp_enterprise',9),('live_multimodal',10))

class FabricError(RuntimeError): pass
class UnboundCapabilityError(FabricError): pass
class CapabilityPolicyError(FabricError): pass

@dataclass(frozen=True)
class Binding:
    lane:str
    adapter_id:str
    adapter:Callable[[str,Mapping[str,Any],Mapping[str,Any]],Any]
    production_proven:bool=False
    external:bool=False

def _json(v): return json.dumps(v,sort_keys=True,separators=(',',':'),default=str)
def _sha(v): return hashlib.sha256(_json(v).encode()).hexdigest()

class UnifiedToolFabric:
    def __init__(self):
        self._bindings={}
        self._quant=frozenset(ATOMIC_OPERATIONS)
        self._lanes={name:order for name,order in LANES}
    def bind(self,lane,adapter_id,adapter,*,production_proven=False,external=False):
        if lane not in self._lanes: raise CapabilityPolicyError('unknown lane')
        if not adapter_id or not callable(adapter): raise CapabilityPolicyError('invalid binding')
        self._bindings[lane]=Binding(lane,adapter_id,adapter,bool(production_proven),bool(external))
    def status(self):
        return [{'lane':lane,'order':order,'bound':lane in self._bindings,'adapter_id':self._bindings[lane].adapter_id if lane in self._bindings else None,'production_proven':self._bindings[lane].production_proven if lane in self._bindings else False} for lane,order in LANES]
    def resolve_lane(self,capability):
        if capability in self._quant:return 'quantitative'
        prefix=capability.split('.',1)[0]
        mapping={'research':'research_source','source':'research_source','artifact':'artifact_engine','code':'code_file','file':'code_file','browser':'browser_computer','computer':'browser_computer','memory':'project_memory_context','project':'project_memory_context','agent':'agents_mission_control','automation':'automations_schedules','mcp':'mcp_enterprise','enterprise':'mcp_enterprise','live':'live_multimodal','voice':'live_multimodal','camera':'live_multimodal','screen':'live_multimodal'}
        lane=mapping.get(prefix)
        if not lane: raise CapabilityPolicyError('capability is not registered in the unified fabric')
        return lane
    def invoke(self,capability,args,context):
        lane=self.resolve_lane(capability)
        binding=self._bindings.get(lane)
        if not binding: raise UnboundCapabilityError(f'lane is not bound: {lane}')
        required=('tenant_id','project_id','actor_id','task_id')
        missing=[k for k in required if not str(context.get(k,'')).strip()]
        if missing: raise CapabilityPolicyError('missing invocation context: '+','.join(missing))
        if binding.external and not context.get('external_authorized',False): raise CapabilityPolicyError('external adapter requires explicit authorization')
        request={'schema':'musitu.axiom.tool-invocation.v1','capability':capability,'lane':lane,'adapter_id':binding.adapter_id,'args':dict(args or {}),'tenant_id':context['tenant_id'],'project_id':context['project_id'],'actor_id':context['actor_id'],'task_id':context['task_id']}
        req_sha=_sha(request)
        result=binding.adapter(capability,dict(args or {}),dict(context))
        receipt={'schema':'musitu.axiom.tool-receipt.v1','receipt_id':'trc_'+uuid.uuid4().hex,'request_sha256':req_sha,'capability':capability,'lane':lane,'adapter_id':binding.adapter_id,'production_proven':binding.production_proven,'external':binding.external,'result':result,'created_at_ms':int(time.time()*1000)}
        receipt['receipt_sha256']=_sha({k:v for k,v in receipt.items() if k!='receipt_sha256'})
        return receipt
    @property
    def gate_state(self):
        all_bound=all(name in self._bindings for name,_ in LANES)
        all_prod=all(self._bindings.get(name) and self._bindings[name].production_proven for name,_ in LANES)
        return {'all_lanes_bound':all_bound,'all_lanes_production_proven':all_prod,'ar06_gate_earned':bool(all_bound and all_prod)}

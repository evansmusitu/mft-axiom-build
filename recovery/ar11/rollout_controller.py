from __future__ import annotations
import hashlib, json

SEQUENCE=(
    'ISOLATED_STAGING','INTERNAL_SHADOW','INDEPENDENT_VERIFICATION','CANARY_COHORT',
    'ROLLBACK_REHEARSAL','AWAITING_HUMAN_PRODUCTION_APPROVAL','GRADUAL_PRODUCTION_CUTOVER',
    'MONITORING_HOLD','CANDIDATE_RESTORATION_TEST','CONTINUOUS_REGRESSION','RELEASE_SEQUENCE_COMPLETE'
)
class RolloutError(RuntimeError): pass

def _json(v): return json.dumps(v,sort_keys=True,separators=(',',':'))
def _sha(v): return hashlib.sha256(_json(v).encode()).hexdigest()

class RolloutController:
    def __init__(self,candidate_head,*,inherited_gates_pass=False):
        if not candidate_head or len(candidate_head)<12: raise RolloutError('exact candidate head required')
        self.candidate_head=candidate_head
        self.inherited_gates_pass=bool(inherited_gates_pass)
        self.state='NOT_ADMITTED'
        self.receipts=[]
        self.production_mutated=False
    def _check(self,evidence,kind):
        if not isinstance(evidence,dict) or evidence.get('candidate_head')!=self.candidate_head: raise RolloutError('stale or mismatched candidate evidence')
        if evidence.get('status')!='PASS': raise RolloutError(f'{kind} evidence must PASS')
        if evidence.get('builder_self_certified') is True: raise RolloutError('builder self-certification forbidden')
    def _record(self,event,evidence):
        body={'schema':'musitu.axiom.rollout-receipt.v1','candidate_head':self.candidate_head,'event':event,'from_state':self.state,'evidence':evidence,'sequence':len(self.receipts)}
        receipt={**body,'receipt_sha256':_sha(body)}
        self.receipts.append(receipt)
        return receipt
    def admit_staging(self,evidence):
        if self.state!='NOT_ADMITTED': raise RolloutError('staging admission already attempted')
        if not self.inherited_gates_pass: raise RolloutError('inherited recovery gates are not earned')
        self._check(evidence,'staging')
        receipt=self._record('staging.admitted',evidence)
        self.state='ISOLATED_STAGING'
        return receipt
    def advance(self,evidence):
        self._check(evidence,self.state)
        mapping={
            'ISOLATED_STAGING':'INTERNAL_SHADOW',
            'INTERNAL_SHADOW':'INDEPENDENT_VERIFICATION',
            'INDEPENDENT_VERIFICATION':'CANARY_COHORT',
            'CANARY_COHORT':'ROLLBACK_REHEARSAL',
            'ROLLBACK_REHEARSAL':'AWAITING_HUMAN_PRODUCTION_APPROVAL',
            'GRADUAL_PRODUCTION_CUTOVER':'MONITORING_HOLD',
            'MONITORING_HOLD':'CANDIDATE_RESTORATION_TEST',
            'CANDIDATE_RESTORATION_TEST':'CONTINUOUS_REGRESSION',
            'CONTINUOUS_REGRESSION':'RELEASE_SEQUENCE_COMPLETE'
        }
        if self.state=='AWAITING_HUMAN_PRODUCTION_APPROVAL':
            raise RolloutError('explicit human production approval required')
        nxt=mapping.get(self.state)
        if not nxt: raise RolloutError('state cannot advance through generic evidence')
        if self.state=='CANARY_COHORT' and evidence.get('rollback_ready') is not True:
            raise RolloutError('canary exit requires rollback readiness')
        if self.state=='ROLLBACK_REHEARSAL' and evidence.get('rollback_rehearsed') is not True:
            raise RolloutError('rollback rehearsal proof required')
        if self.state=='CANDIDATE_RESTORATION_TEST' and evidence.get('restoration_verified') is not True:
            raise RolloutError('restoration proof required')
        receipt=self._record(f'{self.state.lower()}.pass',evidence)
        self.state=nxt
        return receipt
    def approve_production(self,approval):
        if self.state!='AWAITING_HUMAN_PRODUCTION_APPROVAL':
            raise RolloutError('production approval is out of sequence')
        if not isinstance(approval,dict) or approval.get('candidate_head')!=self.candidate_head:
            raise RolloutError('approval candidate mismatch')
        if approval.get('human') is not True or approval.get('role')!='RELEASE_AUTHORITY' or not approval.get('actor_id'):
            raise RolloutError('human release authority required')
        if approval.get('actor_id','').startswith(('agent:','builder:','axiom:')):
            raise RolloutError('system/builder may not self-approve production')
        body={'status':'PASS','candidate_head':self.candidate_head,'human_actor_id':approval['actor_id'],'role':'RELEASE_AUTHORITY'}
        receipt=self._record('production.human_approved',body)
        self.state='GRADUAL_PRODUCTION_CUTOVER'
        return receipt
    def status(self):
        return {'schema':'musitu.axiom.rollout-state.v1','candidate_head':self.candidate_head,'state':self.state,'receipt_count':len(self.receipts),'production_mutated':self.production_mutated,'controller_execution_mode':'SIMULATION_AND_POLICY_ONLY'}

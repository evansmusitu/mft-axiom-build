"""Independent B20 causal tool/event regression against the native SDK seam."""
import copy
import unittest
from causality import verify_linkage, CausalDenied


def action(worker, index, tool):
    return dict(worker=worker, ordinal=2*index, event=dict(
        kind='ActionEvent',id=f'{worker}-action-{index}',tool_call_id=f'call-{worker}-{index}',tool_name=tool,action_id=None))

def obs(worker,index,tool):
    return dict(worker=worker,ordinal=2*index+1,event=dict(
        kind='ObservationEvent',id=f'{worker}-observation-{index}',tool_call_id=f'call-{worker}-{index}',tool_name=tool,action_id=f'{worker}-action-{index}'))


def valid():
    return [e for i in range(3) for who in ['agent-a','agent-b'] for e in [action(who,i,'finish' if i==2 else 'file_editor'),obs(who,i,'finish' if i==2 else 'file_editor')]]


class NativeSDKCausalChecks(unittest.TestCase):
    def test_actual_pattern_two_workers_linked(self):
        proof=verify_linkage(valid())
        self.assertEqual(proof['total_pairs'],6)
        self.assertEqual(proof['finish_count'],2)
        self.assertEqual(proof['workers']['agent-a']['matched_pairs'],3)
    def deny(self,altered):
        with self.assertRaises(CausalDenied):verify_linkage(altered)
    def test_missing_action_id_rejected(self):
        x=valid();x[1]['event']['action_id']=None;self.deny(x)
    def test_observation_before_action_rejected(self):
        x=valid();x[0],x[1]=x[1],x[0];self.deny(x)
    def test_duplicated_tool_call_id_rejected(self):
        x=valid();x[4]['event']['tool_call_id']=x[0]['event']['tool_call_id'];self.deny(x)
    def test_cross_worker_action_id_rejected(self):
        x=valid();x[3]['event']['action_id']=x[0]['event']['id'];self.deny(x)
    def test_tool_name_swap_rejected(self):
        x=valid();x[1]['event']['tool_name']='finish';self.deny(x)
    def test_missing_observation_rejected(self):
        x=valid();x.pop(1);self.deny(x)
    def test_finish_without_observation_rejected(self):
        x=valid();x.pop();self.deny(x)
    def test_extra_after_finish_rejected(self):
        x=valid();x+= [action('agent-a',3,'file_editor'),obs('agent-a',3,'file_editor')];self.deny(x)
    def test_finish_first_rejected(self):
        x=valid();x[0]['event']['tool_name']='finish';x[1]['event']['tool_name']='finish';self.deny(x)
    def test_duplicate_native_event_id_rejected(self):
        x=valid();x[3]['event']['id']=x[1]['event']['id'];self.deny(x)
    def test_ordinal_gap_rejected(self):
        x=valid();x[8]['ordinal']=88;self.deny(x)
    def test_reordered_multiworker_interleave_allowed(self):
        a=[x for x in valid() if x['worker']=='agent-a']
        b=[x for x in valid() if x['worker']=='agent-b']
        p=verify_linkage(a+b)
        self.assertEqual(p['total_pairs'],6)
    def test_unknown_tool_rejected(self):
        x=valid();x[0]['event']['tool_name']='exec_shell';self.deny(x)

if __name__=='__main__':unittest.main()

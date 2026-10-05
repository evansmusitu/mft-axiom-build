from __future__ import annotations

import unittest

from frontier_v5.runtime.observability import ERROR_TAXONOMY, ObservabilityError, ObservabilityLedger

T0='2026-09-12T21:20:00+00:00'
T1='2026-09-12T21:20:01+00:00'
T2='2026-09-12T21:20:02+00:00'


def ledger():
    o=ObservabilityLedger()
    o.start_run(trace_id='trace-1',actor_id='user-1',user_intent_id='intent-1',project_id='project-1',run_id='run-1',started_at=T0,production=True)
    return o


class ObservabilityContractTests(unittest.TestCase):
    def test_production_run_binds_trace_actor_and_full_operational_linkage(self):
        o=ledger()
        event=o.record_event('run-1',kind='tool.called',at=T1,actor_id='agent-actor',linkage={
            'agent_id':'agent-1','model_execution_id':'model-1','tool_call_id':'tool-1','policy_decision_id':'policy-1',
            'source_id':'source-1','artifact_id':'artifact-1','verification_id':'verify-1','deployment_id':'deploy-1',
        },operational={'latency_ms':125,'tool_duration_ms':90,'retries':1,'cost_usd':0.01,'compute_units':2,
                       'cache_hit':False,'approval_state':'approved','policy_intervention':True,
                       'evidence_coverage':0.9,'confidence_before':0.6,'confidence_after':0.8,'model_route':'route-a'})
        self.assertEqual(event['linkage']['user_intent_id'],'intent-1')
        self.assertEqual(event['linkage']['deployment_id'],'deploy-1')
        o.finish_run('run-1',status='COMPLETED',ended_at=T2,actor_id='user-1',operational={'latency_ms':250})
        self.assertEqual(o.verify_integrity('run-1')['status'],'PASS')
        replay=o.replay('run-1')
        self.assertEqual(replay['scope'],'OPERATIONAL_METADATA_ONLY_NO_SECRETS_NO_HIDDEN_REASONING')
        self.assertEqual(replay['run']['trace_id'],'trace-1')
        self.assertEqual(replay['run']['actor_id'],'user-1')

    def test_secrets_prompts_and_hidden_reasoning_are_rejected(self):
        o=ledger()
        for key in ['api_key','password','prompt','chain_of_thought','private_reasoning','authorization_token']:
            with self.subTest(key=key):
                with self.assertRaises(ObservabilityError):
                    o.record_event('run-1',kind='run.progress',at=T1,actor_id='user-1',operational={key:'must-not-enter-ledger'})
        self.assertEqual(len(o.events['run-1']),1)

    def test_unapproved_free_text_and_invalid_error_taxonomy_fail_closed(self):
        o=ledger()
        with self.assertRaises(ObservabilityError):
            o.record_event('run-1',kind='error.recorded',at=T1,actor_id='user-1',operational={'message':'free text'})
        with self.assertRaises(ObservabilityError):
            o.finish_run('run-1',status='FAILED',ended_at=T2,actor_id='user-1',error_category='MADE_UP')
        self.assertEqual(len(o.events['run-1']),1)

    def test_event_tampering_is_detected(self):
        o=ledger()
        o.record_event('run-1',kind='policy.decided',at=T1,actor_id='user-1',operational={'policy_intervention':True,'status':'allowed'})
        self.assertEqual(o.verify_integrity()['status'],'PASS')
        o.events['run-1'][1]['operational']['status']='tampered'
        result=o.verify_integrity('run-1')
        self.assertEqual(result['status'],'FAIL')
        self.assertIn('event_hash:run-1:1',result['errors'])

    def test_root_linkage_mismatch_cannot_enter_trace(self):
        o=ledger()
        with self.assertRaises(ObservabilityError):
            o.record_event('run-1',kind='tool.called',at=T1,actor_id='user-1',linkage={'project_id':'other-project'})
        self.assertEqual(len(o.events['run-1']),1)

    def test_operator_health_aggregates_only_operational_metrics(self):
        o=ledger()
        o.record_event('run-1',kind='model.executed',at=T1,actor_id='agent-1',operational={'latency_ms':100,'retries':2,'model_route':'model-a'})
        o.finish_run('run-1',status='FAILED',ended_at=T2,actor_id='user-1',error_category='MODEL',operational={'latency_ms':300,'failure_code':'MODEL_TIMEOUT'})
        health=o.operator_health()
        self.assertEqual(health['run_count'],1)
        self.assertEqual(health['failed_count'],1)
        self.assertEqual(health['failure_rate'],1.0)
        self.assertEqual(health['median_latency_ms'],200.0)
        self.assertEqual(health['retry_count'],2)
        self.assertEqual(set(health['error_taxonomy']),set(ERROR_TAXONOMY))


if __name__=='__main__':
    unittest.main(verbosity=2,exit=False)
    print('MUSITU_AXIOM_INTERFACE_PHASE6_OBSERVABILITY_RUNTIME_PASS')

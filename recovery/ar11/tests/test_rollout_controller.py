import unittest
from recovery.ar11.rollout_controller import RolloutController,RolloutError

H='a'*40
def ev(**extra): return {'candidate_head':H,'status':'PASS','builder_self_certified':False,**extra}

class RolloutControllerTests(unittest.TestCase):
    def test_inherited_gate_and_human_approval_fail_closed(self):
        controller=RolloutController(H,inherited_gates_pass=False)
        with self.assertRaises(RolloutError):
            controller.admit_staging(ev())

        controller=RolloutController(H,inherited_gates_pass=True)
        controller.admit_staging(ev())
        controller.advance(ev())
        controller.advance(ev())
        controller.advance(ev())
        controller.advance(ev(rollback_ready=True))
        controller.advance(ev(rollback_rehearsed=True))
        self.assertEqual(controller.state,'AWAITING_HUMAN_PRODUCTION_APPROVAL')
        with self.assertRaises(RolloutError):
            controller.advance(ev())
        with self.assertRaises(RolloutError):
            controller.approve_production({'candidate_head':H,'human':True,'role':'RELEASE_AUTHORITY','actor_id':'axiom:self'})
        controller.approve_production({'candidate_head':H,'human':True,'role':'RELEASE_AUTHORITY','actor_id':'user:owner'})
        self.assertEqual(controller.state,'GRADUAL_PRODUCTION_CUTOVER')
        self.assertFalse(controller.production_mutated)

    def test_full_order_requires_restoration_and_exact_head(self):
        controller=RolloutController(H,inherited_gates_pass=True)
        controller.admit_staging(ev())
        controller.advance(ev())
        controller.advance(ev())
        controller.advance(ev())
        controller.advance(ev(rollback_ready=True))
        controller.advance(ev(rollback_rehearsed=True))
        controller.approve_production({'candidate_head':H,'human':True,'role':'RELEASE_AUTHORITY','actor_id':'human:release'})
        controller.advance(ev())
        controller.advance(ev())
        with self.assertRaises(RolloutError):
            controller.advance(ev())
        controller.advance(ev(restoration_verified=True))
        controller.advance(ev())
        self.assertEqual(controller.state,'RELEASE_SEQUENCE_COMPLETE')
        self.assertFalse(controller.status()['production_mutated'])
        with self.assertRaises(RolloutError):
            RolloutController(H,inherited_gates_pass=True).admit_staging({'candidate_head':'b'*40,'status':'PASS'})

if __name__=='__main__':
    unittest.main()

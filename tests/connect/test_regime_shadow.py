"""Causal, research-only regime policy is never used to pass the mine gate."""
import unittest
from datetime import datetime, timedelta, timezone

from benchmarks.mining_adapter.methane_prediction import PredictionExample
from benchmarks.mining_adapter.regime_shadow import regime_calibrated_shadow

EPOCH = datetime(2014, 4, 2, tzinfo=timezone.utc)


def sample(second, methane, positive=False, *, label_end=None):
    return PredictionExample(
        feature_time=EPOCH + timedelta(seconds=second),
        label_window_end=EPOCH + timedelta(seconds=second + 360 if label_end is None else label_end),
        features={"target_current_max": methane},
        label=positive,
    )


class RegimeShadowTests(unittest.TestCase):
    def setUp(self):
        # Both independent calibration regimes have sufficient resolved support.
        self.cal = [
            sample(0, .2, True), sample(30, .2, True),
            sample(60, .2, False), sample(90, .2, False),
            sample(120, .7, True), sample(150, .7, True),
            sample(180, .7, False), sample(210, .7, False),
        ]
        self.cal_scores = [.8, .7, .1, .2, .8, .75, .1, .2]
        self.test = [sample(900, .2), sample(930, .7), sample(960, 1.2)]

    def evaluate(self, **kwargs):
        params = dict(
            calibration_examples=self.cal, calibration_scores=self.cal_scores,
            test_examples=self.test, test_scores=[.81, .76, .05],
            global_thresholds=[.99]*3, warning_threshold=1.0,
            regime_boundary=0.5, minimum_recall=.9,
            update_every_examples=1, window_examples=50,
            minimum_regime_positives=2,
        )
        params.update(kwargs)
        return regime_calibrated_shadow(**params)

    def test_causal_regime_calibration_preserves_immediate_hard_warning(self):
        result=self.evaluate()
        self.assertEqual(result['evaluation_role'], 'RESEARCH_ONLY_REGIME_CALIBRATION')
        self.assertFalse(result['qualified_for_admission'])
        self.assertEqual(result['predictions'], [True, True, True])
        self.assertEqual(result['regimes'], ['low', 'elevated', 'elevated'])
        self.assertEqual(result['fallback_predictions'], 0)
        self.assertEqual(result['hard_warnings'], 1)
        self.assertTrue(result['leakage_safe'])
        self.assertGreater(result['threshold_updates'], 0)

    def test_insufficient_regime_support_falls_back_to_existing_threshold(self):
        cal=[sample(0, .2, True), sample(30, .2, False),
             sample(60, .7, True), sample(90, .7, False)]
        result=self.evaluate(calibration_examples=cal,
                             calibration_scores=[.8, .1, .8, .1])
        self.assertEqual(result['fallback_predictions'], len(self.test))
        self.assertEqual(result['predictions'], [False, False, True])

    def test_test_labels_not_visible_until_complete_horizon_has_resolved(self):
        # A later label can change, but that cannot change the earlier warning.
        later=[sample(900+i*30, .2, i in (0,1)) for i in range(18)]
        a=self.evaluate(test_examples=later, test_scores=[.81]*18,
                        global_thresholds=[.99]*18)
        changed=[sample(900+i*30,.2, i in (0,1,2,3)) for i in range(18)]
        b=self.evaluate(test_examples=changed, test_scores=[.81]*18,
                        global_thresholds=[.99]*18)
        self.assertEqual(a['predictions'][:13], b['predictions'][:13])
        self.assertTrue(a['leakage_safe'] and b['leakage_safe'])
        self.assertTrue(all(
            entry['latest_label_window_end_used'] < entry['prediction_time']
            for entry in a['update_audit'] if entry['latest_label_window_end_used']
        ))

    def test_rejects_unresolved_calibration_even_when_feature_time_before_test(self):
        cal=[sample(0,.2,True),sample(30,.2,True),
             sample(600,.7,True,label_end=910)]
        with self.assertRaisesRegex(ValueError, 'calibration_label_not_resolved'):
            self.evaluate(calibration_examples=cal,calibration_scores=[.8,.75,.8])

    def test_rejects_disordered_test_and_malformed_scores(self):
        with self.assertRaisesRegex(ValueError, 'test_order_invalid'):
            self.evaluate(test_examples=list(reversed(self.test)))
        with self.assertRaisesRegex(ValueError, 'value_not_finite'):
            self.evaluate(test_scores=[float('nan'),.8,.1])
        with self.assertRaisesRegex(ValueError, 'length_invalid'):
            self.evaluate(global_thresholds=[.8])


if __name__ == '__main__':
    unittest.main()

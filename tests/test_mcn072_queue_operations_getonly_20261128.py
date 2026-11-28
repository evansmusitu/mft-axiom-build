import unittest
from qualification.mcn072_queue_operations_getonly_20261128 import response_summary, sanitized_response

class QueueMetricSanitizerTests(unittest.TestCase):
    def test_valid_group_aggregation_does_not_treat_count_as_ack_receipt(self):
        doc={"data":{"viewer":{"accounts":[{"queueMessageOperationsAdaptiveGroups":[
            {"count":7,"dimensions":{"actionType":"WriteMessage","outcome":None,"datetimeHour":"2026-11-28T12:00:00Z"}},
            {"count":4,"dimensions":{"actionType":"ReadMessage","outcome":None,"datetimeHour":"2026-11-28T12:00:00Z"}},
            {"count":3,"dimensions":{"actionType":"DeleteMessage","outcome":"success","datetimeHour":"2026-11-28T12:00:00Z"}},
            {"count":1,"dimensions":{"actionType":"DeleteMessage","outcome":"fail","datetimeHour":"2026-11-28T12:00:00Z"}}]
        }]}}}
        r=response_summary(doc)
        self.assertTrue(r["query_valid"])
        self.assertEqual(r["counts_by_action"]["DeleteMessage"],4)
        self.assertEqual(r["counts_by_delete_outcome"]["success"],3)
        self.assertTrue(r["not_per_message"])
        self.assertTrue(r["not_ack_receipts"])

    def test_empty_dataset_never_claims_message_level_evidence(self):
        x=response_summary({"data":{"viewer":{"accounts":[{"queueMessageOperationsAdaptiveGroups":[]}]}}})
        self.assertTrue(x["query_valid"])
        self.assertEqual(x["aggregated_rows"],0)
        self.assertTrue(x["not_ack_receipts"])

    def test_multiple_account_rows_fail_closed(self):
        x=response_summary({"data":{"viewer":{"accounts":[{"queueMessageOperationsAdaptiveGroups":[]},{"queueMessageOperationsAdaptiveGroups":[]}]}}})
        self.assertFalse(x["query_valid"])

    def test_negative_count_fails_closed(self):
        x=response_summary({"data":{"viewer":{"accounts":[{"queueMessageOperationsAdaptiveGroups":[
            {"count":-1,"dimensions":{"actionType":"DeleteMessage"}}]}]}}})
        self.assertFalse(x["query_valid"])

    def test_unknown_action_fails_closed(self):
        x=response_summary({"data":{"viewer":{"accounts":[{"queueMessageOperationsAdaptiveGroups":[
            {"count":3,"dimensions":{"actionType":"UnknownAction"}}]}]}}})
        self.assertFalse(x["query_valid"])

    def test_graphql_error_not_promoted(self):
        self.assertFalse(response_summary({"errors":[{"message":"permission denied"}]})["query_valid"])

    def test_url_allowlist_enforced_before_any_network(self):
        sanitized_response.queue_id="0"*32
        with self.assertRaises(ValueError):
            sanitized_response("https://example.net/pull","dummy_token_with_no_access",{"query":"query"})

if __name__ == "__main__":
    unittest.main()

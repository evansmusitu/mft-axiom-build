"""Adversarial contract tests for the bounded Cloudflare Worker consumer identity diagnostic."""
import hashlib
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlparse

from qualification import mcn072_consumer_shape_probe as subject

ACC = "93f395f5121954671f92fffa453d6b61"
QID = "1" * 32
CID = "2" * 32
BASE = f"/client/v4/accounts/{ACC}/queues"


def response(result, **kwargs):
    return {"success": True, "result": result, **kwargs}


def sample(*, script="consumer-worker", exact_script=None, queue_id=QID):
    def worker():
        return {"consumer_id": CID, "type": "worker", "queue_name": "sample-queue"}
    q = worker()
    l = worker()
    e = worker()
    if script is not None:
        q["script_name"] = script
        l["script_name"] = script
    if exact_script is not None:
        e["script_name"] = exact_script
    elif script is not None:
        e["script_name"] = script
    return {
        f"{BASE}?page=1&per_page=100": response([{"queue_id": queue_id}], result_info={"page":1,"total_pages":1,"total_count":1}),
        f"{BASE}/{queue_id}": response({"queue_id": queue_id,"consumers_total_count":1,"consumers":[q]}),
        f"{BASE}/{queue_id}/consumers": response([l]),
        f"{BASE}/{queue_id}/consumers/{CID}": response(e),
    }


class ProbeTests(unittest.TestCase):
    def call(self, fixtures):
        def fetch(path, token, opener):
            self.assertEqual(token, "a-private-token-value")
            self.assertIn(path, fixtures)
            return fixtures[path], hashlib.sha256(json.dumps(fixtures[path], sort_keys=True).encode()).hexdigest()
        with patch.object(subject, "fetch", fetch):
            return subject.inspect("a-private-token-value", object())

    def test_resolves_verified_worker_name_only_from_agreeing_provider_records(self):
        obj = self.call(sample())
        self.assertEqual(obj["identity_status"], "CONSUMER_SCRIPT_IDENTIFIED")
        self.assertEqual(obj["consumer_script_sha256"], hashlib.sha256(b"consumer-worker").hexdigest())
        self.assertFalse(obj["tenant_fairness_qualified"])
        self.assertFalse(obj["postgres_scheduler_correlated"])
        self.assertNotIn("consumer-worker", json.dumps(obj))

    def test_absent_script_in_all_three_gets_is_not_promoted(self):
        obj = self.call(sample(script=None))
        self.assertEqual(obj["identity_status"], "BLOCKED")
        self.assertEqual(obj["reason_code"], "CONSUMER_SCRIPT_ABSENT_FROM_PROVIDER")
        self.assertEqual(obj["script_field_present"], {"queue":False,"list":False,"exact":False})

    def test_exact_source_script_can_identify_without_guessing(self):
        obj = self.call(sample(script=None,exact_script="exact-worker"))
        self.assertEqual(obj["identity_status"], "CONSUMER_SCRIPT_IDENTIFIED")
        self.assertEqual(obj["script_field_present"], {"queue":False,"list":False,"exact":True})

    def test_conflicting_worker_names_fail_closed(self):
        obj = self.call(sample(script="first-worker",exact_script="second-worker"))
        self.assertEqual(obj["identity_status"], "BLOCKED")
        self.assertEqual(obj["reason_code"], "CONSUMER_SCRIPT_CONFLICT")

    def test_conflicting_consumer_id_fails_closed(self):
        fixtures=sample()
        fixtures[f"{BASE}/{QID}/consumers/{CID}"]["result"]["consumer_id"]="3"*32
        obj=self.call(fixtures)
        self.assertEqual(obj["reason_code"], "CONSUMER_IDENTITY_CONFLICT")

    def test_malformed_or_incomplete_queue_inventory_fails_closed(self):
        fixtures=sample()
        fixtures[f"{BASE}?page=1&per_page=100"]["result_info"]["total_pages"]=2
        obj=self.call(fixtures)
        self.assertEqual(obj["reason_code"], "QUEUE_INVENTORY_INCOMPLETE")

    def test_http_pull_not_incorrectly_classified_as_worker(self):
        fixtures=sample()
        for k in [f"{BASE}/{QID}",f"{BASE}/{QID}/consumers",f"{BASE}/{QID}/consumers/{CID}"]:
            o=fixtures[k]["result"]
            if isinstance(o,dict) and "consumers" in o:o["consumers"][0]["type"]="http_pull"
            elif isinstance(o,list):o[0]["type"]="http_pull"
            else:o["type"]="http_pull"
        obj=self.call(fixtures)
        self.assertEqual(obj["reason_code"], "NO_VERIFIABLE_WORKER_CONSUMER")

    def test_credential_is_not_reflected_and_empty_token_fails(self):
        with patch.object(subject, "fetch") as mock:
            obj=subject.inspect("",object())
            self.assertEqual(obj["identity_status"], "BLOCKED")
            self.assertEqual(obj["reason_code"], "AUTH_UNAVAILABLE")
            mock.assert_not_called()

if __name__ == "__main__": unittest.main()

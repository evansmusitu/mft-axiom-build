"""Offline negative tests: mock all Cloudflare reads/writes, no real credentials."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("bootstrap", HERE / "d1_bootstrap.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
TARGET = mod.NAME
ACCOUNT = mod.ACCOUNT
ID = "11111111-2222-4333-8444-555555555555"
OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


class Reply:
    status = 200

    def __init__(self, body):
        self.body = json.dumps({"success": True, **body}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.body


class FakeCloudflare:
    def __init__(self, *, existing=False, databases=1, zone_valid=True, fail_at=None):
        self.rows = [{"name": "legacy-data", "uuid": OTHER}]
        for i in range(1, databases):
            self.rows.append({"name": f"unrelated-{i}", "uuid": f"{i:08x}-1111-4111-8111-999999999999"})
        if existing:
            self.rows.append({"name": TARGET, "uuid": ID})
        self.zone_valid = zone_valid
        self.calls = []
        self.fail_at = fail_at

    def __call__(self, request, timeout=22):
        method, url = request.get_method(), request.full_url
        data = json.loads(request.data) if request.data else None
        self.calls.append((method, url, data))
        if self.fail_at == len(self.calls):
            return Reply({"success": False, "result": None})
        if method == "GET" and "/zones?" in url:
            return Reply({"result": [{"name": "mftintelligence.com",
                                     "account": {"id": ACCOUNT if self.zone_valid else "other"},
                                     "status": "active"}]})
        if method == "GET" and "/d1/database?" in url:
            return Reply({"result": self.rows, "result_info": {"total_count": len(self.rows),
                                                              "per_page": 100, "page": 1}})
        if method == "POST" and url.endswith("/d1/database"):
            assert data == {"name": TARGET}, data
            self.rows.append({"name": TARGET, "uuid": ID})
            return Reply({"result": {"name": TARGET, "uuid": ID}})
        if method == "POST" and url.endswith(f"/{ID}/query"):
            assert "CREATE TABLE IF NOT EXISTS workspace_tenants" in data["sql"]
            assert "CREATE TABLE IF NOT EXISTS workspace_memberships" in data["sql"]
            assert "CREATE TABLE IF NOT EXISTS workspace_blobs" in data["sql"]
            assert "CREATE INDEX IF NOT EXISTS workspace_memberships_subject_idx" in data["sql"]
            assert "DELETE FROM" not in data["sql"] and "DROP TABLE" not in data["sql"]
            return Reply({"result": [{"success": True, "meta": {"changes": 0}}]})
        raise AssertionError((method, url))


def writes(fake):
    return [x for x in fake.calls if x[0] == "POST"]


class BootstrapTests(unittest.TestCase):
    def test_free_tier_guarded_create_only_one_db_and_schema(self):
        fake = FakeCloudflare()
        output = mod.bootstrap("mock-token", opener=fake)
        self.assertEqual(output["result"], "CREATED_ISOLATED")
        self.assertEqual(output["database_id"], ID)
        self.assertTrue(output["schema_initialized_this_run"])
        self.assertFalse(output["worker_deployed"])
        self.assertFalse(output["access_policy_modified"])
        self.assertEqual(len(writes(fake)), 2)
        self.assertTrue(all(f"/accounts/{ACCOUNT}/d1/database" in url for _,url,_ in writes(fake)))

    def test_existing_database_never_mutates_or_reinitializes(self):
        fake = FakeCloudflare(existing=True)
        result = mod.bootstrap("mock-token", opener=fake)
        self.assertEqual(result["result"], "EXISTS_UNCHANGED")
        self.assertEqual(writes(fake), [])

    def test_more_than_free_allowance_blocks_before_write(self):
        for n in (10, 15):
            fake = FakeCloudflare(databases=n)
            with self.assertRaisesRegex(mod.BootstrapBlocked, "NO_FREE_TIER"):
                mod.bootstrap("mock-token", opener=fake)
            self.assertEqual(writes(fake), [])

    def test_wrong_canonical_account_or_zone_blocks_before_write(self):
        fake = FakeCloudflare(zone_valid=False)
        with self.assertRaisesRegex(mod.BootstrapBlocked, "CANONICAL_ZONE"):
            mod.bootstrap("mock-token", opener=fake)
        self.assertEqual(writes(fake), [])

    def test_a_read_error_never_attempts_to_create(self):
        fake = FakeCloudflare(fail_at=2)
        with self.assertRaisesRegex(mod.BootstrapBlocked, "API_NOT_SUCCESSFUL"):
            mod.bootstrap("mock-token", opener=fake)
        self.assertEqual(writes(fake), [])

    def test_preexisting_name_collision_blocks_without_write(self):
        fake = FakeCloudflare(existing=True)
        fake.rows.append({"name": TARGET, "uuid": OTHER})
        with self.assertRaisesRegex(mod.BootstrapBlocked, "DATABASE_NAME_COLLISION"):
            mod.bootstrap("mock-token", opener=fake)
        self.assertEqual(writes(fake), [])

    def test_injected_sql_is_rejected_before_any_creates(self):
        with tempfile.TemporaryDirectory() as tmp:
            filepath = Path(tmp) / "schema.sql"
            filepath.write_text("DROP TABLE customer_accounts;")
            fake = FakeCloudflare()
            with patch.object(mod, "SCHEMA", filepath):
                with self.assertRaisesRegex(mod.BootstrapBlocked, "SCHEMA_NOT_APPROVED"):
                    mod.bootstrap("mock-token", opener=fake)
            self.assertEqual(writes(fake), [])

    def test_intent_and_account_guards_reject_without_credentials(self):
        for env in ({}, {"MUSITU_D1_BOOTSTRAP_INTENT": "CREATE_ONLY_ISOLATED_DB"},
                    {"EXPECTED_ACCOUNT_ID": ACCOUNT, "EXPECTED_DOMAIN": mod.DOMAIN}):
            with patch.dict("os.environ", env, clear=True):
                self.assertEqual(mod.main(), 2)

    def test_unexpected_write_path_fails_without_transport(self):
        fake = FakeCloudflare()
        for path in (f"/accounts/{ACCOUNT}/access/apps",
                     f"/accounts/{ACCOUNT}/d1/database/{ID}/delete",
                     f"/accounts/{ACCOUNT}/d1/database/{ID}/query/extra"):
            with self.assertRaises(mod.BootstrapBlocked):
                mod.cf("POST", path, "mock-token", {}, opener=fake)
        self.assertEqual(fake.calls, [])


if __name__ == "__main__":
    unittest.main()

"""Read-only tenant attempt accounting on a disposable synthetic SQLite file."""
import importlib
import json
import sqlite3
import sys
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

SCHEMA = Path(__file__).resolve().parents[2] / 'infra' / 'connect_customer_registry.sql'
STAMP = '2026-10-22T12:00:00.000Z'
TENANTS = ('tenant_alpha','tenant_beta')


class CustomerAccountingAuditTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root=Path(tmp.name)
        self.db=self.root/'synthetic_only.sqlite'
        with sqlite3.connect(self.db) as con:
            con.execute('PRAGMA foreign_keys=ON')
            con.executescript(SCHEMA.read_text(encoding='utf-8'))
            for tenant in TENANTS:
                con.execute('INSERT INTO connect_customer_tenants(tenant_id,status,daily_limit,minute_limit) VALUES(?,?,?,?)',
                            (tenant,'active',100,30))
                credential='cred_'+tenant
                con.execute('INSERT INTO connect_customer_credentials(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES(?,?,?,?,?,?,?)',
                            (credential,tenant,sha256(credential.encode()).hexdigest(),
                             'active','2030-01-01T00:00:00Z',1,1))
            for i,(tenant,at) in enumerate((
                    ('tenant_alpha',STAMP),
                    ('tenant_alpha','2026-10-22T12:01:00.000Z'),
                    ('tenant_beta',STAMP)),1):
                con.execute('INSERT INTO connect_customer_usage_events(tenant_id,credential_id,request_id,scope,utc_day,observed_at) VALUES(?,?,?,?,?,?)',
                            (tenant,'cred_'+tenant,f'synthetic-request-{i}',
                             'mining.plan','2026-10-22',at))

    def audit(self):
        try:
            module=importlib.import_module('qualification.audit_connect_customer_registry')
        except ModuleNotFoundError as exc:
            raise AssertionError('connect_read_only_accounting_audit_missing') from exc
        return module.audit_customer_registry(self.db)

    def test_two_tenants_have_consistent_daily_and_minute_counters(self):
        before=sha256(self.db.read_bytes()).hexdigest()
        report=self.audit()
        after=sha256(self.db.read_bytes()).hexdigest()
        self.assertEqual(before,after,'read-only audit mutated the database')
        self.assertEqual(report['schema'],'musitu.connect.customer_accounting_audit.v1')
        self.assertEqual(report['status'],'OFFLINE_ACCOUNTING_CONSISTENT_NOT_ADMITTED')
        self.assertEqual(report['tenants_examined'],2)
        self.assertEqual(report['usage_events_examined'],3)
        self.assertEqual(report['daily_counter_rows'],2)
        self.assertEqual(report['minute_counter_rows'],3)
        self.assertEqual(report['daily_counter_mismatches'],0)
        self.assertEqual(report['minute_counter_mismatches'],0)
        self.assertFalse(report['hosted_d1_qualified'])
        self.assertFalse(report['production_admission'])
        self.assertFalse(report['customer_beta_admission'])
        for private in ('tenant_alpha','tenant_beta','cred_tenant','synthetic-request'):
            self.assertNotIn(private,json.dumps(report))

    def test_undercounted_daily_counter_is_detected_without_adjustment(self):
        with sqlite3.connect(self.db) as con:
            con.execute("UPDATE connect_customer_daily_usage SET used=0 WHERE tenant_id='tenant_alpha'")
        original=self.db.read_bytes()
        report=self.audit()
        self.assertEqual(self.db.read_bytes(),original)
        self.assertEqual(report['status'],'OFFLINE_ACCOUNTING_INCONSISTENT_NOT_ADMITTED')
        self.assertGreater(report['daily_counter_mismatches'],0)
        self.assertFalse(report['production_admission'])

    def test_inflated_minute_counter_is_detected(self):
        with sqlite3.connect(self.db) as con:
            con.execute("UPDATE connect_customer_minute_usage SET used=999 WHERE tenant_id='tenant_beta'")
        report=self.audit()
        self.assertEqual(report['status'],'OFFLINE_ACCOUNTING_INCONSISTENT_NOT_ADMITTED')
        self.assertGreater(report['minute_counter_mismatches'],0)

    def test_zero_usage_with_orphan_counter_is_not_accepted(self):
        with sqlite3.connect(self.db) as con:
            con.execute("DELETE FROM connect_customer_usage_events")
        report=self.audit()
        self.assertEqual(report['usage_events_examined'],0)
        self.assertGreater(report['daily_counter_mismatches'],0)
        self.assertGreater(report['minute_counter_mismatches'],0)

    def test_cli_will_not_overwrite_a_concurrent_reconciliation_report(self):
        try:
            module=importlib.import_module('qualification.audit_connect_customer_registry')
        except ModuleNotFoundError as exc:
            raise AssertionError('connect_read_only_accounting_audit_missing') from exc
        dest=self.root/'report.json'
        dest.write_text('previous independently retained evidence')
        args=['audit_connect_customer_registry','--database',str(self.db),
              '--output',str(dest)]
        with patch.object(sys,'argv',args):
            with self.assertRaises(FileExistsError):
                module.main()
        self.assertEqual(dest.read_text(),'previous independently retained evidence')

    def test_reassigned_credential_is_detected_even_if_quota_counts_match(self):
        # Existing usage references a credential that an unsafe operator has
        # since pointed at the wrong tenant. Historical attribution matters.
        with sqlite3.connect(self.db) as con:
            con.execute("UPDATE connect_customer_credentials SET tenant_id='tenant_beta' "
                        "WHERE credential_id='cred_tenant_alpha'")
        report=self.audit()
        self.assertEqual(report['daily_counter_mismatches'],0)
        self.assertEqual(report['minute_counter_mismatches'],0)
        self.assertEqual(report['status'],'OFFLINE_ACCOUNTING_INCONSISTENT_NOT_ADMITTED')
        self.assertGreater(report['credential_tenant_mismatches'],0)

    def test_tampered_event_time_is_detected_even_when_minute_key_is_unchanged(self):
        # The admission trigger runs on INSERT; later direct UPDATEs are an
        # adversarial offline corruption case that cannot be trusted.
        with sqlite3.connect(self.db) as con:
            con.execute("UPDATE connect_customer_usage_events "
                        "SET observed_at='2026-10-22T12:00:00Z' "
                        "WHERE request_id='synthetic-request-1'")
        report=self.audit()
        self.assertEqual(report['daily_counter_mismatches'],0)
        self.assertEqual(report['minute_counter_mismatches'],0)
        self.assertGreater(report['malformed_event_timestamps_or_scopes'],0)
        self.assertEqual(report['status'],'OFFLINE_ACCOUNTING_INCONSISTENT_NOT_ADMITTED')

    def test_cli_success_creates_only_deidentified_summary_then_refuses_overwrite(self):
        module=importlib.import_module('qualification.audit_connect_customer_registry')
        target=self.root/'reconciliation.json'
        argv=['audit_connect_customer_registry','--database',str(self.db),
              '--output',str(target)]
        with patch.object(sys,'argv',argv):
            module.main()
        raw=target.read_text(encoding='utf-8')
        self.assertIn('OFFLINE_ACCOUNTING_CONSISTENT_NOT_ADMITTED',raw)
        self.assertNotIn('tenant_alpha',raw)
        self.assertNotIn('cred_tenant',raw)
        self.assertNotIn('synthetic-request',raw)
        with patch.object(sys,'argv',argv):
            with self.assertRaises(FileExistsError):
                module.main()
        self.assertEqual(target.read_text(encoding='utf-8'),raw)



if __name__=='__main__':
    unittest.main()

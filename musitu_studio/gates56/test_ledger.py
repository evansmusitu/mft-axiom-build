"""Offline Gate 5/6 invariant tests; fake provider proof NEVER qualifies live caps."""
import hashlib
from pathlib import Path
import tempfile
import unittest

from musitu_studio.gates56.ledger import (
    Conflict, GateClosed, StudioG56Ledger, VerifiedProviderCap
)


HASH_A=hashlib.sha256(b"blender scene A").hexdigest()
HASH_B=hashlib.sha256(b"blender scene B").hexdigest()


class Gate56LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now=1795340000
        self.certify=True
        def fake_cap():
            if not self.certify:raise GateClosed("PROVIDER_BUDGET_UNAVAILABLE")
            return VerifiedProviderCap(provider="MODAL",control_id="offline-simulated-only",
                     monthly_cap_cents=1000,remaining_cents=1000,
                     checked_unix=self.now,hard_enforced=True)
        self.ledger=StudioG56Ledger(Path(self.temp.name)/"g56.sqlite",
                  provider_guard=fake_cap,
                  authorization=lambda action: action in ("CONFIGURE_TENANT","ARM_COMPUTE"),
                  quote_verifier=lambda *args: True,  # fake offline only
                  now=lambda: self.now)
        self.ledger.configure_tenant("tenantA",daily_cents=150,monthly_cents=450,
                                      max_active=2,total_credit_units=10)
        self.ledger.configure_tenant("tenantB",daily_cents=150,monthly_cents=450,
                                      max_active=1,total_credit_units=10)

    def admit(self, key="submissionA", **kw):
        return self.ledger.submit(tenant="tenantA",project="projectA",
                 submission_key=key,payload_sha256=kw.pop("payload_sha256",HASH_A),
                 max_cost_cents=kw.pop("max_cost_cents",60),
                 credit_units=kw.pop("credit_units",3),
                 max_attempts=kw.pop("max_attempts",2),**kw)

    def test_missing_independent_all_attempt_quote_blocks_admission(self):
        self.ledger.set_emergency_stop(False)
        self.ledger.quote_verifier=None
        with self.assertRaisesRegex(GateClosed,"WORST_CASE_QUOTE"):
            self.admit()

    def test_emergency_stop_is_visible_to_running_worker(self):
        self.ledger.set_emergency_stop(False)
        self.assertFalse(self.ledger.is_stopped())
        self.ledger.set_emergency_stop(True)
        self.assertTrue(self.ledger.is_stopped())

    def test_kill_switch_defaults_on_and_no_provider_never_opens(self):
        with self.assertRaisesRegex(GateClosed,"KILL_SWITCH"):
            self.admit()
        self.ledger.set_emergency_stop(False)
        self.certify=False
        with self.assertRaisesRegex(GateClosed,"PROVIDER_BUDGET_UNAVAILABLE"):
            self.admit()
        self.certify=True
        self.assertEqual(self.admit()["state"],"QUEUED")
        self.ledger.set_emergency_stop()
        with self.assertRaisesRegex(GateClosed,"KILL_SWITCH"):
            self.admit("next")

    def test_duplicate_same_idempotency_returns_one_reservation(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        b=self.admit()
        self.assertEqual(a["id"],b["id"])
        with self.assertRaisesRegex(Conflict,"IDEMPOTENCY_KEY_PAYLOAD_CONFLICT"):
            self.admit(payload_sha256=HASH_B)
        self.assertEqual(self.admit("second")["state"],"QUEUED")
        with self.assertRaisesRegex(GateClosed,"TENANT_CONCURRENCY_CAP"):
            self.admit("third")

    def test_daily_and_credit_caps_are_transactional(self):
        self.ledger.set_emergency_stop(False)
        self.admit("one",max_cost_cents=100,credit_units=9)
        with self.assertRaisesRegex(GateClosed,"TENANT_COST_CAP"):
            self.admit("two",max_cost_cents=60,credit_units=0)
        with self.assertRaisesRegex(GateClosed,"INSUFFICIENT_VERIFIED_CREDITS"):
            self.admit("three",max_cost_cents=10,credit_units=2)
        self.assertEqual(self.admit("four",max_cost_cents=10,credit_units=1)["state"],"QUEUED")

    def test_fenced_claim_monotonic_progress_and_owner_isolation(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claimed=self.ledger.claim(worker="isolated-worker")
        self.assertEqual(claimed["job"]["id"],a["id"])
        self.assertEqual(claimed["job"]["attempts"],1)
        self.assertIsNone(self.ledger.claim(worker="isolated-worker"))
        with self.assertRaisesRegex(GateClosed,"JOB_NOT_IN_TENANT"):
            self.ledger.get("tenantB",a["id"])
        self.ledger.heartbeat(tenant="tenantA",jid=a["id"],
                              fence=claimed["fence"],percent=40)
        self.assertEqual(self.ledger.get("tenantA",a["id"])["progress"],40)
        with self.assertRaisesRegex(Conflict,"PROGRESS_NOT_MONOTONIC"):
            self.ledger.heartbeat(tenant="tenantA",jid=a["id"],
                                  fence=claimed["fence"],percent=20)
        with self.assertRaisesRegex(Conflict,"STALE_FENCE"):
            self.ledger.heartbeat(tenant="tenantA",jid=a["id"],
                                  fence="bad-fence",percent=50)

    def test_expired_lease_blocks_late_heartbeat_and_provider_call_before_sweep(self):
        """A zombie cannot revive its lease or dispatch after expiry."""
        self.ledger.set_emergency_stop(False)
        job=self.admit("expired-lease")
        ticket=self.ledger.claim(worker="worker1",lease_seconds=10)
        self.now+=11
        with self.assertRaisesRegex(Conflict,"WORKER_LEASE_EXPIRED"):
            self.ledger.heartbeat(tenant="tenantA",jid=job["id"],
                                  fence=ticket["fence"],percent=20)
        with self.assertRaisesRegex(Conflict,"WORKER_LEASE_EXPIRED"):
            self.ledger.attach_provider_call(tenant="tenantA",jid=job["id"],
                                               fence=ticket["fence"],call_id="late-provider-call")
        self.assertEqual(self.ledger.quarantine_stale(),1)
        record=self.ledger.get("tenantA",job["id"])
        self.assertEqual(record["state"],"NEEDS_REVIEW")
        self.assertIsNone(record["provider_call_id"])
        self.assertEqual(record["reserved_cents"],60)
        self.assertEqual(record["credit_hold"],3)
        self.assertIsNone(self.ledger.claim(worker="worker2"))

    def test_worker_loss_never_auto_retries_and_keeps_hold(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claimed=self.ledger.claim(worker="worker1",lease_seconds=10)
        self.now+=11
        self.assertEqual(self.ledger.quarantine_stale(),1)
        state=self.ledger.get("tenantA",a["id"])
        self.assertEqual(state["state"],"NEEDS_REVIEW")
        self.assertIsNone(self.ledger.claim(worker="worker2"))
        with self.assertRaisesRegex(GateClosed,"TERMINATION_PROOF"):
            self.ledger.allow_retry_after_authoritative_stop(
                tenant="tenantA",jid=a["id"],fence=claimed["fence"],
                provider_proof="unverified")
        self.assertEqual(self.ledger.get("tenantA",a["id"])["reserved_cents"],60)

    def test_cancel_queued_releases_hold_and_is_idempotent(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit("one",max_cost_cents=150,credit_units=10)
        self.assertEqual(self.ledger.cancel(tenant="tenantA",jid=a["id"])["state"],"CANCELED")
        self.assertEqual(self.ledger.cancel(tenant="tenantA",jid=a["id"])["state"],"CANCELED")
        self.assertEqual(self.admit("two",max_cost_cents=150,credit_units=10)["state"],"QUEUED")

    def test_running_cancel_is_request_only_without_forged_refund(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claimed=self.ledger.claim(worker="w")
        record=self.ledger.cancel(tenant="tenantA",jid=a["id"])
        self.assertEqual(record["state"],"CANCEL_REQUESTED")
        self.assertTrue(record["provider_cancel_required"])
        self.assertEqual(self.ledger.get("tenantA",a["id"])["credit_charge"],None)
        with self.assertRaisesRegex(GateClosed,"PROVIDER_COST_EVIDENCE_REQUIRED"):
            self.ledger.confirm_terminal(
              tenant="tenantA",jid=a["id"],fence=claimed["fence"],
              result="COMPLETED",actual_cents=0,charged_credit_units=0,
              provider_evidence="verified:offline-fake",verified_artifacts=[])

    def test_stale_or_fabricated_terminal_result_cannot_settle(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claim=self.ledger.claim(worker="w")
        with self.assertRaisesRegex(GateClosed,"PROVIDER_COST_EVIDENCE_REQUIRED"):
            self.ledger.confirm_terminal(tenant="tenantA",jid=a["id"],
                 fence=claim["fence"],result="FAILED",actual_cents=3,
                 charged_credit_units=0,provider_evidence="anything")
        self.ledger.cost_verifier=lambda *args:True
        with self.assertRaisesRegex(Conflict,"STALE_FENCE"):
            self.ledger.confirm_terminal(tenant="tenantA",jid=a["id"],
                 fence="forged",result="FAILED",actual_cents=3,
                 charged_credit_units=0,provider_evidence="verified:offline-fake")

    def test_verified_provider_bill_settles_once_without_double_credits(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claim=self.ledger.claim(worker="w")
        self.ledger.cost_verifier=lambda tenant,jid,fence,state,cents,units,receipt: (
            tenant=="tenantA" and jid==a["id"] and
            fence==claim["fence"] and state=="FAILED" and
            cents==12 and units==1 and receipt=="offline-verifier-receipt"
        )
        result=self.ledger.confirm_terminal(
           tenant="tenantA",jid=a["id"],fence=claim["fence"],
           result="FAILED",actual_cents=12,charged_credit_units=1,
           provider_evidence="offline-verifier-receipt")
        self.assertEqual(result["state"],"FAILED")
        self.assertEqual(result["charged_cents"],12)
        self.assertEqual(result["credit_charge"],1)
        with self.assertRaisesRegex(Conflict,"STALE_FENCE"):
            self.ledger.confirm_terminal(
               tenant="tenantA",jid=a["id"],fence=claim["fence"],
               result="FAILED",actual_cents=12,charged_credit_units=1,
               provider_evidence="offline-verifier-receipt")
        self.assertEqual(self.ledger.get("tenantA",a["id"])["charged_cents"],12)

    def test_retry_requires_trusted_provider_termination_and_cannot_exceed_two(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claim1=self.ledger.claim(worker="w1",lease_seconds=10)
        self.ledger.mark_dispatch_uncertain(
             tenant="tenantA",jid=a["id"],fence=claim1["fence"])
        with self.assertRaisesRegex(GateClosed,"TERMINATION_PROOF"):
            self.ledger.allow_retry_after_authoritative_stop(
             tenant="tenantA",jid=a["id"],fence=claim1["fence"],
             provider_proof="verified-terminated:forged")
        self.ledger.termination_verifier=lambda tenant,jid,fence,proof:(
             tenant=="tenantA" and jid==a["id"] and
             fence==claim1["fence"] and proof=="offline-terminated-call"
        )
        self.ledger.allow_retry_after_authoritative_stop(
             tenant="tenantA",jid=a["id"],fence=claim1["fence"],
             provider_proof="offline-terminated-call")
        claim2=self.ledger.claim(worker="w2")
        self.assertEqual(claim2["job"]["attempts"],2)
        self.ledger.mark_dispatch_uncertain(
             tenant="tenantA",jid=a["id"],fence=claim2["fence"])
        self.ledger.termination_verifier=lambda *args:True
        with self.assertRaisesRegex(GateClosed,"RETRY_CEILING"):
            self.ledger.allow_retry_after_authoritative_stop(
               tenant="tenantA",jid=a["id"],fence=claim2["fence"],
               provider_proof="offline-confirmed")

    def test_verifier_required_even_if_artifact_names_and_hashes_look_valid(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        claim=self.ledger.claim(worker="w")
        self.ledger.cost_verifier=lambda *args:True
        forged=tuple((filename,HASH_A,4096,
                     f"private/tenantA/{a['id']}/{filename}")
            for filename in ("scene.blend","scene.glb","preview.png"))
        with self.assertRaisesRegex(GateClosed,"ARTIFACT_PROOF_REQUIRED"):
            self.ledger.confirm_terminal(
              tenant="tenantA",jid=a["id"],fence=claim["fence"],
              result="COMPLETED",actual_cents=10,charged_credit_units=1,
              provider_evidence="fake-cost",verified_artifacts=forged)

    def test_global_provider_reservations_cannot_oversubscribe_hard_cap(self):
        self.ledger.set_emergency_stop(False)
        def provider_cap():
            return VerifiedProviderCap(provider="MODAL",control_id="offline-global",
                  monthly_cap_cents=100,remaining_cents=100,
                  checked_unix=self.now,hard_enforced=True)
        self.ledger.provider_guard=provider_cap
        a=self.admit("global-a",max_cost_cents=60,credit_units=2)
        self.assertEqual(a["state"],"QUEUED")
        with self.assertRaisesRegex(GateClosed,"PROVIDER_GLOBAL_UNSETTLED_CAP"):
            self.ledger.submit(tenant="tenantB",project="projectB",
                 submission_key="global-b",payload_sha256=HASH_B,
                 max_cost_cents=60,credit_units=2,max_attempts=1)
        b=self.ledger.submit(tenant="tenantB",project="projectB",
                 submission_key="global-b",payload_sha256=HASH_B,
                 max_cost_cents=40,credit_units=2,max_attempts=1)
        self.assertEqual(b["state"],"QUEUED")
        # An administrative hard-cap reduction must stop dispatch as well.
        self.ledger.provider_guard=lambda:VerifiedProviderCap(
             "MODAL","offline-global",70,70,self.now,True)
        with self.assertRaisesRegex(GateClosed,"PROVIDER_GLOBAL_UNSETTLED_CAP"):
            self.ledger.claim(worker="worker-oversubscription")

    def test_budget_evidence_staleness_fails_closed(self):
        self.ledger.set_emergency_stop(False)
        self.now+=61
        # Fake provider time updates with self.now, so deliberately replace it.
        self.ledger.provider_guard=lambda:VerifiedProviderCap(
            "MODAL","stale",1000,1000,self.now-70,True)
        with self.assertRaisesRegex(GateClosed,"STALE"):
            self.admit()

    def test_new_instance_keeps_durable_control_and_reservations(self):
        self.ledger.set_emergency_stop(False)
        a=self.admit()
        same=StudioG56Ledger(Path(self.temp.name)/"g56.sqlite",
                    provider_guard=self.ledger.provider_guard,
                    authorization=self.ledger.authorization,
                    now=lambda:self.now)
        self.assertEqual(same.get("tenantA",a["id"])["state"],"QUEUED")
        self.assertEqual(same.submit(tenant="tenantA",project="projectA",
             submission_key="submissionA",payload_sha256=HASH_A,
             max_cost_cents=60,credit_units=3,max_attempts=2)["id"],a["id"])


if __name__=="__main__":
    unittest.main()

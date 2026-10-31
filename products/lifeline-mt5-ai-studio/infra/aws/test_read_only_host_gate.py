"""Fully offline acceptance with synthetic AWS responses; no AWS credentials."""
import unittest
from datetime import datetime, timedelta, timezone
from read_only_host_gate import qualify, QualificationError


class GateTests(unittest.TestCase):
    def run_gate(self, mutate=None):
        future = (datetime.now(timezone.utc) + timedelta(days=45)).isoformat()
        plan = {"accountPlanType": "FREE", "accountPlanStatus": "ACTIVE",
                "accountPlanRemainingCredits": {"amount": 100.0, "unit": "USD"},
                "accountPlanExpirationDate": future, "accountId": "123456789012"}
        instance = {"InstanceTypes": [{"InstanceType": "t3.small", "FreeTierEligible": True,
                                        "MemoryInfo": {"SizeInMiB": 2048}}],
                    "InstanceTypeOfferings": [{"InstanceType": "t3.small", "LocationType": "region",
                                               "Location": "eu-north-1"}]}
        images = {"Images": [{"Name": "Windows_Server-2022-English-Full-Base-2026.10.27",
                               "Architecture": "x86_64", "State": "available", "Platform": "windows",
                               "FreeTierEligible": True, "ImageId": "ami-valid"}]}
        ec2 = {"Reservations": []}
        if mutate:
            mutate(plan, instance, images, ec2)
        seen = []
        def caller(args):
            seen.append(args)
            if args[:2] == ["sts", "get-caller-identity"]: return {"Account": "123456789012"}
            if args[:2] == ["freetier", "get-account-plan-state"]: return plan
            if args[:2] == ["ec2", "describe-instance-types"]: return instance
            if args[:2] == ["ec2", "describe-instance-type-offerings"]:
                return {"InstanceTypeOfferings": instance["InstanceTypeOfferings"]}
            if args[:2] == ["ec2", "describe-images"]: return images
            if args[:2] == ["ec2", "describe-instances"]: return ec2
            raise AssertionError("Unknown AWS operation")
        report = qualify(caller)
        self.assertEqual(len(seen), 6)
        self.assertTrue(all(x[0:2] in [["sts", "get-caller-identity"], ["freetier", "get-account-plan-state"],
                                         ["ec2", "describe-instance-types"],
                                         ["ec2", "describe-instance-type-offerings"],
                                         ["ec2", "describe-images"],
                                         ["ec2", "describe-instances"]] for x in seen))
        self.assertNotIn("123456789012", str(report))
        self.assertFalse(report["deployment_authorized"])
        self.assertFalse(report["live_host_connected"])
        return report

    def test_positive_read_only_candidate_not_deployment(self):
        r = self.run_gate()
        self.assertTrue(r["candidate_qualifies_for_manual_review"])
        self.assertFalse(r["ssm_access_verified"])
        self.assertFalse(r["firewall_verified"])

    def test_paid_or_expired_plan_denied(self):
        for t, status in (("PAID", "ACTIVE"), ("FREE", "EXPIRED")):
            with self.subTest(t=t, status=status):
                self.assertFalse(self.run_gate(lambda p,*_: p.update(accountPlanType=t,accountPlanStatus=status))["candidate_qualifies_for_manual_review"])

    def test_short_plan_horizon_denied_for_persistent_host_review(self):
        short = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        r = self.run_gate(lambda p,*_: p.update(accountPlanExpirationDate=short))
        self.assertTrue(r["account_not_expired"])
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_naive_expiry_timestamp_denied(self):
        naive = (datetime.now(timezone.utc) + timedelta(days=60)).replace(tzinfo=None).isoformat()
        r = self.run_gate(lambda p,*_: p.update(accountPlanExpirationDate=naive))
        self.assertFalse(r["account_not_expired"])
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_mismatched_free_tier_account_identity_denied(self):
        # A Free Tier plan from account A cannot qualify a host in account B.
        r = self.run_gate(lambda p,*_: p.update(accountId="999999999999"))
        self.assertFalse(r.get("caller_matches_free_plan_account", False))
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_missing_free_tier_account_id_denied(self):
        r = self.run_gate(lambda p,*_: p.pop("accountId"))
        self.assertFalse(r.get("caller_matches_free_plan_account", False))
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_low_credits_denied(self):
        self.assertFalse(self.run_gate(lambda p,*_: p["accountPlanRemainingCredits"].update(amount=4))["candidate_qualifies_for_manual_review"])

    def test_wrong_currency_denied(self):
        self.assertFalse(self.run_gate(lambda p,*_: p["accountPlanRemainingCredits"].update(unit="EUR"))["credit_buffer_present"])

    def test_type_not_free_or_too_small_denied(self):
        self.assertFalse(self.run_gate(lambda p,t,*_: t["InstanceTypes"][0].update(FreeTierEligible=False))["candidate_qualifies_for_manual_review"])
        self.assertFalse(self.run_gate(lambda p,t,*_: t["InstanceTypes"][0]["MemoryInfo"].update(SizeInMiB=1024))["candidate_qualifies_for_manual_review"])

    def test_instance_type_not_offered_in_stockholm_denied(self):
        # Free tier type eligibility alone does not show regional availability.
        r = self.run_gate(lambda p,t,*_: t.update(InstanceTypeOfferings=[]))
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_instance_type_offered_only_in_other_region_denied(self):
        r = self.run_gate(lambda p,t,*_: t.update(InstanceTypeOfferings=[
            {"InstanceType": "t3.small", "LocationType": "region", "Location": "eu-west-1"}]))
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_ami_owner_name_or_freeflag_denied(self):
        self.assertFalse(self.run_gate(lambda p,t,i,e: i["Images"][0].update(Name="Windows_Server-2022-English-Full-Base-evil"))["candidate_qualifies_for_manual_review"])
        self.assertFalse(self.run_gate(lambda p,t,i,e: i["Images"][0].update(FreeTierEligible=False))["candidate_qualifies_for_manual_review"])

    def test_existing_instances_fail_closed(self):
        r=self.run_gate(lambda p,t,i,e: e["Reservations"].append({"Instances": [{"State": {"Name": "running"}}]}))
        self.assertFalse(r["no_existing_ec2_instances"])

    def test_missing_reservations_denied(self):
        self.assertFalse(self.run_gate(lambda p,t,i,e: e.clear())["candidate_qualifies_for_manual_review"])

    def test_paginated_instance_inventory_fails_closed(self):
        # An incomplete first page cannot prove an empty AWS account/region.
        r = self.run_gate(lambda p,t,i,e: e.update(NextToken="another-page"))
        self.assertFalse(r["no_existing_ec2_instances"])
        self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_nonlist_or_malformed_instance_inventory_fails_closed(self):
        for data in (None, {}, [{"Instances": "not-an-array"}],
                     [{"Instances": []}, {"Instances": None}]):
            with self.subTest(data=data):
                r = self.run_gate(lambda p,t,i,e: e.update(Reservations=data))
                self.assertFalse(r["candidate_qualifies_for_manual_review"])

    def test_transport_error_never_succeeds(self):
        def error(_): raise QualificationError("AWS_READ_DENIED_OR_UNAVAILABLE")
        with self.assertRaises(QualificationError): qualify(error)

if __name__ == "__main__":
    unittest.main()

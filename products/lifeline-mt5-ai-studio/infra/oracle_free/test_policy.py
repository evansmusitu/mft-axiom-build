"""Offline-only negative-path checks: no Oracle credentials or billing actions."""
import unittest
from policy import check

def good():
    return dict(shape="VM.Standard.A1.Flex",ocpus=2,memory_gb=12,boot_gb=50,
        other_a1_ocpus=0,other_a1_memory_gb=0,other_boot_block_gb=0,
        image="Ubuntu 24.04 ARM64",image_always_free_eligible=True,
        shape_always_free_eligible=True,region="owner-home-region",
        home_region="owner-home-region",upgrade_to_paid=False,
        public_ingress_enabled=False)

class TestGuard(unittest.TestCase):
    def test_eligible_declaration_is_not_live_proof(self):
        r=check(good())
        self.assertTrue(r["declared_budget_constraints_pass"])
        self.assertFalse(r["host_provisioned"])
        self.assertFalse(r["mt5_verified"])
        self.assertFalse(r["provider_quotas_independently_verified"])
    def test_reject_excess_cpu(self):
        x=good();x["other_a1_ocpus"]=1
        with self.assertRaises(ValueError):check(x)
    def test_reject_excess_memory(self):
        x=good();x["memory_gb"]=13
        with self.assertRaises(ValueError):check(x)
    def test_reject_paid_upgrade(self):
        x=good();x["upgrade_to_paid"]=True
        with self.assertRaises(ValueError):check(x)
    def test_reject_public_ingress(self):
        x=good();x["public_ingress_enabled"]=True
        with self.assertRaises(ValueError):check(x)
    def test_reject_not_free_image(self):
        x=good();x["image_always_free_eligible"]=False
        with self.assertRaises(ValueError):check(x)
    def test_reject_windows_image(self):
        x=good();x["image"]="Windows Server 2022"
        with self.assertRaises(ValueError):check(x)
    def test_reject_wrong_region(self):
        x=good();x["home_region"]="other"
        with self.assertRaises(ValueError):check(x)
    def test_reject_storage_overallocation(self):
        x=good();x["other_boot_block_gb"]=151
        with self.assertRaises(ValueError):check(x)
    def test_reject_extra_fields_and_missing_evidence(self):
        x=good();x["billing_secret"]="not allowed"
        with self.assertRaises(ValueError):check(x)
        x=good();del x["shape_always_free_eligible"]
        with self.assertRaises(ValueError):check(x)
    def test_reject_numeric_bool(self):
        x=good();x["ocpus"]=True
        with self.assertRaises(ValueError):check(x)

if __name__=="__main__":
    unittest.main()

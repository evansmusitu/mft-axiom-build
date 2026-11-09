"""LIFELINE Oracle Always Free ARM PILOT — static-only resource guard.

Local JSON validation. No OCI API, credentials, billing, provisioning, scripts,
downloads, emulators, Windows licensing, trading, or network requests.
Caller-supplied evidence is NOT a provider-certified free-tier quotation.
"""
import json
import sys

EXPECTED = frozenset({
    "shape", "ocpus", "memory_gb", "boot_gb", "other_a1_ocpus",
    "other_a1_memory_gb", "other_boot_block_gb", "image",
    "image_always_free_eligible", "shape_always_free_eligible",
    "region", "home_region", "upgrade_to_paid", "public_ingress_enabled"
})

def check(spec):
    if type(spec) is not dict or set(spec) != EXPECTED:
        raise ValueError("resource inventory is incomplete or contains unexpected fields")
    for name in ("ocpus","memory_gb","boot_gb","other_a1_ocpus",
                 "other_a1_memory_gb","other_boot_block_gb"):
        if type(spec[name]) is not int or spec[name] < 0:
            raise ValueError("invalid whole-number resource quantity")
    for name in ("image_always_free_eligible","shape_always_free_eligible",
                 "upgrade_to_paid","public_ingress_enabled"):
        if type(spec[name]) is not bool:
            raise ValueError("boolean approval required")
    if (spec["shape"] != "VM.Standard.A1.Flex" or
        spec["image"] != "Ubuntu 24.04 ARM64" or
        not spec["image_always_free_eligible"] or
        not spec["shape_always_free_eligible"]):
        raise ValueError("host is not an explicitly eligible ARM64/Linux instance")
    if (not isinstance(spec["region"],str) or not spec["region"] or
        spec["region"] != spec["home_region"]):
        raise ValueError("instance must be in exact OCI Always Free home region")
    if spec["upgrade_to_paid"] or spec["public_ingress_enabled"]:
        raise ValueError("paid upgrade or public inbound network prohibited")
    if not 1 <= spec["ocpus"] <= 2 or not 6 <= spec["memory_gb"] <= 12:
        raise ValueError("selected pilot needs 1–2 A1 OCPUs and at least 6 GB RAM")
    if not 47 <= spec["boot_gb"] <= 200:
        raise ValueError("boot disk outside supported free-tier pilot range")
    if (spec["ocpus"]+spec["other_a1_ocpus"]>2 or
        spec["memory_gb"]+spec["other_a1_memory_gb"]>12 or
        spec["boot_gb"]+spec["other_boot_block_gb"]>200):
        raise ValueError("Always Free compute or storage allowance exceeded")
    return {"schema":"lifeline.oracle_arm_free_preflight.v1",
            "declared_budget_constraints_pass":True,
            "provider_quotas_independently_verified":False,
            "host_provisioned":False,"hangover_verified":False,
            "mt5_verified":False,"metaeditor_verified":False,
            "windows_native_host":False,
            "native_mcp_verified":False,"cloudflare_modal_connected":False,
            "trading_enabled":False,"paid_upgrade_allowed":False}

def main():
    if len(sys.argv)!=2:raise SystemExit("usage: policy.py local_resource_inventory.json")
    with open(sys.argv[1],encoding="utf-8") as f:spec=json.load(f)
    result=check(spec)
    print(json.dumps(result,sort_keys=True))

if __name__=="__main__":
    main()

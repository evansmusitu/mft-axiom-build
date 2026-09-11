#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("direct_paynow_fallback_transform", HERE / "direct_paynow_fallback_transform.py")
MOD = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MOD)


def fixture():
    return (
        "// MUSITU Chemistry Commerce\n"
        "function renderCheckout({planId,planLabel,price,scope,deviceId='',isSchool=false}={}){\n"
        "  const schoolNote='';\n"
        "  const body=`<main><form class=\"checkout-form\"><button>Continue securely to Paynow</button></form><p class=\"microcopy\">You will leave MUSITU for the payment-provider step. Payment credentials are entered with the provider, not into MUSITU or this storefront.</p></section></div>`;\n"
        "  return body;\n"
        "}\n"
    )


class DirectPaynowFallbackTransformTests(unittest.TestCase):
    def test_adds_direct_route_and_manual_verification_boundary(self):
        out = MOD.transform(fixture())
        self.assertIn(MOD.DIRECT_URL, out)
        self.assertIn("evansmusitu5@gmail.com", out)
        self.assertIn('data-direct-paynow-fallback="fixed-price"', out)
        self.assertIn("MUSITU-DIRECT-", out)
        self.assertIn("crypto.randomUUID()", out)
        self.assertIn("does not automatically unlock Premium", out)
        self.assertIn("Do not pay twice.", out)
        self.assertIn("Continue securely to Paynow", out)

    def test_school_orders_are_not_given_a_guessed_amount(self):
        out = MOD.transform(fixture())
        self.assertIn('data-direct-paynow-fallback="school-contact"', out)
        self.assertIn("School pricing depends on the final seat count", out)
        self.assertIn("do not guess an amount", out)

    def test_double_patch_fails_closed(self):
        once = MOD.transform(fixture())
        with self.assertRaises(ValueError):
            MOD.transform(once)

    def test_missing_exact_markers_fails_closed(self):
        with self.assertRaises(ValueError):
            MOD.transform("// MUSITU Chemistry Commerce\n")


if __name__ == "__main__":
    unittest.main()

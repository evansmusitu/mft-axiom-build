from __future__ import annotations

import unittest

from frontier_review_safe.longitudinal_binding import LongitudinalIdentityBinding


class LongitudinalIdentityBindingInputTests(unittest.TestCase):
    def test_non_mapping_level6_input_raises_value_error_not_attribute_error(self):
        with self.assertRaises(ValueError):
            LongitudinalIdentityBinding.from_level6(None)


if __name__ == "__main__":
    unittest.main(verbosity=2)

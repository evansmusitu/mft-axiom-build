#!/usr/bin/env python3
"""Compatibility entrypoint for the hardened Frontier v5 live verifier.

The canonical verifier is ``frontier_live_verify.py``. Keep this v2 path as a
stable alias for older CI or operator references; it must not maintain a second
copy of verification logic or monkey-patch runtime adapters.
"""
from frontier_v5.scripts.frontier_live_verify import main


if __name__ == "__main__":
    main()

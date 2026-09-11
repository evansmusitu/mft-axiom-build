from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


class TestDiscoveryIntegrityTests(unittest.TestCase):
    def test_every_test_module_contributes_discoverable_tests(self):
        root = Path(__file__).resolve().parent
        empty: list[str] = []
        failures: list[str] = []
        for path in sorted(root.glob("test_*.py")):
            if path.name == Path(__file__).name:
                continue
            module_name = f"_axiom_discovery_probe_{path.stem}"
            try:
                spec = importlib.util.spec_from_file_location(module_name, path)
                if spec is None or spec.loader is None:
                    failures.append(f"{path.name}:loader_unavailable")
                    continue
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)
                count = unittest.defaultTestLoader.loadTestsFromModule(module).countTestCases()
                if count == 0:
                    empty.append(path.name)
            except Exception as exc:
                failures.append(f"{path.name}:{type(exc).__name__}")
            finally:
                sys.modules.pop(module_name, None)
        self.assertFalse(failures, "test module import failures: " + ", ".join(failures))
        self.assertFalse(empty, "test modules with zero discoverable tests: " + ", ".join(empty))


if __name__ == "__main__":
    unittest.main(verbosity=2)

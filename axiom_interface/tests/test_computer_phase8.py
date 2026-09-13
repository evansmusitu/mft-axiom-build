from __future__ import annotations

from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS='\n'.join(p.read_text(encoding='utf-8') for p in sorted(ROOT.glob('computer*.js')))
BOOT=(ROOT/'computer_bootstrap.js').read_text(encoding='utf-8')
CSS=(ROOT/'styles'/'computer.css').read_text(encoding='utf-8')
LIVE_DUR=(ROOT/'live_durability.js').read_text(encoding='utf-8')

class Phase8ComputerContractTests(unittest.TestCase):
    def test_visible_computer_surface_and_controls(self):
        for token in ['Computer','Current website/app','Current step','Preview action','Approve exact preview','Execute approved action','Rollback last action','Pause','Resume','Take over','Release takeover','Stop']:
            self.assertIn(token,JS)
        self.assertIn('Visible local computer sandbox',JS)
        self.assertIn('sandbox="allow-same-origin"',JS)
        self.assertNotIn('allow-scripts',JS)

    def test_security_boundaries_are_fail_closed(self):
        for token in ['DENY_BY_DEFAULT_NO_RUNTIME_FETCH','DATA_ONLY','SESSION_LOCAL_TEXT_ONLY_NO_SYSTEM_CLIPBOARD','SYMBOLIC_HANDLE_ONLY_PERMISSION_SCOPED_NO_PLAINTEXT_SECRET_ACCESS','hidden_privileged_browser_session:false','domain not allowed','plaintext secret-like material forbidden']:
            self.assertIn(token,JS)
        self.assertNotRegex(JS,r'fetch\s*\(')
        self.assertNotIn('navigator.clipboard',JS)
        self.assertNotIn('localStorage',JS)
        self.assertIn("const SAFE_DOMAIN='example.test'",JS)
        self.assertIn("const ACCOUNTS_DOMAIN='accounts.example.test'",JS)
        self.assertIn('if(!ALLOWED_DOMAINS.includes(host))',JS)

    def test_prompt_injection_and_exact_approval_contract(self):
        for signal in ['ignore-prior','system-override','credential-request','tool-authority','policy-bypass','role-escalation','data-exfiltration']:
            self.assertIn(signal,JS)
        self.assertIn('prompt-injection quarantine blocks execution',JS)
        self.assertIn('stale/altered preview or actor mismatch',JS)
        self.assertIn('exact approved preview required',JS)
        self.assertIn('approval_receipt_id',JS)
        self.assertIn('receipt_sha256',JS)

    def test_additive_bootstrap_and_accessibility_contract(self):
        self.assertIn("import { initComputerWorkspace } from './computer.js'",BOOT)
        self.assertIn('data-route="computer"',BOOT)
        self.assertIn('AxiomProjects',BOOT)
        self.assertIn('AxiomObservability',BOOT)
        self.assertIn("import './computer_bootstrap.js';",LIVE_DUR)
        self.assertIn('@media(max-width:62rem)',CSS)
        self.assertIn('prefers-reduced-motion:reduce',CSS)

if __name__=='__main__':
    unittest.main(verbosity=2)

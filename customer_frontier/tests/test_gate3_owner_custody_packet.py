import base64,datetime,hashlib,importlib.util,json,re,tempfile,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('custody_builder',ROOT/'scripts/build_gate3_owner_custody_readback.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class OwnerCustodyPacketTests(unittest.TestCase):
    def packet(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        p=Path(self.temp.name)/'owner.ps1'
        meta=builder.build(p,'1'*40,datetime.datetime(2026,11,24,tzinfo=datetime.timezone.utc))
        return p,p.read_text(),meta
    def test_embedded_source_hashes_and_parser_only_dependency(self):
        p,text,meta=self.packet()
        for label in ('Module','Parser','Challenge'):
            raw=base64.b64decode(re.search(r"\$"+label+r"Base64='([^']+)'",text).group(1))
            expected=re.search(r"\$"+label+r"Sha='([a-f0-9]{64})'",text).group(1)
            self.assertEqual(hashlib.sha256(raw).hexdigest(),expected)
        module=base64.b64decode(re.search(r"\$ModuleBase64='([^']+)'",text).group(1)).decode()
        parser=base64.b64decode(re.search(r"\$ParserBase64='([^']+)'",text).group(1)).decode()
        self.assertIn("from './owner_custody_json.mjs'",module)
        self.assertNotIn('ZITADEL_STAGING',parser)
        original=(ROOT/'customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs').read_text()
        start=original.index('export function parseIdentityJson(raw){');end=original.index('\nfunction tokenJson',start)
        self.assertIn(original[start:end],parser)
        self.assertEqual(meta['sha256'],hashlib.sha256(p.read_bytes()).hexdigest())
    def test_challenge_is_fresh_bounded_and_no_gate_approval(self):
        _,text,_=self.packet()
        c=json.loads(base64.b64decode(re.search(r"\$ChallengeBase64='([^']+)'",text).group(1)))
        self.assertEqual(c['repository'],'evansmusitu/mft-axiom-build')
        self.assertEqual(c['account_id'],'67469478aa9349fa0a57fe3a72da200a')
        self.assertFalse(c['gate3_closed']);self.assertEqual(c['release_status'],'NOT_RELEASE')
        delta=datetime.datetime.fromisoformat(c['expires_at_utc'].replace('Z','+00:00'))-datetime.datetime.fromisoformat(c['issued_at_utc'].replace('Z','+00:00'))
        self.assertEqual(delta,datetime.timedelta(days=2))
    def test_owner_credential_uses_hidden_prompt_and_stdin_not_arguments_or_environment(self):
        _,text,_=self.packet()
        self.assertIn('-AsSecureString',text);self.assertIn('ZeroFreeBSTR',text);self.assertIn('StandardInput.Write($payload)',text)
        arguments=next(l for l in text.splitlines() if '$start.Arguments=' in l)
        self.assertNotIn('$plain',arguments);self.assertNotIn('$payload',arguments)
        self.assertNotIn('SetEnvironmentVariable',text);self.assertNotIn('HW_SIGNING_JWK',text)
    def test_missing_or_malformed_source_commit_is_rejected(self):
        for sha in ('main','../escape','a'*39,'g'*40):
            with self.assertRaises(ValueError):builder.build('/tmp/should-not-write.ps1',sha)
    def test_github_setup_stays_after_owner_guard_and_before_cloudflare_input(self):
        _,text,_=self.packet()
        self.assertLess(text.index("StopReadback 'OWNER_INTERACTIVE_PC_REQUIRED'"),text.index('$ghPath=EnsureGithubCli'))
        self.assertLess(text.index('$ghPath=EnsureGithubCli'),text.index("$secure=Read-Host"))
        self.assertIn('install --id GitHub.cli --exact --source winget',text)
        self.assertIn('auth login --hostname github.com --git-protocol https --web --skip-ssh-key',text)
        self.assertNotIn('--with-token',text);self.assertNotIn('--insecure-storage',text);self.assertNotIn('auth refresh',text)
    def test_authentication_choice_does_not_echo_a_mistakenly_pasted_credential(self):
        _,text,_=self.packet()
        choice=next(l for l in text.splitlines() if '$selection=Read-Host' in l)
        self.assertIn('-AsSecureString',choice)
        self.assertIn('$mode=ReadAuthenticationMode',text)

if __name__=='__main__':unittest.main()

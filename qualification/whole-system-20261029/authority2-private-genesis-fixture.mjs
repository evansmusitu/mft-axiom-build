/** Test-only ephemeral signer and synthetic GitHub; NEVER an operator key ceremony. */
import {createHash} from 'node:crypto';
import {sha256Json} from '../../integrations/independent-ledger/protocol.mjs';
import {publishGithubCheckpoint} from '../../integrations/independent-ledger/github-anchor.mjs';
import {genesisBarrierKey} from '../../integrations/security-authority2/authority2-genesis-candidate.mjs';
import {githubFixture} from './github-anchor-fixture.mjs';
export const hash=x=>createHash('sha256').update(x).digest('hex');
export async function controllerFixture(){
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.privateKey);
  const pin={account_id:'67469478aa9349fa0a57fe3a72da200a',ledger_id:'fixture-private-controller-ledger',
    namespace:'ax-private-controller-test',key_id:'ephemeral-test-key',
    public_key_jwk:{kty:'OKP',crv:'Ed25519',x:jwk.x}};
  const commitment={schema:'musitu.axiom.authority2.pre-genesis-commitment.v1',ledger_sequence:0,
    kind:'AUTHORITY2_PREGENESIS',...pin,
    reviewed_bundle_sha256:'d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210',
    genesis_nonce:'f'.repeat(64),initial_sequence:-1,initial_head:'0'.repeat(64)};
  const github=githubFixture('ax-private-controller-test-anchor');
  const proof=await publishGithubCheckpoint({pin:github.pin,token:github.token,
    payload:commitment,fetchImpl:github.fetchImpl});
  const now=Date.now(),approved={schema:'musitu.axiom.authority2.private-genesis-control.v1',
    approved_cron:'* * * * *',not_before_ms:now-5000,not_after_ms:now+600000,
    expected_commitment_sha256:await sha256Json(commitment),
    anchor_pin:github.pin,commitment,anchor_proof:proof};
  const env={HW_CONFIG_JSON:JSON.stringify(pin),HW_SIGNING_JWK:JSON.stringify(jwk),
    HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({read:hash('r'.repeat(40)),write:hash('w'.repeat(40))}),
    HW_GENESIS_CONTROL_TOKEN:'g'.repeat(40),HW_GENESIS_GITHUB_READ_TOKEN:github.readToken,
    HW_GENESIS_CONTROL_JSON:JSON.stringify(approved)};
  const result={schema:'musitu.axiom.authority2.genesis-candidate-result.v1',
    status:'PREGENESIS_COMMITTED_CANDIDATE_ONLY',commitment_sha256:approved.expected_commitment_sha256,
    barrier_key:genesisBarrierKey(pin),initial_sequence:-1,dispatch_allowed:false,release_status:'NOT_RELEASE'};
  let noRetry=0;const controller={cron:approved.approved_cron,scheduledTime:now,noRetry(){noRetry++;}};
  return {env,pin,jwk,approved,github,result,controller,get noRetry(){return noRetry;}};
}

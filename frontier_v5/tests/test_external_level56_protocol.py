import json
from pathlib import Path
from frontier_v5.scripts.run_external_level56_readiness import build

def main():
    root=Path(__file__).resolve().parents[1]
    p=json.loads((root/'evals'/'EXTERNAL_LEVEL56_PROTOCOL_V2.json').read_text())
    assert p['schema']=='musitu.axiom.frontier.external-level56-protocol.v2'
    assert p['execution_policy']['api_key_required'] is False
    assert p['level_5_rule']['all_required_external_systems_required'] is True
    assert p['level_5_rule']['partial_matrix_may_earn_level_5'] is False
    assert p['level_6_rule']['independent_replay_required'] is True
    ids=[x['system_id'] for x in p['required_external_systems']]
    assert ids==['openai-codex','anthropic-claude-code','google-antigravity','cognition-devin-desktop']
    assert p['legacy_identity_rules']['windsurf-cascade']=='cognition-devin-desktop'
    out=build(root,Path('/tmp/does-not-exist-level56-receipts'),Path('/tmp/does-not-exist-level56-replays'))
    assert out['protocol_requires_paid_api_key'] is False
    assert out['completed_external_reference_count']==0
    assert out['evidence_level_5_verified'] is False
    assert out['evidence_level_6_verified'] is False
    assert out['gate']=='MUSITU_AXIOM_LEVEL56_IN_PROGRESS'
    print('MUSITU_AXIOM_EXTERNAL_LEVEL56_PROTOCOL_V2_PASS')

if __name__=='__main__':
    main()

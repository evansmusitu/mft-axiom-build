from copy import deepcopy
from frontier_v5.runtime.external_execution_receipts import ExternalExecutionReceiptError, ExternalExecutionReceiptGate

def expect_error(fn, contains=''):
    try:
        fn()
    except ExternalExecutionReceiptError as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f'expected {contains!r}, got {exc!r}') from exc
        return
    raise AssertionError('expected ExternalExecutionReceiptError')

def receipt(system='openai-codex', surface='OFFICIAL_CLI', status='COMPLETED'):
    return {
      'schema':'musitu.axiom.frontier.external-execution-receipt.v2',
      'receipt_id':'receipt-openai-001',
      'system_id':system,
      'provider':'OpenAI',
      'product':'Codex',
      'surface':surface,
      'execution_status':status,
      'case_set_sha256':CASE_HASH,
      'case_ids':['BUG_REPRO_MINIMAL_REPAIR','CROSS_FILE_FEATURE_REGRESSION','SECURITY_FAIL_CLOSED_REPAIR','ROLLBACK_EXACT_RESTORE'],
      'constraints_sha256':CONSTRAINTS_HASH,
      'result_bundle_sha256':'3'*64 if status=='COMPLETED' else None,
      'session_artifact_sha256':'4'*64 if status=='COMPLETED' else None,
      'captured_at':'2026-10-06T09:00:00Z',
      'auth':{'mode':'ACCOUNT_SESSION','authenticated':True,'account_tier':'Plus'},
      'environment':{'system_version':'2026-10-06','model_disclosure':'PROVIDER_MANAGED_UNDISCLOSED','attempt':1,'human_intervention':'none'},
      'access_blocker':None,
    }

def main():
    gate=ExternalExecutionReceiptGate()
    out=gate.validate_receipt(receipt())
    assert out['status']=='STRUCTURALLY_VALID_EXTERNAL_EXECUTION_CANDIDATE'
    assert out['api_key_required'] is False
    assert out['external_origin_authenticated'] is False
    assert out['evidence_level_5_verified'] is False

    blocked=receipt(system='anthropic-claude-code', surface='OFFICIAL_CLI', status='ACCESS_BLOCKED')
    blocked['provider']='Anthropic'; blocked['product']='Claude Code'
    blocked['auth']={'mode':'ACCOUNT_SESSION','authenticated':False,'account_tier':'NONE'}
    blocked['access_blocker']='NO_ELIGIBLE_ACCOUNT_SESSION'
    out=gate.validate_receipt(blocked)
    assert out['status']=='ACCESS_BLOCKED'
    assert out['counts_as_baseline'] is False
    assert out['evidence_level_5_verified'] is False

    bad=receipt(); bad['surface']='UNOFFICIAL_WRAPPER'
    expect_error(lambda: gate.validate_receipt(bad),'surface')

    bad=receipt(); bad['auth']['authenticated']=False
    expect_error(lambda: gate.validate_receipt(bad),'authenticated')

    bad=receipt(); bad['result_bundle_sha256']=None
    expect_error(lambda: gate.validate_receipt(bad),'result_bundle')

    bad=receipt(); bad['case_ids']=bad['case_ids'][:-1]
    expect_error(
        lambda: gate.assess_level56(
            expected_system_ids=['openai-codex','anthropic-claude-code','google-antigravity','cognition-devin-desktop'],
            expected_case_ids=['BUG_REPRO_MINIMAL_REPAIR','CROSS_FILE_FEATURE_REGRESSION','SECURITY_FAIL_CLOSED_REPAIR','ROLLBACK_EXACT_RESTORE'],
            receipts=[bad],
            independent_replays=[],
        ),
        'case coverage',
    )

    replay={
      'schema':'musitu.axiom.frontier.independent-replay-receipt.v2',
      'replay_id':'replay-openai-001',
      'system_id':'openai-codex',
      'evaluator_id':'evaluator-b',
      'builder_id':'builder-a',
      'source_receipt_sha256':gate.validate_receipt(receipt())['receipt_sha256'],
      'case_set_sha256':CASE_HASH,
      'constraints_sha256':CONSTRAINTS_HASH,
      'result_bundle_sha256':'5'*64,
      'verification_artifact_sha256':'6'*64,
      'captured_at':'2026-10-06T10:00:00Z',
      'independent':True,
      'same_sealed_inputs':True,
      'same_constraints':True,
    }
    rout=gate.validate_independent_replay(replay)
    assert rout['status']=='STRUCTURALLY_VALID_LEVEL6_REPLAY_CANDIDATE'
    assert rout['evidence_level_6_verified'] is False
    bad=deepcopy(replay); bad['evaluator_id']='builder-a'
    expect_error(lambda: gate.validate_independent_replay(bad),'distinct')

    bundle=gate.assess_level56(
      expected_system_ids=['openai-codex','anthropic-claude-code','google-antigravity','cognition-devin-desktop'],
      expected_case_ids=['BUG_REPRO_MINIMAL_REPAIR','CROSS_FILE_FEATURE_REGRESSION','SECURITY_FAIL_CLOSED_REPAIR','ROLLBACK_EXACT_RESTORE'],
      receipts=[receipt(), blocked],
      independent_replays=[replay],
    )
    assert bundle['completed_systems']==['openai-codex']
    assert bundle['access_blocked_systems']==['anthropic-claude-code']
    assert set(bundle['missing_systems'])=={'google-antigravity','cognition-devin-desktop'}
    assert bundle['independent_replay_candidate_count']==1
    assert bundle['evidence_level_5_verified'] is False
    assert bundle['evidence_level_6_verified'] is False
    assert bundle['promotion_status']=='BLOCKED_EXTERNAL_PROVENANCE_AND_MATRIX_COMPLETION_REQUIRED'
    print('MUSITU_AXIOM_EXTERNAL_EXECUTION_RECEIPTS_V2_PASS')

if __name__=='__main__':
    main()

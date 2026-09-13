from fmi_v9_1_control_model import State,execute

def test_rights_absent_zero_mutation():
    r=execute(State(False)); assert r['status']=='BLOCKED_RIGHTS' and r['mutations']==0

def test_live_drift_zero_mutation():
    r=execute(State(True,live_edge_exact=False)); assert r['status']=='BLOCKED_LIVE_DRIFT' and r['mutations']==0

def test_name_collision_zero_mutation():
    r=execute(State(True,private_names_safe=False)); assert r['status']=='BLOCKED_NAME_COLLISION' and r['mutations']==0

def test_happy_path_order():
    r=execute(State(True)); assert r['status']=='PROMOTED_VERIFIED'; assert r['ops'][0]=='deploy_provider_private'; assert r['ops'][-1]=='functional_market_context_probe'

def test_binding_failure_rolls_back():
    r=execute(State(True),fail_at='verify_public_edge_binding'); assert r['status'].startswith('ROLLED_BACK'); assert 'restore_public_edge_settings_exact_snapshot' in r['rollback']

def test_content_failure_rolls_back():
    r=execute(State(True),fail_at='verify_edge_source_workspace_billing_adapter'); assert r['status'].startswith('ROLLED_BACK'); assert r['rollback'][0]=='restore_public_edge_source_exact_bytes'

def test_billing_adapter_never_mutated():
    r=execute(State(True)); assert all('deploy_billing' not in x and 'deploy_adapter' not in x for x in r['ops'])

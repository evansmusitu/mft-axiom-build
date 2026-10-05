#!/usr/bin/env python3
from __future__ import annotations
import json,os,subprocess,sys
def main():
 env=os.environ.copy();env['PYTHONPATH']='.';subprocess.check_call([sys.executable,'frontier_v5/scripts/run_phase9_browser_regression_gate.py'],env=env);root='/tmp/axiom-interface-phase10';env['AXIOM_PHASE10_ARTIFACT_DIR']=root;subprocess.check_call([sys.executable,'axiom_interface/tests/run_browser_phase10.py'],env=env);e=json.load(open(root+'/phase10-memory-browser-evidence.json',encoding='utf-8'));required=['consent_bound_verified','project_graph_linkage_verified','authorized_recall_verified','unauthorized_viewer_rejected','scope_filter_verified','expired_memory_rejected','nondestructive_do_not_use_verified','cross_reload_persistence_verified','ctrl_k_inherited_focus_verified','integrity_verified'];assert e['status']=='PASS' and all(e[k] is True for k in required);assert e['foreign_requests']==[] and e['network_policy']=='DENY_ALL_EXTERNAL_NETWORK' and e['cloud_memory_sync_claimed'] is False and e['hidden_reasoning_storage_claimed'] is False and e['destructive_forget_claimed'] is False;print('MUSITU_AXIOM_INTERFACE_PHASE10_BROWSER_REGRESSION_PASS')
if __name__=='__main__':main()

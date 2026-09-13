#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys

def run(path, env_name, outdir):
 e=os.environ.copy();e['PYTHONPATH']='.';e[env_name]=outdir
 subprocess.check_call([sys.executable,path],env=e)

def main():
 e=os.environ.copy();e['PYTHONPATH']='.'
 subprocess.check_call([sys.executable,'frontier_v5/tests/test_fullstack_local.py'],env=e)
 subprocess.check_call([sys.executable,'frontier_v5/tests/test_browser_network_preflight.py'],env=e)
 sem='/tmp/axiom-interface-phase7-semantic';e['AXIOM_PHASE7_SEMANTIC_ARTIFACT_DIR']=sem
 subprocess.check_call([sys.executable,'frontier_v5/scripts/run_phase7_semantic_gate.py'],env=e)
 s=json.load(open(f'{sem}/phase7-semantic-evidence.json',encoding='utf-8'))
 assert s['status']=='PASS' and s['qualification_scope']=='OFFLINE_SCOPED_LIVE_SEMANTICS'
 assert s['voice']['continuous_dialogue_verified'] and s['voice']['automated_asr_verified'] and s['voice']['tts_verified']
 assert s['camera']['semantic_understanding_verified'] and s['screen']['semantic_understanding_verified'] and s['screen']['selected_region_verified']
 assert s['tool_specialist_hooks']['mcp_2026_tools_call_verified'] and s['tool_specialist_hooks']['tool_receipts_verified']
 assert s['interruption']['worker_stopped'] and s['interruption']['within_target'] and s['interruption']['stop_latency_ms']<=250.0
 dirs={1:'/tmp/axiom-interface-phase1',2:'/tmp/axiom-interface-phase2',3:'/tmp/axiom-interface-phase3',4:'/tmp/axiom-interface-phase4',5:'/tmp/axiom-interface-phase5',6:'/tmp/axiom-interface-phase6',7:'/tmp/axiom-interface-phase7',8:'/tmp/axiom-interface-phase8'}
 for n in range(1,5):
  env='AXIOM_BROWSER_ARTIFACT_DIR' if n==1 else f'AXIOM_PHASE{n}_ARTIFACT_DIR'
  run(f'axiom_interface/tests/run_browser_phase{n}.py',env,dirs[n])
 run('axiom_interface/tests/run_browser_phase4_quality.py','AXIOM_PHASE4_QUALITY_ARTIFACT_DIR','/tmp/axiom-interface-phase4-quality')
 for n in range(5,9):
  run(f'axiom_interface/tests/run_browser_phase{n}.py',f'AXIOM_PHASE{n}_ARTIFACT_DIR',dirs[n])
 p8=json.load(open('/tmp/axiom-interface-phase8/phase8-computer-browser-evidence.json',encoding='utf-8'))
 required=['visible_sandbox_verified','current_site_and_step_visible','exact_preview_approval_verified','stale_approval_rejected','action_receipt_verified','rollback_verified','pause_resume_verified','takeover_verified','stop_verified','domain_deny_verified','restricted_clipboard_verified','credential_scope_verified','prompt_injection_quarantine_verified','observability_linkage_verified','tamper_detection_verified','action_tamper_detection_verified','cross_reload_persistence_verified']
 assert p8['status']=='PASS' and all(p8[k] is True for k in required);assert p8['retrieved_instruction_authority']=='DATA_ONLY';assert p8['foreign_requests']==[];assert p8['hidden_privileged_browser_session'] is False
 print('MUSITU_AXIOM_INTERFACE_PHASE8_BROWSER_REGRESSION_PASS')
if __name__=='__main__': main()

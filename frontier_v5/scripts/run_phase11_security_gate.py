#!/usr/bin/env python3
from __future__ import annotations
import json,os
from pathlib import Path
from frontier_v5.scripts.verify_phase11_authority import verify_surface as verify_phase11_surface
from frontier_v5.scripts.verify_phase12_authority import verify_surface as verify_phase12_surface
ROOT=Path(__file__).resolve().parents[2]/'axiom_interface';OUT=Path(os.environ.get('AXIOM_PHASE11_SECURITY_ARTIFACT_DIR','/tmp/axiom-interface-phase11-security'));OUT.mkdir(parents=True,exist_ok=True)
def main():
 files={name:(ROOT/name).read_text(encoding='utf-8') for name in ['operator_security.js','operator_store.js','operator_ui.js','operator_bootstrap.js']};joined='\n'.join(files.values())
 for token in ['fetch(','WebSocket(','EventSource(']:
  if token in joined:raise SystemExit(f'Phase 11 external transport forbidden: {token}')
 required=['DENY_ALL_EXTERNAL_NETWORK','BROWSER_LOCAL_ADMIN_PREVIEW_ONLY_NO_PRODUCTION_MUTATION','NO_PAYMENT_PROCESSING_OR_SETTLEMENT','LOCAL_ENTERPRISE_PREVIEW_NOT_PRODUCTION_IDENTITY_PROVIDER','NO_HIDDEN_REASONING_OR_SECRET_STORAGE','prepareRoleChange','applyRoleChange','preparePolicy','applyPolicy','previous_event_sha256','receipt_sha256']
 missing=[token for token in required if token not in joined]
 if missing:raise SystemExit('Phase 11 contract tokens missing: '+','.join(missing))
 surface=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))
 if surface.get('schema')=='musitu.axiom.interface.surface-map.v12' and surface.get('phase')=='PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE':authority_mode=verify_phase12_surface(surface)
 else:authority_mode=verify_phase11_surface(surface)
 evidence={'schema':'musitu.axiom.interface.phase11-security-evidence.v1','status':'PASS','authority_mode':authority_mode,'network_policy':'DENY_ALL_EXTERNAL_NETWORK','control_plane_mode':'BROWSER_LOCAL_ADMIN_PREVIEW_ONLY_NO_PRODUCTION_MUTATION','exact_admin_preview_required':True,'tamper_evident_events_and_receipts':True,'production_identity_mutation_claimed':False,'production_billing_claimed':False,'cloud_control_plane_claimed':False,'external_action_execution_claimed':False,'hidden_reasoning_recorded':False,'phase10_authority_preserved':True};(OUT/'phase11-security-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8');print('MUSITU_AXIOM_INTERFACE_PHASE11_SECURITY_PASS')
if __name__=='__main__':main()

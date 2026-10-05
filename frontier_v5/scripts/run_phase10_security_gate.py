#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,os
from pathlib import Path
FILES=[Path('axiom_interface/memory_security.js'),Path('axiom_interface/memory_store.js'),Path('axiom_interface/memory_ui.js'),Path('axiom_interface/memory_bootstrap.js')]
def main():
 payload='\n'.join(p.read_text(encoding='utf-8') for p in FILES);errors=[]
 for token in ['fetch(','WebSocket(','EventSource(']:
  if token in payload:errors.append(f'external_transport:{token}')
 for token in ['DENY_ALL_EXTERNAL_NETWORK','NO_SECRET_OR_HIDDEN_REASONING_STORAGE','memoryVisible','markDoNotUse','receipt_sha256','previous_event_sha256']:
  if token not in payload:errors.append(f'missing:{token}')
 out={'schema':'musitu.axiom.interface.phase10-memory-security.v1','status':'FAIL' if errors else 'PASS','errors':errors,'source_sha256':hashlib.sha256(payload.encode()).hexdigest(),'external_network_claimed':False,'cloud_memory_sync_claimed':False,'hidden_reasoning_storage_claimed':False,'destructive_forget_claimed':False}
 root=Path(os.environ.get('AXIOM_PHASE10_SECURITY_ARTIFACT_DIR','/tmp/axiom-interface-phase10-security'));root.mkdir(parents=True,exist_ok=True);(root/'phase10-security-evidence.json').write_text(json.dumps(out,indent=2,sort_keys=True)+'\n',encoding='utf-8')
 if errors:raise SystemExit(json.dumps(out,sort_keys=True))
 print('MUSITU_AXIOM_INTERFACE_PHASE10_SECURITY_PASS')
if __name__=='__main__':main()

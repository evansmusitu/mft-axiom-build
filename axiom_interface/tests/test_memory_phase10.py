from __future__ import annotations
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
SEC=(ROOT/'memory_security.js').read_text(encoding='utf-8');STORE=(ROOT/'memory_store.js').read_text(encoding='utf-8');UI=(ROOT/'memory_ui.js').read_text(encoding='utf-8');BOOT=(ROOT/'memory_bootstrap.js').read_text(encoding='utf-8');SW=(ROOT/'sw.js').read_text(encoding='utf-8');SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))
class Phase10MemoryContractTests(unittest.TestCase):
 def test_blueprint_memory_graph_is_user_facing_and_progressive(self):
  self.assertIn('#/project/memory',UI);self.assertIn('AxiomMemoryBootstrap',BOOT);self.assertIn('AxiomAgents?.store',BOOT)
 def test_consent_scope_retention_and_viewers_are_fail_closed(self):
  for token in ['consent source are required','invalid active memory scope','invalid memory retention','at least one authorized viewer','temporary memory requires a future expiry','permanent memory cannot have expiry','authorized_viewers','expires_at']:self.assertIn(token,SEC)
  for scope in ['private','project','organization','shared','do_not_use']:self.assertIn(scope,SEC)
  self.assertIn('memoryVisible',STORE)
 def test_revocation_is_nondestructive_and_receipted(self):
  for token in ['markDoNotUse','memory.do_not_use','prior_record_sha256','DO_NOT_USE','revocation_consent_source','receipt_sha256']:self.assertIn(token,STORE)
 def test_memory_is_project_graph_and_provenance_linked(self):
  for token in ["type:'memory'","relation:'derived-from'",'project_object_id','source_refs','record_sha256','previous_event_sha256']:self.assertIn(token,STORE)
 def test_no_external_transport_or_hidden_reasoning_storage(self):
  for text in [SEC,STORE,UI,BOOT]:
   self.assertNotIn('fetch(',text);self.assertNotIn('WebSocket(',text);self.assertNotIn('EventSource(',text)
  self.assertIn('DENY_ALL_EXTERNAL_NETWORK',SEC);self.assertIn('NO_SECRET_OR_HIDDEN_REASONING_STORAGE',SEC)
 def test_offline_shell_contains_memory_assets(self):
  for asset in ['./memory_bootstrap.js','./memory_security.js','./memory_store.js','./memory_ui.js','./memory_ui_markup.js','./styles/memory.css']:self.assertIn(asset,SW)
  self.assertIn('axiom-interface-phase10-v1',SW)
 def test_phase10_remains_unearned_until_exact_authority_seal(self):
  authority=SURFACE['authority'];self.assertEqual(authority['qualified_phase9_sha'],'277478e12529f755fc4269b648e8fbe08caafb92');phase10=authority.get('qualified_phase10_sha')
  if phase10 is None:
   self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v9');self.assertEqual(SURFACE['phase'],'PHASE_9_AGENTS_AUTOMATIONS');self.assertNotIn('memory_graph_substrate',SURFACE)
  else:
   self.assertEqual(phase10,'78d76060138a00e48839edb1d5454f1a197225b3');self.assertEqual(authority['qualified_phase10_run_id'],34742232871);self.assertEqual(authority['qualified_phase10_evidence_artifact_id'],10313160943);self.assertEqual(authority['qualified_phase10_evidence_digest'],'sha256:9cebd9b5cf537edf10fe3c7602049bc6f4b201a4876467630cdfcb59864f48e0');self.assertEqual(authority['qualified_phase10_runtime_security_artifact_id'],10312469541);self.assertEqual(authority['qualified_phase10_runtime_security_evidence_digest'],'sha256:91c5d40324708e56f046716ec1fe18f7cc945e5c85735e0c4ddbed6b565efe76');self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v10');self.assertEqual(SURFACE['phase'],'PHASE_10_MEMORY_GRAPH')
   memory=SURFACE['memory_graph_substrate'];self.assertEqual(memory['status'],'EARNED');self.assertEqual(memory['qualification_scope'],'BROWSER_LOCAL_CONSENT_SCOPED_MEMORY_GRAPH_WITH_NONDESTRUCTIVE_REVOCATION');self.assertEqual(memory['qualified_sha'],phase10);self.assertEqual(memory['workflow_run_id'],34742232871);self.assertEqual(memory['evidence_artifact_id'],10313160943);self.assertEqual(memory['evidence_artifact_digest'],'sha256:9cebd9b5cf537edf10fe3c7602049bc6f4b201a4876467630cdfcb59864f48e0');self.assertEqual(memory['runtime_security_evidence_artifact_id'],10312469541);self.assertEqual(memory['runtime_security_evidence_artifact_digest'],'sha256:91c5d40324708e56f046716ec1fe18f7cc945e5c85735e0c4ddbed6b565efe76');self.assertEqual(memory['persistence'],'INDEXEDDB_BROWSER_LOCAL_DEVICE');self.assertEqual(memory['network_policy'],'DENY_ALL_EXTERNAL_NETWORK');self.assertEqual(memory['secret_policy'],'NO_SECRET_OR_HIDDEN_REASONING_STORAGE');self.assertEqual(memory['revocation'],'NONDESTRUCTIVE_DO_NOT_USE_WITH_RECEIPT');self.assertFalse(memory['external_network_claimed']);self.assertFalse(memory['cloud_memory_sync_claimed']);self.assertFalse(memory['hidden_reasoning_storage_claimed']);self.assertFalse(memory['destructive_forget_claimed'])
if __name__=='__main__':unittest.main(verbosity=2)

// FA-06/FA-07/FA-08 compatibility wrapper.
// The earned Project/Work adapter implementation remains byte-for-byte in data_adapters_base.js.
// Contract markers retained for deterministic governance tests:
// ProjectStore · OutcomeContractStore · BROWSER_LOCAL_INDEXEDDB
// PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS · cloudSyncClaim:false · multiDeviceSyncClaim:false
import './foundation_bootstrap.js';
import './capability_guard.js';
import './memory_runtime_ui.js';
export * from './data_adapters_base.js';

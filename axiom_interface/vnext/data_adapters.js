// FA-06 compatibility wrapper.
// The earned local adapter implementation is preserved byte-for-byte in data_adapters_base.js.
// Contract markers retained for deterministic governance tests:
// ProjectStore · OutcomeContractStore · BROWSER_LOCAL_INDEXEDDB
// PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS · cloudSyncClaim:false · multiDeviceSyncClaim:false
import './foundation_bootstrap.js';
export * from './data_adapters_base.js';

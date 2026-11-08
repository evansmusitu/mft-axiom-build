import { Client } from 'pg';
import { createStagingProbeWorker } from './worker_core.mjs';

// Per-invocation clients only; Hyperdrive owns the underlying origin connection pool.
export default createStagingProbeWorker(options=>new Client(options));

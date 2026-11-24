/**
 * MUSITU Studio Gate 6 candidate — new isolated SQLite Durable Object controller.
 * Unhosted and NOT an API entrypoint. External identity, worker auth, provider
 * hard caps, migrations, cost settlement and dispatcher are deliberately absent.
 * No provider calls, no hosted writes, no asset access from this source.
 */
export class QueueGateClosed extends Error {}
export class QueueConflict extends Error {}

export class G56DurableQueueController {
  constructor(storage, { authorizeUser, authorizeWorker, authorizeMaintenance, now } = {}) {
    if (!storage?.sql?.exec || typeof storage.transactionSync !== 'function')
      throw new QueueGateClosed('SQLITE_DURABLE_STORAGE_REQUIRED');
    this.storage = storage;
    this.authorizeUser = authorizeUser;
    this.authorizeWorker = authorizeWorker;
    this.authorizeMaintenance = authorizeMaintenance;
    this.now = now || (() => Math.floor(Date.now() / 1000));
  }
  status() { throw new QueueGateClosed('NOT_IMPLEMENTED'); }
  cancel() { throw new QueueGateClosed('NOT_IMPLEMENTED'); }
  progress() { throw new QueueGateClosed('NOT_IMPLEMENTED'); }
  quarantineStale() { throw new QueueGateClosed('NOT_IMPLEMENTED'); }
}

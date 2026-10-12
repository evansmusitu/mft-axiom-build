/** SQLite local and Cloudflare SQLite Durable Object transaction compatibility.
 * Real Cloudflare SQL API disallows BEGIN/COMMIT via sql.exec; transactionSync
 * surrounds the entire synchronous operation instead. No nested transactions.
 */
export function mmfTransaction(db, operation) {
 if (typeof operation !== 'function') throw Error('MMF_TRANSACTION_DENIED');
 if (typeof db?.transactionSync === 'function') return db.transactionSync(operation);
 if (!db?.exec) throw Error('MMF_TRANSACTION_DENIED');
 db.exec('BEGIN IMMEDIATE');
 try {
  const result=operation();
  if (result && typeof result.then === 'function') throw Error('MMF_TRANSACTION_DENIED');
  db.exec('COMMIT');
  return result;
 } catch (err) {
  db.exec('ROLLBACK');
  throw err;
 }
}
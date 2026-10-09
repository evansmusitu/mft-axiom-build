/** Atomic D1 reservation: one SQL statement is the admission boundary.
 * Required schema is created separately by reviewed migration. Failed or
 * ambiguous D1 reservation consumes/denies; NEVER falls back to memory.
 */
export async function reserveQuota(db, claims, now) {
  if (!db || typeof db.prepare !== 'function') throw Error('QUOTA_DB_MISSING');
  const day = new Date(now).toISOString().slice(0,10);
  const minute = new Date(now).toISOString().slice(0,16);
  // Counts include failed provider operations: at-most-once delivery and no
  // repeated egress under retries. Global caps intentionally conservative.
  const maxGlobal = 40; const maxPerUser = 4; const maxMinute = 3;
  const sql = `INSERT INTO public_inference_reservations
    (nonce, subject, project, provider, day_utc, minute_utc, max_tokens)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM public_inference_reservations WHERE day_utc=?) < ?
      AND (SELECT COUNT(*) FROM public_inference_reservations WHERE day_utc=? AND subject=?) < ?
      AND (SELECT COUNT(*) FROM public_inference_reservations WHERE minute_utc=?) < ?`;
  const params = [claims.nonce,claims.subject,claims.project,claims.provider,day,minute,claims.max_tokens,
    day,maxGlobal,day,claims.subject,maxPerUser,minute,maxMinute];
  const result = await db.prepare(sql).bind(...params).run();
  if (result?.meta?.changes !== 1) throw Error('QUOTA_EXHAUSTED_OR_UNKNOWN');
  return { nonce:claims.nonce, committed:true };
}

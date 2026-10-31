/**
 * Store V2 PRIVATE operator-only, out-of-band quota-window retention candidate.
 * Requires a separately provisioned narrow PostgreSQL maintenance role; never
 * expose through portal HTTP routes and never provision database credentials.
 * All cutoff calculations and row selections belong to the database server.
 */
export function createPrivateRateWindowPruner({query}={}) {
 if(typeof query!=='function')throw Error('private retention requires a trusted database query');
 return async function prune({maxRows=1000}={}){
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000)
   throw Error('private retention batch size must be from 1 to 1000');
  const result=await query('SELECT store_publisher_private.prune_portal_rate_windows($1) AS deleted',[maxRows]);
  if(!result||result.rowCount!==1||!Array.isArray(result.rows)||result.rows.length!==1||
    !Number.isSafeInteger(result.rows[0]?.deleted)||result.rows[0].deleted<0||
    result.rows[0].deleted>maxRows)
   throw Error('invalid private database retention result');
  return result.rows[0].deleted;
 };
}

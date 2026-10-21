/**
 * MUSITU Store V2 - isolated Neon Postgres adapter for the existing D1-shaped
 * payment worker. No production Neon or Cloudflare resources provisioned here.
 *
 * Supply a trusted `neon(DATABASE_URL)` SQL client at the private server-side
 * boundary. Never expose DATABASE_URL to customers or front-end code.
 * All existing checkout flags remain OFF unless separately authorized.
 */
function compileStoreSql(source,values){
 if(typeof source!=='string'||source.length>4096||
   /;|--|\/\*|\*\//.test(source)||
   !/^\s*(SELECT|INSERT|UPDATE)\b/i.test(source)||
   /\b(?:billing_subscriptions|usage_buckets|axiom_customers)\b/i.test(source))
   throw Error('store_neon_sql_statement_not_allowed');
 const tables=[...source.matchAll(/\b(?:FROM|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)]
   .map(match=>match[1].toLowerCase());
 if(!tables.length||tables.some(table=>![
    'store_customer_tokens','store_products','store_checkout_intents','store_checkout_reviews'
   ].includes(table)))throw Error('store_neon_table_not_allowed');
 let max=0;
 const statement=source.replace(/\?(\d+)/g,(_,value)=>{
   const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>16)throw Error('store_neon_placeholder_invalid');
   max=Math.max(max,n);return '$'+n;
 });
 if(/\?\d|\$\{/.test(statement)||max!==values.length)
   throw Error('store_neon_parameter_mismatch');
 return statement;
}
function validResult(result){
 // Driver must preserve PostgreSQL row-count metadata, never assume success.
 if(!result||!Array.isArray(result.rows)||
    !Number.isSafeInteger(result.rowCount)||result.rowCount<0)
   throw Error('store_neon_missing_write_evidence');
 return result;
}
class BoundStoreStatement{
 constructor(db,source,values){
  this.owner=db;this.params=values.slice();
  this.statement=compileStoreSql(source,values);
 }
 async first(){
  if(!/^SELECT\b/i.test(this.statement.trimStart()))
    throw Error('store_neon_first_requires_select');
  const result=validResult(await this.owner.sql.query(this.statement,this.params,{fullResults:true}));
  return result.rows[0]??null;
 }
 async run(){
  if(!/^(INSERT|UPDATE)\b/i.test(this.statement.trimStart()))
    throw Error('store_neon_run_requires_write');
  const result=validResult(await this.owner.sql.query(this.statement,this.params,{fullResults:true}));
  return {success:true,meta:{changes:result.rowCount}};
 }
}
export function createStoreNeonD1Adapter(sql){
 if(!sql||typeof sql.query!=='function'||typeof sql.transaction!=='function')
   throw Error('store_neon_driver_not_configured');
 const db={
  sql,
  prepare(source){
   // D1-style chaining maintained to reuse the reviewed Store payment worker.
   return {bind(...values){return new BoundStoreStatement(db,source,values)}};
  },
  async batch(items){
   if(!Array.isArray(items)||items.length!==2||
      items.some(item=>!(item instanceof BoundStoreStatement)||item.owner!==db||
                !/^(INSERT|UPDATE)\b/i.test(item.statement.trimStart())))
     throw Error('store_neon_batch_invalid');
   // Neon HTTP non-interactive SERIALIZABLE transaction: BOTH review INSERT
   // and status UPDATE succeed, or neither commits. No partial paid review.
   const results=await sql.transaction(
    items.map(item=>sql.query(item.statement,item.params)),
    {isolationMode:'Serializable',readOnly:false,fullResults:true});
   if(!Array.isArray(results)||results.length!==2)
    throw Error('store_neon_batch_unverified');
   return results.map(result=>{
    const verified=validResult(result);
    return {success:true,meta:{changes:verified.rowCount}};
   });
  },
 };
 return db;
}

/**
 * Staging creates a D1-shaped facade only after the private caller supplies
 * a SQL client. The actual Store worker continues to require its existing
 * flags + merchant keys; this module cannot itself enable checkout.
 */
export function requireDisabledStoreNeonStaging(env){
 if(env?.STORE_NEON_STAGING_ONLY!=='true'||
    env?.STORE_CHECKOUT_ENABLED!=='false'||
    env?.STORE_CALLBACKS_CERTIFIED!=='false'||
    typeof env?.STORE_NEON_DATABASE_URL!=='string'||
    !/^postgres(?:ql)?:\/\//.test(env.STORE_NEON_DATABASE_URL)||
    env?.STORE_PAYNOW_INTEGRATION_KEY||env?.STORE_PAYNOW_ID)
  throw Error('store_neon_staging_not_disabled_or_not_isolated');
 return true;
}

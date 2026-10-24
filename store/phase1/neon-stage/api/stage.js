/**
 * MUSITU Store V2: non-production read-only Neon acceptance endpoint.
 * Vercel Deployment Protection MUST remain enabled. This handler cannot
 * issue checkout URLs, take money, enroll customers or grant entitlements.
 */
const flags = Object.freeze({checkout_enabled:false,callbacks_certified:false,
  payments_enabled:false,entitlement_granted:false,payout_authorized:false});
const PROBE_SQL = `SELECT current_database() AS db,
 current_user AS role_name,
 pg_has_role(current_user,'neon_superuser','member') AS elevated,
 (SELECT count(*)::int FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
  AND table_name IN ('store_customer_tokens','store_products',
  'store_checkout_intents','store_checkout_reviews')) AS store_tables,
 (SELECT count(*)::int FROM store_products) AS product_count,
 (SELECT count(*)::int FROM store_checkout_intents) AS order_count,
 (SELECT count(*)::int FROM store_checkout_reviews) AS review_count,
 (SELECT count(*)::int FROM store_customer_tokens) AS token_count,
 (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_superuser,
 (SELECT rolcreatedb FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_can_createdb,
 (SELECT rolcreaterole FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_can_createrole,
 (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_can_bypassrls,
 (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_can_login`;
const respond=(res,status,code)=>res.status(status).json({ok:status===200,code,...flags});
function safeUrl(value){
 try{
  const u=new URL(value);
  return u.protocol==='postgresql:' && u.hostname==='ep-shiny-sea-b5ub1n0n.c-7.us-east-2.aws.neon.tech' &&
    u.username==='musitu_store_v2_gateway' && u.password.length>=40 &&
    u.pathname==='/musitu_store_v2_staging' && !u.hash && u.port==='' &&
    u.searchParams.size===1 && u.searchParams.get('sslmode')==='require';
 }catch{return false;}
}
export function createStageHandler({probe}={}){
 const perform=probe??(async url=>{
  const {neon}=await import('@neondatabase/serverless');
  const sql=neon(url,{fullResults:true});
  return await sql.query(PROBE_SQL,[],{fullResults:true});
 });
 return async function stageStatus(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  if(req.method!=='GET')return respond(res,405,'stage_read_only');
  const env=process.env;
  if(env.STORE_NEON_STAGING_ONLY!=='true'||
     env.STORE_CHECKOUT_ENABLED!=='false'||
     env.STORE_CALLBACKS_CERTIFIED!=='false'||
     (env.STORE_PAYOUTS_ENABLED && env.STORE_PAYOUTS_ENABLED!=='false')||
     (env.STORE_ENTITLEMENTS_ENABLED && env.STORE_ENTITLEMENTS_ENABLED!=='false')||
     env.STORE_PAYNOW_ID||env.STORE_PAYNOW_INTEGRATION_KEY)
   return respond(res,503,'stage_gate_closed');
  if(!env.STORE_NEON_DATABASE_URL)return respond(res,503,'stage_database_not_attached');
  if(!safeUrl(env.STORE_NEON_DATABASE_URL))return respond(res,503,'stage_db_identity_rejected');
  try{
   const result=await perform(env.STORE_NEON_DATABASE_URL);
   const row=result?.rows?.[0];
   if(result?.rowCount!==1||row?.db!=='musitu_store_v2_staging'||
      row.role_name!=='musitu_store_v2_gateway'||row.elevated!==false||
      Number(row.store_tables)!==4||
      Number(row.product_count)!==0||Number(row.order_count)!==0||
      Number(row.review_count)!==0||Number(row.token_count)!==0||
      row.role_superuser!==false||row.role_can_createdb!==false||
      row.role_can_createrole!==false||row.role_can_bypassrls!==false||
      row.role_can_login!==true)
    return respond(res,503,'stage_database_not_qualified');
   return respond(res,200,'stage_db_connected_disabled');
  }catch{
   return respond(res,503,'stage_database_unreachable');
  }
 };
}
export default createStageHandler();

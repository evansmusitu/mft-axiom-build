/**
 * MUSITU Store V2 Paynow 27721 — private, deny-all stage endpoint.
 * This is a deployment and secret custody witness, NOT a payment worker.
 * No Paynow network calls, order creation, callback handling, entitlement,
 * refund, publisher payout, or merchant-key disclosure are permitted.
 */
const SAFE_STATUS={ok:true,code:'store_paynow_27721_private_disabled',integration_id:'27721',testing:true,checkout_enabled:false,callbacks_certified:false,entitlement_granted:false,payout_authorized:false};
const DENIED={ok:false,code:'store_private_commerce_disabled',checkout_enabled:false,entitlement_granted:false,payout_authorized:false};
function safeEnvironment(env){
  return env?.STORE_PAYNOW_ID==='27721'&&
   env?.STORE_PAYNOW_MODE==='testing'&&
   typeof env?.STORE_PAYNOW_INTEGRATION_KEY==='string'&&
   env.STORE_PAYNOW_INTEGRATION_KEY.length>=16&&
   env.STORE_CHECKOUT_ENABLED==='false'&&
   env.STORE_CALLBACKS_CERTIFIED==='false'&&
   env.STORE_FIRST_PARTY_ONLY==='true'&&
   env.STORE_PUBLISHER_PAYOUTS_ENABLED==='false'&&
   env.STORE_ENTITLEMENTS_ENABLED==='false';
}
export function createStageGate(env){
 return async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  // Do not serve external requests if the merchant binding or any safety flag drifts.
  const ok=req?.method==='GET'&&req?.url?.split('?')[0]==='/api/stage'&&safeEnvironment(env);
  return res.status(ok?200:503).end(JSON.stringify(ok?SAFE_STATUS:DENIED));
 };
}
export default createStageGate(process.env);

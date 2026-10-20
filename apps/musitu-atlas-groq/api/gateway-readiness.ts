import {credits} from './_gateway.js';
export default async function handler(req:any,res:any){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','no-store');
 const c=await credits();
 // Balance is recorded in team-scoped private runtime logs, not published as user-facing finance details.
 console.info('ATLAS_GATEWAY_CREDIT_AUDIT',JSON.stringify({status:c.status,verified:c.verified,balanceUsd:c.balance,totalUsedUsd:c.totalUsed,at:new Date().toISOString()}));
 return res.status(200).json({
  oidcIntegrated:true,
  creditsReadable:c.verified,
  positiveCreditBalance:c.verified&&c.balance!==null&&c.balance>0,
  likelyUnderFiveDollars:c.verified&&c.balance!==null&&c.balance<=5.01,
  status:c.status,
  inferenceLocked:!(process.env.ATLAS_GATEWAY_BUDGET_VERIFIED==='yes'&&process.env.ATLAS_LAB_USE_GATEWAY==='enabled'),
  note:'A positive balance is not proof of free-tier eligibility. No model inference or purchase occurs during this check.'
 });
}

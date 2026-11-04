import type { Pool, PoolClient } from "pg";
import type { TenantScope } from "./types.ts";
import type { ProviderReservation, ProviderSettlement, ProviderSpendLedger, ProviderSpendStatus } from "./provider_budget.ts";
import { ProviderBudgetError } from "./provider_budget.ts";

/**
 * Centralized, multi-worker, tenant-scoped provider accounting.
 * Uses a transaction plus the budget row's PostgreSQL FOR UPDATE lock for
 * every writer. Operator provisions budgets explicitly; ordinary callers
 * receive only reserve/settle/status, not an administrative HTTP endpoint.
 *
 * This ledger cannot prevent external providers from charging more than
 * their reserved estimate; observed overages suspend future requests.
 */
function id(value:unknown,label:string):string{
  if(typeof value!=="string"||!value.trim()||value.length>256)throw new TypeError(label+" must be a bounded identifier");
  return value;
}
function amount(value:unknown,label:string,positive=false):number{
  if(!Number.isSafeInteger(value)||Number(value)<(positive?1:0))
    throw new TypeError(label+" must be a safe non-negative integer micro-USD amount");
  return Number(value);
}
function sha(value:unknown,label:string):string{
  if(typeof value!=="string"||!/^[0-9a-f]{64}$/.test(value))
    throw new TypeError(label+" must be a lowercase SHA-256 digest");
  return value;
}
function context(input:ProviderReservation|ProviderSettlement):void{
  id(input.tenantId,"tenantId");id(input.provider,"provider");
  id(input.modelId,"modelId");id(input.requestId,"requestId");
  sha(input.requestHash,"requestHash");
}
function big(row:any,key:string):number{
  const text=String(row?.[key]??"");
  if(!/^(0|[1-9][0-9]*)$/.test(text))throw new ProviderBudgetError("BUDGET_CORRUPT","Provider spend store is corrupt",503);
  const value=BigInt(text);
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new ProviderBudgetError("BUDGET_CORRUPT","Provider spend store exceeds integer precision",503);
  return Number(value);
}
function report(row:any):ProviderSpendStatus{
  if(!row)throw new ProviderBudgetError("BUDGET_NOT_PROVISIONED","No tenant provider budget is provisioned",403);
  const limitMicroUsd=big(row,"limit_micro_usd");
  const chargedMicroUsd=big(row,"charged_micro_usd");
  const reservedMicroUsd=big(row,"reserved_micro_usd");
  if(chargedMicroUsd+reservedMicroUsd>Number.MAX_SAFE_INTEGER)
    throw new ProviderBudgetError("BUDGET_CORRUPT","Provider spend totals exceed integer precision",503);
  return {limitMicroUsd,chargedMicroUsd,reservedMicroUsd,
    availableMicroUsd:Math.max(0,limitMicroUsd-chargedMicroUsd-reservedMicroUsd)};
}
type Key={tenantId:string;provider:string;modelId:string};
const budgetWhere="tenant_id=$1 AND provider=$2 AND model_id=$3";
const budgetValues=(input:Key)=>[input.tenantId,input.provider,input.modelId];

export class PostgresProviderSpendLedger implements ProviderSpendLedger {
  #authenticBudgetLedger=true;
  private readonly pool:Pick<Pool,"connect">;
  static isAuthenticLedger(value:unknown):value is PostgresProviderSpendLedger {
    return typeof value==="object"&&value!==null&&
      #authenticBudgetLedger in value&&
      (value as PostgresProviderSpendLedger).reserve===PostgresProviderSpendLedger.prototype.reserve&&
      (value as PostgresProviderSpendLedger).settle===PostgresProviderSpendLedger.prototype.settle;
  }
  constructor(pool:Pick<Pool,"connect">){
    if(!pool||typeof pool.connect!=="function")throw new TypeError("Operator-owned PostgreSQL pool required");
    this.pool=pool;
  }
  private async tx<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{
    let client:PoolClient;
    try{client=await this.pool.connect();}
    catch{throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE","Provider spend store unavailable",503);}
    try{
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = 5000");
      await client.query("SET LOCAL lock_timeout = 4000");
      const result=await operation(client);
      await client.query("COMMIT");
      return result;
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      if(error instanceof ProviderBudgetError||error instanceof TypeError)throw error;
      throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE","Provider spend store unavailable",503);
    }finally{
      try{client.release();}catch{}
    }
  }
  private async lockedBudget(client:PoolClient,key:Key):Promise<any>{
    const q=await client.query("SELECT limit_micro_usd,charged_micro_usd,reserved_micro_usd,suspended FROM axiom_provider_spend_budgets WHERE "+budgetWhere+" FOR UPDATE",budgetValues(key));
    if(q.rowCount!==1)throw new ProviderBudgetError("BUDGET_NOT_PROVISIONED","No tenant provider budget is provisioned",403);
    return q.rows[0];
  }
  /** Trusted administrator-only immutable provisioning; changes need audited migration. */
  async provision(scope:TenantScope,provider:string,modelId:string,limitMicroUsd:number):Promise<void>{
    const tenantId=id(scope?.tenantId,"tenantId");
    id(provider,"provider");id(modelId,"modelId");amount(limitMicroUsd,"limitMicroUsd");
    await this.tx(async client=>{
      await client.query("INSERT INTO axiom_provider_spend_budgets(tenant_id,provider,model_id,limit_micro_usd) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,provider,model_id) DO NOTHING",
        [tenantId,provider,modelId,limitMicroUsd]);
      const row=await this.lockedBudget(client,{tenantId,provider,modelId});
      if(big(row,"limit_micro_usd")!==limitMicroUsd)throw new ProviderBudgetError("BUDGET_POLICY_IMMUTABLE","Existing budget policy differs; audited administrator migration required",409);
    });
  }
  async status(scope:TenantScope,provider:string,modelId:string):Promise<ProviderSpendStatus>{
    const key={tenantId:id(scope?.tenantId,"tenantId"),provider:id(provider,"provider"),modelId:id(modelId,"modelId")};
    return this.tx(async client=>{
      const row=await client.query("SELECT limit_micro_usd,charged_micro_usd,reserved_micro_usd FROM axiom_provider_spend_budgets WHERE "+budgetWhere,budgetValues(key));
      return report(row.rows[0]);
    });
  }
  async reserve(input:ProviderReservation):Promise<void>{
    context(input);amount(input.reserveMicroUsd,"reserveMicroUsd",true);
    await this.tx(async client=>{
      const row=await this.lockedBudget(client,input);
      if(row.suspended===true)throw new ProviderBudgetError("BUDGET_SUSPENDED","Provider spending suspended; reconciliation required");
      const old=await client.query("SELECT request_hash,status FROM axiom_provider_spend_requests WHERE "+budgetWhere+" AND request_id=$4",
        [...budgetValues(input),input.requestId]);
      if(old.rowCount){
        if(old.rows[0].request_hash!==input.requestHash)
          throw new ProviderBudgetError("BUDGET_IDENTITY_COLLISION","Provider billing intent identity collision",409);
        const pending=old.rows[0].status==="RESERVED";
        throw new ProviderBudgetError(pending?"BUDGET_PENDING_RECONCILIATION":"BUDGET_ALREADY_SETTLED",
          pending?"Provider request already reserved; reconciliation required":"Provider request already settled; duplicate provider call denied",409);
      }
      const available=report(row);
      if(input.reserveMicroUsd>available.availableMicroUsd)
        throw new ProviderBudgetError("BUDGET_EXCEEDED","Tenant provider spending limit would be exceeded");
      await client.query("INSERT INTO axiom_provider_spend_requests(tenant_id,provider,model_id,request_id,request_hash,reserve_micro_usd,status) VALUES($1,$2,$3,$4,$5,$6,'RESERVED')",
        [input.tenantId,input.provider,input.modelId,input.requestId,input.requestHash,input.reserveMicroUsd]);
      await client.query("UPDATE axiom_provider_spend_budgets SET reserved_micro_usd=reserved_micro_usd+$4 WHERE "+budgetWhere,
        [...budgetValues(input),input.reserveMicroUsd]);
    });
  }
  async settle(input:ProviderSettlement):Promise<void>{
    context(input);amount(input.chargeMicroUsd,"chargeMicroUsd");sha(input.responseHash,"responseHash");
    const overage=await this.tx(async client=>{
      const row=await this.lockedBudget(client,input);
      const old=await client.query("SELECT request_hash,status,reserve_micro_usd FROM axiom_provider_spend_requests WHERE "+budgetWhere+" AND request_id=$4 FOR UPDATE",
        [...budgetValues(input),input.requestId]);
      if(old.rowCount!==1||old.rows[0].request_hash!==input.requestHash||old.rows[0].status!=="RESERVED")
        throw new ProviderBudgetError("BUDGET_SETTLEMENT_FORBIDDEN","No matching unsettled billing reservation",409);
      const reserved=big(old.rows[0],"reserve_micro_usd");
      const charged=big(row,"charged_micro_usd");
      const held=big(row,"reserved_micro_usd");
      if(reserved>held||BigInt(charged)+BigInt(input.chargeMicroUsd)>BigInt(Number.MAX_SAFE_INTEGER))
        throw new ProviderBudgetError("BUDGET_CORRUPT","Provider spend totals cannot be reconciled",503);
      const excessive=input.chargeMicroUsd>reserved;
      await client.query("UPDATE axiom_provider_spend_requests SET status=$5,charge_micro_usd=$6,response_hash=$7 WHERE "+budgetWhere+" AND request_id=$4",
        [...budgetValues(input),input.requestId,excessive?"OVERAGE":"SETTLED",input.chargeMicroUsd,input.responseHash]);
      await client.query("UPDATE axiom_provider_spend_budgets SET charged_micro_usd=charged_micro_usd+$4,reserved_micro_usd=reserved_micro_usd-$5,suspended=CASE WHEN $6 THEN TRUE ELSE suspended END WHERE "+budgetWhere,
        [...budgetValues(input),input.chargeMicroUsd,reserved,excessive]);
      return excessive;
    });
    if(overage)throw new ProviderBudgetError("BUDGET_PROVIDER_OVERAGE","Provider usage overage exceeded reserved spend; spending suspended for reconciliation",502);
  }
}

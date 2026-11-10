import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type { TenantScope } from "./types.ts";
import type { ProviderReservation, ProviderSettlement, ProviderSpendLedger, ProviderSpendStatus } from "./provider_budget.ts";
import { ProviderBudgetError } from "./provider_budget.ts";
import { pinPoolConnectionOptions } from "./provider_pool_connection_pin.ts";

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
function vendorProvider(value:unknown):"openai"|"anthropic"{
 if(value!=="openai"&&value!=="anthropic")throw new TypeError("billingProvider must be the pinned upstream vendor");
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
// Only a genuine pg Pool using the module-initialized connect method may
// supply central spending authority. Structural connect() fakes must not
// grant a trusted budget decorator the appearance of durable accounting.
const trustedPoolConnect=pg.Pool.prototype.connect;
function trustedPool(pool:unknown):pool is Pool{
  return pool instanceof pg.Pool &&
    Object.getPrototypeOf(pool)===pg.Pool.prototype &&
    Object.hasOwn(pool,"options") &&
    Object.hasOwn(pool,"_clients") &&
    Array.isArray((pool as {_clients:unknown})._clients) &&
    pool.connect===trustedPoolConnect;
}
type Key={tenantId:string;provider:string;modelId:string};
const budgetWhere="tenant_id=$1 AND provider=$2 AND model_id=$3";
const budgetValues=(input:Key)=>[input.tenantId,input.provider,input.modelId];

export class PostgresProviderSpendLedger implements ProviderSpendLedger {
  #authenticBudgetLedger=true;
  // Keep the original operator-approved PG pool unforgeable after construction.
  readonly #pool:Pool;
  readonly #poolOptionsUnchanged:()=>boolean;
  static isAuthenticLedger(value:unknown):value is PostgresProviderSpendLedger {
    return typeof value==="object"&&value!==null&&
      #authenticBudgetLedger in value&&
      (value as PostgresProviderSpendLedger).reserve===trustedPostgresReserve&&
      (value as PostgresProviderSpendLedger).settle===trustedPostgresSettle &&
      (value as PostgresProviderSpendLedger).#poolOptionsUnchanged();
  }
  constructor(pool:Pool){
    if(!trustedPool(pool))throw new TypeError("Trusted, unmodified PostgreSQL Pool is required");
    this.#pool=pool;
    this.#poolOptionsUnchanged=pinPoolConnectionOptions(pool as unknown as {readonly options:object});
  }
  private async tx<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{
    if(!trustedPool(this.#pool)||!this.#poolOptionsUnchanged())throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE","Trusted PostgreSQL accounting pool is unavailable",503);
    let client:PoolClient;
    try{client=await this.#pool.connect();}
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
    const q=await client.query("SELECT limit_micro_usd,charged_micro_usd,reserved_micro_usd,suspended,billing_provider FROM axiom_provider_spend_budgets WHERE "+budgetWhere+" FOR UPDATE",budgetValues(key));
    if(q.rowCount!==1)throw new ProviderBudgetError("BUDGET_NOT_PROVISIONED","No tenant provider budget is provisioned",403);
    return q.rows[0];
  }
  private async checkTenantVendor(client:PoolClient,key:Key,v:"openai"|"anthropic"):Promise<void>{
    // Read immutable vendor without taking the tenant row lock first.
    const row=await client.query("SELECT billing_provider FROM axiom_provider_spend_budgets WHERE "+budgetWhere,budgetValues(key));
    if(row.rowCount!==1)throw new ProviderBudgetError("BUDGET_NOT_PROVISIONED","No tenant provider budget is provisioned",403);
    if(row.rows[0].billing_provider!==v)throw new ProviderBudgetError("BUDGET_ORGANIZATION_MISMATCH","Tenant budget vendor does not match billed upstream provider",403);
  }
  private async lockedOrganization(client:PoolClient,v:"openai"|"anthropic"):Promise<any>{
    const r=await client.query("SELECT limit_micro_usd,charged_micro_usd,reserved_micro_usd,suspended FROM axiom_provider_spend_organizations WHERE billing_provider=$1 FOR UPDATE",[v]);
    if(r.rowCount!==1)throw new ProviderBudgetError("BUDGET_ORGANIZATION_NOT_PROVISIONED","No vendor organization cap is provisioned",403);
    return r.rows[0];
  }
  /** Operator-only, immutable vendor organization cap. */
  async provisionOrganization(billingProviderInput:"openai"|"anthropic",limitMicroUsd:number):Promise<void>{
    const v=vendorProvider(billingProviderInput);amount(limitMicroUsd,"organization limitMicroUsd");
    await this.tx(async client=>{
      await client.query("INSERT INTO axiom_provider_spend_organizations(billing_provider,limit_micro_usd) VALUES($1,$2) ON CONFLICT(billing_provider) DO NOTHING",[v,limitMicroUsd]);
      const row=await this.lockedOrganization(client,v);
      if(big(row,"limit_micro_usd")!==limitMicroUsd)throw new ProviderBudgetError("BUDGET_POLICY_IMMUTABLE","Organization cap changes require audited administration",409);
    });
  }
  async organizationStatus(billingProviderInput:"openai"|"anthropic"):Promise<ProviderSpendStatus>{
    const v=vendorProvider(billingProviderInput);
    return this.tx(async client=>{
      const r=await client.query("SELECT limit_micro_usd,charged_micro_usd,reserved_micro_usd FROM axiom_provider_spend_organizations WHERE billing_provider=$1",[v]);
      if(r.rowCount!==1)throw new ProviderBudgetError("BUDGET_ORGANIZATION_NOT_PROVISIONED","No vendor organization cap is provisioned",403);
      return report(r.rows[0]);
    });
  }
  /** Immutable tenant budget and vendor binding; historical NULL vendors must be audited. */
  async provision(scope:TenantScope,provider:string,modelId:string,limitMicroUsd:number,billingProviderInput:"openai"|"anthropic"):Promise<void>{
    const tenantId=id(scope?.tenantId,"tenantId"),v=vendorProvider(billingProviderInput);
    id(provider,"provider");id(modelId,"modelId");amount(limitMicroUsd,"limitMicroUsd");
    await this.tx(async client=>{
      await client.query("INSERT INTO axiom_provider_spend_budgets(tenant_id,provider,model_id,limit_micro_usd,billing_provider) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,provider,model_id) DO NOTHING",[tenantId,provider,modelId,limitMicroUsd,v]);
      const row=await this.lockedBudget(client,{tenantId,provider,modelId});
      if(big(row,"limit_micro_usd")!==limitMicroUsd||row.billing_provider!==v)
        throw new ProviderBudgetError("BUDGET_POLICY_IMMUTABLE","Existing tenant or vendor budget policy differs; audited administration required",409);
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
    const v=vendorProvider(input.billingProvider);
    await this.tx(async client=>{
      // Lock the common vendor row before the tenant row on every writer.
      await this.checkTenantVendor(client,input,v);
      const organization=await this.lockedOrganization(client,v);
      const row=await this.lockedBudget(client,input);
      if(row.billing_provider!==v)throw new ProviderBudgetError("BUDGET_ORGANIZATION_MISMATCH","Tenant vendor binding changed",403);
      if(organization.suspended===true)throw new ProviderBudgetError("BUDGET_ORGANIZATION_SUSPENDED","Vendor spending suspended for reconciliation");
      if(row.suspended===true)throw new ProviderBudgetError("BUDGET_SUSPENDED","Provider spending suspended; reconciliation required");
      const old=await client.query("SELECT request_hash,status FROM axiom_provider_spend_requests WHERE "+budgetWhere+" AND request_id=$4",
        [...budgetValues(input),input.requestId]);
      if(old.rowCount){
        if(old.rows[0].request_hash!==input.requestHash)throw new ProviderBudgetError("BUDGET_IDENTITY_COLLISION","Provider billing identity collision",409);
        const pending=old.rows[0].status==="RESERVED";
        throw new ProviderBudgetError(pending?"BUDGET_PENDING_RECONCILIATION":"BUDGET_ALREADY_SETTLED",
          pending?"Provider request already reserved; reconciliation required":"Provider request already settled; duplicate denied",409);
      }
      if(input.reserveMicroUsd>report(organization).availableMicroUsd)
        throw new ProviderBudgetError("BUDGET_ORGANIZATION_EXCEEDED","Vendor organization spending cap would be exceeded");
      if(input.reserveMicroUsd>report(row).availableMicroUsd)
        throw new ProviderBudgetError("BUDGET_EXCEEDED","Tenant provider spending limit would be exceeded");
      await client.query("INSERT INTO axiom_provider_spend_requests(tenant_id,provider,model_id,request_id,request_hash,reserve_micro_usd,status) VALUES($1,$2,$3,$4,$5,$6,'RESERVED')",
        [input.tenantId,input.provider,input.modelId,input.requestId,input.requestHash,input.reserveMicroUsd]);
      await client.query("UPDATE axiom_provider_spend_budgets SET reserved_micro_usd=reserved_micro_usd+$4 WHERE "+budgetWhere,
        [...budgetValues(input),input.reserveMicroUsd]);
      await client.query("UPDATE axiom_provider_spend_organizations SET reserved_micro_usd=reserved_micro_usd+$2 WHERE billing_provider=$1",[v,input.reserveMicroUsd]);
    });
  }
  async settle(input:ProviderSettlement):Promise<void>{
    context(input);amount(input.chargeMicroUsd,"chargeMicroUsd");sha(input.responseHash,"responseHash");
    const v=vendorProvider(input.billingProvider);
    const overage=await this.tx(async client=>{
      await this.checkTenantVendor(client,input,v);
      const organization=await this.lockedOrganization(client,v);
      const row=await this.lockedBudget(client,input);
      if(row.billing_provider!==v)throw new ProviderBudgetError("BUDGET_ORGANIZATION_MISMATCH","Tenant vendor binding changed",403);
      const old=await client.query("SELECT request_hash,status,reserve_micro_usd FROM axiom_provider_spend_requests WHERE "+budgetWhere+" AND request_id=$4 FOR UPDATE",
        [...budgetValues(input),input.requestId]);
      if(old.rowCount!==1||old.rows[0].request_hash!==input.requestHash||old.rows[0].status!=="RESERVED")
        throw new ProviderBudgetError("BUDGET_SETTLEMENT_FORBIDDEN","No matching unsettled billing reservation",409);
      const reserved=big(old.rows[0],"reserve_micro_usd");
      const charged=big(row,"charged_micro_usd"),held=big(row,"reserved_micro_usd");
      const orgCharged=big(organization,"charged_micro_usd"),orgHeld=big(organization,"reserved_micro_usd");
      if(reserved>held||reserved>orgHeld||
        BigInt(charged)+BigInt(input.chargeMicroUsd)>BigInt(Number.MAX_SAFE_INTEGER)||
        BigInt(orgCharged)+BigInt(input.chargeMicroUsd)>BigInt(Number.MAX_SAFE_INTEGER))
        throw new ProviderBudgetError("BUDGET_CORRUPT","Provider or organization spend totals cannot be reconciled",503);
      const excessive=input.chargeMicroUsd>reserved;
      const orgOverage=excessive||BigInt(orgCharged)+BigInt(input.chargeMicroUsd)>BigInt(big(organization,"limit_micro_usd"));
      await client.query("UPDATE axiom_provider_spend_requests SET status=$5,charge_micro_usd=$6,response_hash=$7 WHERE "+budgetWhere+" AND request_id=$4",
        [...budgetValues(input),input.requestId,orgOverage?"OVERAGE":"SETTLED",input.chargeMicroUsd,input.responseHash]);
      await client.query("UPDATE axiom_provider_spend_budgets SET charged_micro_usd=charged_micro_usd+$4,reserved_micro_usd=reserved_micro_usd-$5,suspended=CASE WHEN $6 THEN TRUE ELSE suspended END WHERE "+budgetWhere,
        [...budgetValues(input),input.chargeMicroUsd,reserved,excessive]);
      await client.query("UPDATE axiom_provider_spend_organizations SET charged_micro_usd=charged_micro_usd+$2,reserved_micro_usd=reserved_micro_usd-$3,suspended=CASE WHEN $4 THEN TRUE ELSE suspended END WHERE billing_provider=$1",
        [v,input.chargeMicroUsd,reserved,orgOverage]);
      return orgOverage;
    });
    if(overage)throw new ProviderBudgetError("BUDGET_PROVIDER_OVERAGE","Provider usage overage exceeded reservation or vendor cap; spending suspended for reconciliation",502);
  }

}

 
// Original, module-initialized methods are the accounting authority. Runtime
// modification of the class prototype must not redefine trust.
const trustedPostgresReserve=PostgresProviderSpendLedger.prototype.reserve;
const trustedPostgresSettle=PostgresProviderSpendLedger.prototype.settle;
// Prevent global reassignment of the privilege-bearing ledger trust verifier.
Object.freeze(PostgresProviderSpendLedger);


/**
 * Phase 2.10C draft: application-side SQL-RPC-only reserve and settlement.
 * The runtime database role may EXECUTE ONLY the two operator-approved SQL
 * functions; it must not own, SELECT or mutate accounting tables directly.
 * This is not a production deployment or verification of TLS/Worker topology.
 */
export class ProtectedPostgresProviderSpendLedger implements ProviderSpendLedger {
  #authenticBudgetLedger=true;
  readonly #pool:Pool;
  readonly #poolOptionsUnchanged:()=>boolean;
  static isAuthenticLedger(value:unknown):value is ProtectedPostgresProviderSpendLedger {
    return typeof value==="object"&&value!==null &&
      #authenticBudgetLedger in value&&
      (value as ProtectedPostgresProviderSpendLedger).reserve===trustedProtectedReserve &&
      (value as ProtectedPostgresProviderSpendLedger).settle===trustedProtectedSettle &&
      (value as ProtectedPostgresProviderSpendLedger).#poolOptionsUnchanged();
  }
  constructor(pool:Pool){
    if(!trustedPool(pool))throw new TypeError("Trusted, unmodified PostgreSQL Pool is required");
    this.#pool=pool;
    this.#poolOptionsUnchanged=pinPoolConnectionOptions(pool as unknown as {readonly options:object});
    Object.freeze(this);
  }
  private async execute(which:"reserve"|"settle",parameters:unknown[]):Promise<void>{
    if(!trustedPool(this.#pool)||!this.#poolOptionsUnchanged())throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE",
      "Trusted PostgreSQL accounting pool unavailable",503);
    let client:PoolClient;
    try{client=await this.#pool.connect();}
    catch{throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE","Provider spend store unavailable",503);}
    let active=false;
    try{
      await client.query("BEGIN");active=true;
      await client.query("SET LOCAL statement_timeout = 5000");
      await client.query("SET LOCAL lock_timeout = 4000");
      // Fixed prepared statements; no dynamic SQL identifiers or direct billing DML.
      const sql=which==="reserve"
        ?"SELECT axiom_spend.reserve($1::text,$2::text,$3::text,$4::text,$5::text,$6::bigint,$7::text) AS verdict"
        :"SELECT axiom_spend.settle($1::text,$2::text,$3::text,$4::text,$5::text,$6::bigint,$7::text,$8::text) AS verdict";
      const result=await client.query(sql,parameters);
      const verdict=result.rowCount===1?result.rows[0]?.verdict:null;
      if(typeof verdict!=="string")throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE",
        "Invalid protected spend response",503);
      if(verdict!=="OK"&&verdict!=="BUDGET_PROVIDER_OVERAGE"){
        const denied=new Set([
          "BUDGET_INVALID_REQUEST","BUDGET_NOT_PROVISIONED","BUDGET_ORGANIZATION_MISMATCH",
          "BUDGET_ORGANIZATION_NOT_PROVISIONED","BUDGET_ORGANIZATION_SUSPENDED","BUDGET_SUSPENDED",
          "BUDGET_CORRUPT","BUDGET_IDENTITY_COLLISION","BUDGET_PENDING_RECONCILIATION",
          "BUDGET_ALREADY_SETTLED","BUDGET_ORGANIZATION_EXCEEDED","BUDGET_EXCEEDED",
          "BUDGET_SETTLEMENT_FORBIDDEN"
        ]);
        if(!denied.has(verdict))throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE",
          "Invalid protected spend verdict",503);
        throw new ProviderBudgetError(verdict,"Provider spending denied by protected PostgreSQL policy",
          verdict==="BUDGET_NOT_PROVISIONED"||verdict==="BUDGET_ORGANIZATION_NOT_PROVISIONED"||
          verdict==="BUDGET_ORGANIZATION_MISMATCH"?403:429);
      }
      await client.query("COMMIT");active=false;
      if(verdict==="BUDGET_PROVIDER_OVERAGE")throw new ProviderBudgetError("BUDGET_PROVIDER_OVERAGE",
        "Provider usage overage recorded; spending suspended for reconciliation",502);
    }catch(error){
      if(active){try{await client.query("ROLLBACK");}catch{}}
      if(error instanceof ProviderBudgetError||error instanceof TypeError)throw error;
      throw new ProviderBudgetError("BUDGET_STORE_UNAVAILABLE","Provider spend store unavailable",503);
    }finally{try{client.release();}catch{}}
  }
  async reserve(input:ProviderReservation):Promise<void>{
    context(input);amount(input.reserveMicroUsd,"reserveMicroUsd",true);
    const vendor=vendorProvider(input.billingProvider);
    await this.execute("reserve",[input.tenantId,input.provider,input.modelId,input.requestId,
      input.requestHash,input.reserveMicroUsd,vendor]);
  }
  async settle(input:ProviderSettlement):Promise<void>{
    context(input);amount(input.chargeMicroUsd,"chargeMicroUsd");sha(input.responseHash,"responseHash");
    const vendor=vendorProvider(input.billingProvider);
    await this.execute("settle",[input.tenantId,input.provider,input.modelId,input.requestId,
      input.requestHash,input.chargeMicroUsd,input.responseHash,vendor]);
  }
}
const trustedProtectedReserve=ProtectedPostgresProviderSpendLedger.prototype.reserve;
const trustedProtectedSettle=ProtectedPostgresProviderSpendLedger.prototype.settle;
Object.freeze(ProtectedPostgresProviderSpendLedger.prototype);
// Lock the protected production-only authenticity check as well as its methods.
Object.freeze(ProtectedPostgresProviderSpendLedger);

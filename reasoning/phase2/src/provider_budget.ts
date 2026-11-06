import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "../../phase1/src/canonical.ts";
import type { ModelAdapter, ModelAdapterInput, CapturedModelExchange } from "./model_adapter.ts";
import type { ModelExplanationAdapter, ModelExplanationAdapterInput, CapturedModelExplanationExchange } from "./model_explanation.ts";
import type { ModelAdapterManifest, TenantScope } from "./types.ts";
import { PostgresProviderSpendLedger } from "./provider_budget_postgres.ts";

/** Operational usage and charge records are NOT signed AXIOM proof inputs. */
export interface ProviderTokenPrices {
  inputMicrosPerMillionTokens:number;
  outputMicrosPerMillionTokens:number;
  cacheReadMicrosPerMillionTokens:number;
  cacheWriteMicrosPerMillionTokens:number;
}
export interface ProviderSpendStatus {
  limitMicroUsd:number;chargedMicroUsd:number;reservedMicroUsd:number;availableMicroUsd:number;
}
export interface ProviderReservation {
  tenantId:string;provider:string;modelId:string;requestId:string;requestHash:string;reserveMicroUsd:number;billingProvider?:"openai"|"anthropic";
}
export interface ProviderSettlement {
  tenantId:string;provider:string;modelId:string;requestId:string;requestHash:string;chargeMicroUsd:number;responseHash:string;billingProvider?:"openai"|"anthropic";
}
export interface ProviderSpendLedger {
  reserve(input:ProviderReservation):void|Promise<void>;
  settle(input:ProviderSettlement):void|Promise<void>;
}
export class ProviderBudgetError extends Error {
  readonly code:string;readonly httpStatus:number;
  constructor(code:string,message:string,httpStatus=429){
    super(message);this.name="ProviderBudgetError";this.code=code;this.httpStatus=httpStatus;
  }
}
function named(value:unknown,label:string):string{
  if(typeof value!=="string"||!value.trim()||value.length>256)throw new TypeError(label+" must be a non-empty bounded string");
  return value;
}
function money(value:unknown,label:string,positive=false):number{
  if(!Number.isSafeInteger(value)||Number(value)<(positive?1:0))throw new TypeError(label+" must be a non-negative safe integer micro-USD amount");
  return Number(value);
}
function token(value:unknown,label:string):number{
  if(!Number.isSafeInteger(value)||Number(value)<0)throw new ProviderBudgetError("BUDGET_USAGE_UNVERIFIABLE",label+" is not valid provider token usage",502);
  return Number(value);
}
function validateRequest(input:ProviderReservation|ProviderSettlement):void{
  named(input.tenantId,"tenantId");named(input.provider,"provider");named(input.modelId,"modelId");named(input.requestId,"requestId");
  if(!/^[0-9a-f]{64}$/.test(input.requestHash))throw new TypeError("requestHash must be a SHA-256 digest");
}
function sha(value:string):string{return sha256Hex(Buffer.from(value,"utf8"));}

export class SqliteProviderSpendLedger implements ProviderSpendLedger {
  #authenticBudgetLedger=true;
  private readonly db:DatabaseSync;
  static isAuthenticLedger(value:unknown):value is SqliteProviderSpendLedger {
    return typeof value==="object"&&value!==null&&
      #authenticBudgetLedger in value&&
      (value as SqliteProviderSpendLedger).reserve===trustedSqliteReserve&&
      (value as SqliteProviderSpendLedger).settle===trustedSqliteSettle;
  }
  constructor(databasePath:string){
    this.db=new DatabaseSync(named(databasePath,"databasePath"));
    this.db.exec([
      "PRAGMA busy_timeout=5000;",
      "PRAGMA journal_mode=WAL;",
      "CREATE TABLE IF NOT EXISTS axiom_provider_spend_budgets(",
      "tenant_id TEXT NOT NULL,provider TEXT NOT NULL,model_id TEXT NOT NULL,",
      "limit_micro_usd INTEGER NOT NULL CHECK(limit_micro_usd>=0),",
      "charged_micro_usd INTEGER NOT NULL DEFAULT 0,reserved_micro_usd INTEGER NOT NULL DEFAULT 0,",
      "suspended INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,provider,model_id));",
      "CREATE TABLE IF NOT EXISTS axiom_provider_spend_requests(",
      "tenant_id TEXT NOT NULL,provider TEXT NOT NULL,model_id TEXT NOT NULL,",
      "request_id TEXT NOT NULL,request_hash TEXT NOT NULL,reserve_micro_usd INTEGER NOT NULL,",
      "status TEXT NOT NULL CHECK(status IN ('RESERVED','SETTLED','OVERAGE')),",
      "charge_micro_usd INTEGER,response_hash TEXT,",
      "PRIMARY KEY(tenant_id,provider,model_id,request_id));"
    ].join("\n"));
  }
  close():void{this.db.close();}
  private transaction<T>(run:()=>T):T{
    this.db.exec("BEGIN IMMEDIATE");
    try{const result=run();this.db.exec("COMMIT");return result;}
    catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }
  /** Trusted operator-only provisioning. Never expose directly to tenants. */
  provision(scope:TenantScope,provider:string,modelId:string,limitMicroUsd:number):void{
    const tenantId=named(scope?.tenantId,"tenantId");
    named(provider,"provider");named(modelId,"modelId");money(limitMicroUsd,"limitMicroUsd");
    this.transaction(()=>{
      this.db.prepare("INSERT OR IGNORE INTO axiom_provider_spend_budgets(tenant_id,provider,model_id,limit_micro_usd) VALUES (?,?,?,?)")
        .run(tenantId,provider,modelId,limitMicroUsd);
      const row=this.db.prepare("SELECT limit_micro_usd AS limitValue FROM axiom_provider_spend_budgets WHERE tenant_id=? AND provider=? AND model_id=?")
        .get(tenantId,provider,modelId) as any;
      if(Number(row.limitValue)!==limitMicroUsd)throw new ProviderBudgetError("BUDGET_POLICY_IMMUTABLE","Existing spending budget differs; audited administration is required",409);
    });
  }
  status(scope:TenantScope,provider:string,modelId:string):ProviderSpendStatus{
    const tenantId=named(scope?.tenantId,"tenantId");named(provider,"provider");named(modelId,"modelId");
    const row=this.db.prepare("SELECT limit_micro_usd AS maximum,charged_micro_usd AS charged,reserved_micro_usd AS reserved FROM axiom_provider_spend_budgets WHERE tenant_id=? AND provider=? AND model_id=?")
      .get(tenantId,provider,modelId) as any;
    if(!row)throw new ProviderBudgetError("BUDGET_NOT_PROVISIONED","No tenant provider budget is provisioned",403);
    const limitMicroUsd=Number(row.maximum),chargedMicroUsd=Number(row.charged),reservedMicroUsd=Number(row.reserved);
    return {limitMicroUsd,chargedMicroUsd,reservedMicroUsd,availableMicroUsd:Math.max(0,limitMicroUsd-chargedMicroUsd-reservedMicroUsd)};
  }
  reserve(input:ProviderReservation):void{
    validateRequest(input);money(input.reserveMicroUsd,"reserveMicroUsd",true);
    this.transaction(()=>{
      const row=this.db.prepare("SELECT limit_micro_usd AS maximum,charged_micro_usd AS charged,reserved_micro_usd AS reserved,suspended FROM axiom_provider_spend_budgets WHERE tenant_id=? AND provider=? AND model_id=?")
        .get(input.tenantId,input.provider,input.modelId) as any;
      if(!row)throw new ProviderBudgetError("BUDGET_NOT_PROVISIONED","No tenant provider budget is provisioned",403);
      if(row.suspended)throw new ProviderBudgetError("BUDGET_SUSPENDED","Provider spending suspended after overage; reconciliation required");
      const old=this.db.prepare("SELECT request_hash AS hash,status FROM axiom_provider_spend_requests WHERE tenant_id=? AND provider=? AND model_id=? AND request_id=?")
        .get(input.tenantId,input.provider,input.modelId,input.requestId) as any;
      if(old){
        if(old.hash!==input.requestHash)throw new ProviderBudgetError("BUDGET_IDENTITY_COLLISION","Provider request identity collision",409);
        throw new ProviderBudgetError(old.status==="RESERVED"?"BUDGET_PENDING_RECONCILIATION":"BUDGET_ALREADY_SETTLED",
          old.status==="RESERVED"?"Provider request already reserved; reconciliation required":"Provider request already settled; duplicate provider call denied",409);
      }
      if(!Number.isSafeInteger(Number(row.charged)+Number(row.reserved)+input.reserveMicroUsd)||
        Number(row.charged)+Number(row.reserved)+input.reserveMicroUsd>Number(row.maximum)){
        throw new ProviderBudgetError("BUDGET_EXCEEDED","Tenant provider spending limit would be exceeded");
      }
      this.db.prepare("INSERT INTO axiom_provider_spend_requests(tenant_id,provider,model_id,request_id,request_hash,reserve_micro_usd,status) VALUES (?,?,?,?,?,?,'RESERVED')")
        .run(input.tenantId,input.provider,input.modelId,input.requestId,input.requestHash,input.reserveMicroUsd);
      this.db.prepare("UPDATE axiom_provider_spend_budgets SET reserved_micro_usd=reserved_micro_usd+? WHERE tenant_id=? AND provider=? AND model_id=?")
        .run(input.reserveMicroUsd,input.tenantId,input.provider,input.modelId);
    });
  }
  settle(input:ProviderSettlement):void{
    validateRequest(input);money(input.chargeMicroUsd,"chargeMicroUsd");
    if(!/^[0-9a-f]{64}$/.test(input.responseHash))throw new TypeError("responseHash must be SHA-256");
    const overage=this.transaction(()=>{
      const old=this.db.prepare("SELECT request_hash AS hash,reserve_micro_usd AS reserved,status FROM axiom_provider_spend_requests WHERE tenant_id=? AND provider=? AND model_id=? AND request_id=?")
        .get(input.tenantId,input.provider,input.modelId,input.requestId) as any;
      if(!old||old.hash!==input.requestHash||old.status!=="RESERVED")
        throw new ProviderBudgetError("BUDGET_SETTLEMENT_FORBIDDEN","No matching unsettled reservation",409);
      // SQLite integer arithmetic can exceed JavaScript's exact integer precision.
      // Refuse unsafe aggregate billing before touching either durable row.
      const budget=this.db.prepare("SELECT charged_micro_usd AS charged,reserved_micro_usd AS held FROM axiom_provider_spend_budgets WHERE tenant_id=? AND provider=? AND model_id=?")
        .get(input.tenantId,input.provider,input.modelId) as any;
      const charged=Number(budget?.charged),held=Number(budget?.held),reserved=Number(old.reserved);
      if(!budget||!Number.isSafeInteger(charged)||charged<0||
        !Number.isSafeInteger(held)||held<0||
        !Number.isSafeInteger(reserved)||reserved<=0||reserved>held||
        charged>Number.MAX_SAFE_INTEGER-input.chargeMicroUsd){
        throw new ProviderBudgetError("BUDGET_CORRUPT",
          "Provider spend totals cannot be reconciled without loss of integer precision",503);
      }
      const excessive=input.chargeMicroUsd>reserved;
      this.db.prepare("UPDATE axiom_provider_spend_requests SET status=?,charge_micro_usd=?,response_hash=? WHERE tenant_id=? AND provider=? AND model_id=? AND request_id=?")
        .run(excessive?"OVERAGE":"SETTLED",input.chargeMicroUsd,input.responseHash,input.tenantId,input.provider,input.modelId,input.requestId);
      this.db.prepare("UPDATE axiom_provider_spend_budgets SET charged_micro_usd=charged_micro_usd+?,reserved_micro_usd=reserved_micro_usd-?,suspended=CASE WHEN ? THEN 1 ELSE suspended END WHERE tenant_id=? AND provider=? AND model_id=?")
        .run(input.chargeMicroUsd,old.reserved,excessive?1:0,input.tenantId,input.provider,input.modelId);
      return excessive;
    });
    if(overage)throw new ProviderBudgetError("BUDGET_PROVIDER_OVERAGE","Provider usage overage exceeded reserved spend; spending suspended for reconciliation",502);
  }
}
// Pin the genuine methods once at module initialization: looking up the
// mutable prototype at validation time would bless a later global patch.
const trustedSqliteReserve=SqliteProviderSpendLedger.prototype.reserve;
const trustedSqliteSettle=SqliteProviderSpendLedger.prototype.settle;
function checkedPrices(value:ProviderTokenPrices):ProviderTokenPrices{
  if(!value||typeof value!=="object")throw new TypeError("Explicit vendor model price configuration is required");
  return {
    inputMicrosPerMillionTokens:money(value.inputMicrosPerMillionTokens,"input price"),
    outputMicrosPerMillionTokens:money(value.outputMicrosPerMillionTokens,"output price"),
    cacheReadMicrosPerMillionTokens:money(value.cacheReadMicrosPerMillionTokens,"cache-read price"),
    cacheWriteMicrosPerMillionTokens:money(value.cacheWriteMicrosPerMillionTokens,"cache-write price")
  };
}
/** Compute billable micro-USD using exact provider token classes and operator-pinned rates. */
export function pricedProviderUsage(responseBody:string,provider:"openai"|"anthropic",prices:ProviderTokenPrices):number{
  const rates=checkedPrices(prices);
  let parsed:any;
  try{parsed=JSON.parse(responseBody);}catch{
    throw new ProviderBudgetError("BUDGET_USAGE_UNVERIFIABLE","Provider returned invalid usage JSON",502);
  }
  const u=parsed?.usage;
  if(!u||typeof u!=="object"||Array.isArray(u))
    throw new ProviderBudgetError("BUDGET_USAGE_UNVERIFIABLE","Provider did not report verifiable token usage",502);
  let input=0,output=0,read=0,write=0;
  if(provider==="openai"){
    const all=token(u.input_tokens,"input_tokens");
    output=token(u.output_tokens,"output_tokens");
    if(token(u.total_tokens,"total_tokens")!==all+output)
      throw new ProviderBudgetError("BUDGET_USAGE_UNVERIFIABLE","OpenAI token totals do not match",502);
    read=u.input_tokens_details?.cached_tokens===undefined?0:token(u.input_tokens_details.cached_tokens,"cached_tokens");
    if(read>all)throw new ProviderBudgetError("BUDGET_USAGE_UNVERIFIABLE","OpenAI cached tokens exceed input tokens",502);
    input=all-read;
  }else if(provider==="anthropic"){
    input=token(u.input_tokens,"input_tokens");
    output=token(u.output_tokens,"output_tokens");
    read=u.cache_read_input_tokens===undefined?0:token(u.cache_read_input_tokens,"cache_read_input_tokens");
    write=u.cache_creation_input_tokens===undefined?0:token(u.cache_creation_input_tokens,"cache_creation_input_tokens");
  }else throw new TypeError("Only pinned OpenAI/Anthropic usage is supported");
  const weighted=BigInt(input)*BigInt(rates.inputMicrosPerMillionTokens)+BigInt(output)*BigInt(rates.outputMicrosPerMillionTokens)
    +BigInt(read)*BigInt(rates.cacheReadMicrosPerMillionTokens)+BigInt(write)*BigInt(rates.cacheWriteMicrosPerMillionTokens);
  const billed=(weighted+999999n)/1000000n;
  if(billed>BigInt(Number.MAX_SAFE_INTEGER))throw new ProviderBudgetError("BUDGET_USAGE_UNVERIFIABLE","Provider billing overflow",502);
  return Number(billed);
}

// Membership is recorded only by the trusted budget decorator constructor.
// Caller-supplied manifest flags cannot impersonate budget enforcement.
const trustedMeteredAdapters=new WeakMap<object,{tenantId:string;adapterId:string;modelId:string;provider:string}>();

/** Reject unmetered first-party paid model adapters at trusted service registration. */
export function requireMeteredProviderAdapter(adapter:{manifest:ModelAdapterManifest},tenantId?:string):void{
  const manifest=adapter?.manifest;
  if(manifest?.provider!=="openai"&&manifest?.provider!=="anthropic")return;
  const registration=trustedMeteredAdapters.get(adapter);
  if(!registration||
    registration.adapterId!==manifest.adapterId||
    registration.modelId!==manifest.modelId||
    registration.provider!==manifest.provider){
    throw new ProviderBudgetError("BUDGET_ENFORCEMENT_REQUIRED",
      "Paid model provider requires a trusted metered budget adapter",403);
  }
  if(tenantId!==undefined&&registration.tenantId!==tenantId){
    throw new ProviderBudgetError("BUDGET_TENANT_MISMATCH",
      "Model explanation provider budget tenant mismatch",403);
  }
}

/** Register this decorator as BOTH compile and explain provider; do not register raw adapters. */
export class BudgetedModelProviderAdapter implements ModelAdapter,ModelExplanationAdapter {
  readonly manifest:ModelAdapterManifest;
  private readonly provider:"openai"|"anthropic";
  private readonly tenantId:string;
  private readonly prices:ProviderTokenPrices;
  private readonly requestReserveMicroUsd:number;
  private readonly adapter:ModelAdapter&ModelExplanationAdapter;
  private readonly ledger:ProviderSpendLedger;
  constructor(config:{
    adapter:ModelAdapter&ModelExplanationAdapter;ledger:ProviderSpendLedger;tenantId:string;
    prices:ProviderTokenPrices;requestReserveMicroUsd:number;
  }){
    if(!config.adapter||typeof config.adapter.invoke!=="function"||typeof config.adapter.explain!=="function")
      throw new TypeError("Provider compile and explain adapter is required");
    if(config.adapter.manifest.provider!=="openai"&&config.adapter.manifest.provider!=="anthropic")
      throw new TypeError("Unsupported budgeted provider");
    // Never accept structural duck-typing for the accounting authority:
    // an arbitrary reserve/settle object could silently do nothing.
    if(!SqliteProviderSpendLedger.isAuthenticLedger(config.ledger) &&
       !PostgresProviderSpendLedger.isAuthenticLedger(config.ledger))
      throw new TypeError("Trusted, unmodified SQLite or PostgreSQL budget ledger is required");
    this.adapter=config.adapter;this.manifest=config.adapter.manifest;
    this.provider=config.adapter.manifest.provider;this.tenantId=named(config.tenantId,"tenantId");
    this.prices=checkedPrices(config.prices);
    this.requestReserveMicroUsd=money(config.requestReserveMicroUsd,"requestReserveMicroUsd",true);
    this.ledger=config.ledger;
    trustedMeteredAdapters.set(this,{
      tenantId:this.tenantId,adapterId:this.manifest.adapterId,
      modelId:this.manifest.modelId,provider:this.provider
    });
  }
  private assertUntamperedLedger():void{
    // Registration-only verification is insufficient: callers may still retain
    // a mutable ledger reference and replace reserve/settle after construction.
    if(!SqliteProviderSpendLedger.isAuthenticLedger(this.ledger)&&
       !PostgresProviderSpendLedger.isAuthenticLedger(this.ledger))
      throw new ProviderBudgetError("BUDGET_ACCOUNTING_TAMPERED",
        "Trusted provider ledger accounting methods changed; provider call denied",503);
  }
  private async metered<T extends {responseBody:string}>(intent:string,run:()=>Promise<T>):Promise<T>{
    const requestHash=sha(intent),requestId=requestHash;
    const identity={tenantId:this.tenantId,provider:this.manifest.adapterId,modelId:this.manifest.modelId,billingProvider:this.provider,requestId,requestHash};
    this.assertUntamperedLedger();
    await this.ledger.reserve({...identity,reserveMicroUsd:this.requestReserveMicroUsd});
    // A patched ledger after reservation must never authorize a vendor call.
    this.assertUntamperedLedger();
    // Ambiguous errors deliberately leave a durable reservation: never auto-refetch.
    const result=await run();
    const chargeMicroUsd=pricedProviderUsage(result.responseBody,this.provider,this.prices);
    // A patched settlement hook cannot turn billable usage into a successful call.
    this.assertUntamperedLedger();
    await this.ledger.settle({...identity,chargeMicroUsd,responseHash:sha(result.responseBody)});
    return result;
  }
  async invoke(input:ModelAdapterInput):Promise<CapturedModelExchange>{
    if(input?.tenant?.tenantId!==this.tenantId)throw new ProviderBudgetError("BUDGET_TENANT_MISMATCH","Provider budget tenant mismatch",403);
    const hash=named(input.compilationRequestHash,"compilationRequestHash");
    if(!/^[0-9a-f]{64}$/.test(hash)||!Number.isSafeInteger(input.attempt)||input.attempt<0)
      throw new TypeError("Valid immutable compilation intent is required");
    if(input.mode!=="INITIAL"&&input.mode!=="REPAIR")throw new TypeError("Compilation mode is required");
    return this.metered(JSON.stringify({type:"compile",tenantId:this.tenantId,adapterId:this.manifest.adapterId,
      modelId:this.manifest.modelId,compilationRequestHash:hash,attempt:input.attempt,mode:input.mode}),
      ()=>this.adapter.invoke(input));
  }
  async explain(input:ModelExplanationAdapterInput):Promise<CapturedModelExplanationExchange>{
    if(typeof input?.promptBody!=="string"||!input.promptBody.trim())throw new TypeError("promptBody is required");
    const capturedAt=named(input?.capturedAt,"capturedAt");
    if(!Number.isSafeInteger(input?.maxResponseBytes)||input.maxResponseBytes<=0)throw new TypeError("maxResponseBytes must be positive");
    return this.metered(JSON.stringify({type:"explain",tenantId:this.tenantId,adapterId:this.manifest.adapterId,
      modelId:this.manifest.modelId,promptHash:sha(input.promptBody),capturedAt,maxResponseBytes:input.maxResponseBytes}),
      ()=>this.adapter.explain(input));
  }
}

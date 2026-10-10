import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { AuthenticatedPrincipal } from "./types.ts";

export interface JwtTrustStore {
  trustedPublicKeyPem(issuer:string,keyId:string):string|undefined;
}

export interface CallerAuthenticator {
  authenticate(bearerToken:string,now:string):Promise<AuthenticatedPrincipal>;
}

function publicPem(key:string|KeyObject):string {
  const publicKey=typeof key==="string"?createPublicKey(key):(key.type==="public"?key:createPublicKey(key));
  if(publicKey.asymmetricKeyType!=="ed25519")throw new TypeError("JWT trust keys must be Ed25519 public keys");
  return publicKey.export({type:"spki",format:"pem"}).toString();
}

export function createJwtTrustStore(keys:Record<string,Record<string,string|KeyObject>>):JwtTrustStore {
  const trusted=new Map<string,Map<string,string>>();
  for(const [issuer,issuerKeys] of Object.entries(keys)){
    if(!issuer.trim())throw new TypeError("JWT issuer is required");
    const byKey=new Map<string,string>();
    for(const [keyId,key] of Object.entries(issuerKeys)){
      if(!keyId.trim())throw new TypeError("JWT keyId is required");
      byKey.set(keyId,publicPem(key));
    }
    trusted.set(issuer,byKey);
  }
  return {trustedPublicKeyPem:(issuer,keyId)=>trusted.get(issuer)?.get(keyId)};
}

function positiveDuration(value:number,label:string,allowZero=false):number {
  if(!Number.isFinite(value)||(allowZero?value<0:value<=0))throw new RangeError(`${label} must be ${allowZero?"non-negative":"positive"}`);
  return value;
}

function nonEmptyString(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new Error(`Caller credential rejected: ${label} must be a non-empty string`);
  return value;
}

function numericDate(value:unknown,label:string):number {
  if(typeof value!=="number"||!Number.isFinite(value)||!Number.isInteger(value))throw new Error(`Caller credential rejected: ${label} must be a NumericDate integer`);
  return value;
}

function nowDate(value:string):Date {
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))throw new TypeError("authentication now must be an ISO-8601 timestamp");
  return new Date(ms);
}

export class Ed25519JwtAuthenticator implements CallerAuthenticator {
  private readonly trustStore:JwtTrustStore;
  private readonly audience:string;
  private readonly maxTokenAgeMs:number;
  private readonly maxTokenLifetimeMs:number;
  private readonly maxClockSkewMs:number;

  constructor(deps:{
    trustStore:JwtTrustStore;
    audience:string;
    maxTokenAgeMs:number;
    maxTokenLifetimeMs:number;
    maxClockSkewMs:number;
  }){
    if(!deps.audience?.trim())throw new TypeError("JWT audience is required");
    this.trustStore=deps.trustStore;
    this.audience=deps.audience;
    this.maxTokenAgeMs=positiveDuration(deps.maxTokenAgeMs,"maxTokenAgeMs");
    this.maxTokenLifetimeMs=positiveDuration(deps.maxTokenLifetimeMs,"maxTokenLifetimeMs");
    this.maxClockSkewMs=positiveDuration(deps.maxClockSkewMs,"maxClockSkewMs",true);
  }

  async authenticate(bearerToken:string,now:string):Promise<AuthenticatedPrincipal> {
    if(typeof bearerToken!=="string"||!bearerToken.trim())throw new Error("Caller credential rejected: bearer token is required");
    const currentDate=nowDate(now);

    let unverifiedIssuer:string;
    let keyId:string;
    try{
      const header=decodeProtectedHeader(bearerToken);
      if(header.alg!=="EdDSA")throw new Error("alg must be EdDSA");
      if(header.typ!=="at+jwt")throw new Error("typ must be at+jwt");
      keyId=nonEmptyString(header.kid,"kid");
      unverifiedIssuer=nonEmptyString(decodeJwt(bearerToken).iss,"iss");
    }catch(err){
      throw new Error(`Caller credential rejected: ${err instanceof Error?err.message:"malformed JWT"}`);
    }

    const pem=this.trustStore.trustedPublicKeyPem(unverifiedIssuer,keyId);
    if(!pem)throw new Error("Caller credential rejected: no trusted issuer/key");

    try{
      const verificationKey=await importSPKI(pem,"EdDSA");
      const {payload,protectedHeader}=await jwtVerify(bearerToken,verificationKey,{
        algorithms:["EdDSA"],
        typ:"at+jwt",
        issuer:unverifiedIssuer,
        audience:this.audience,
        currentDate,
        clockTolerance:this.maxClockSkewMs/1000,
        maxTokenAge:this.maxTokenAgeMs/1000,
        requiredClaims:["sub","jti","exp"]
      });

      if(protectedHeader.alg!=="EdDSA"||protectedHeader.typ!=="at+jwt"||protectedHeader.kid!==keyId){
        throw new Error("verified protected header does not match authentication profile");
      }
      const issuer=nonEmptyString(payload.iss,"iss");
      const subject=nonEmptyString(payload.sub,"sub");
      const jwtId=nonEmptyString(payload.jti,"jti");
      const issued=numericDate(payload.iat,"iat");
      const expires=numericDate(payload.exp,"exp");
      if(expires<=issued)throw new Error("Caller credential rejected: exp must be after iat");
      if((expires-issued)*1000>this.maxTokenLifetimeMs)throw new Error("Caller credential rejected: token lifetime exceeds configured maximum");

      return {
        principal:{
          principalId:`principal:${hashJson({issuer,subject} as any)}`,
          issuer,
          subject
        },
        credential:{
          issuer,
          subject,
          keyId,
          jwtId,
          issuedAt:new Date(issued*1000).toISOString(),
          expiresAt:new Date(expires*1000).toISOString(),
          tokenHash:createHash("sha256").update(bearerToken,"utf8").digest("hex")
        }
      };
    }catch(err){
      if(err instanceof Error&&err.message.startsWith("Caller credential rejected:"))throw err;
      throw new Error(`Caller credential rejected: ${err instanceof Error?err.message:"JWT verification failed"}`);
    }
  }
}

import { createPublicKey, type KeyObject } from "node:crypto";
import type { ExecutionResult } from "../../phase1/src/types.ts";
import {
  issueCertificate, type ReasoningCertificate, type Signer
} from "../../phase1/src/certificate.ts";
import type { AxiomProgram } from "../../phase1/src/types.ts";

export interface SignerProvider {
  readonly keyId:string;
  issue(program:AxiomProgram,execution:ExecutionResult,issuedAt:string):ReasoningCertificate;
  trustedPublicKeyPem(keyId?:string):string|undefined;
}

function publicPem(key:string|KeyObject):string {
  const publicKey=typeof key==="string"?createPublicKey(key):(key.type==="public"?key:createPublicKey(key));
  return publicKey.export({type:"spki",format:"pem"}).toString();
}

export function createStaticSignerProvider(keyId:string,signer:Signer):SignerProvider {
  return createKeyringSignerProvider(keyId,signer,{[keyId]:signer.publicKey});
}

export function createKeyringSignerProvider(
  activeKeyId:string,
  activeSigner:Signer,
  trustedKeys:Record<string,string|KeyObject>
):SignerProvider {
  if(!activeKeyId.trim())throw new TypeError("active signer keyId is required");
  const trusted=new Map<string,string>();
  for(const [keyId,key] of Object.entries(trustedKeys)){
    if(!keyId.trim())throw new TypeError("trusted signer keyId is required");
    trusted.set(keyId,publicPem(key));
  }
  const activePem=publicPem(activeSigner.publicKey);
  const declaredActive=trusted.get(activeKeyId);
  if(declaredActive!==undefined && declaredActive!==activePem)throw new Error(`Trusted key ${activeKeyId} does not match the active signer`);
  trusted.set(activeKeyId,activePem);

  return {
    keyId:activeKeyId,
    issue:(program,execution,issuedAt)=>issueCertificate(program,execution,activeSigner,issuedAt),
    trustedPublicKeyPem:(requested=activeKeyId)=>trusted.get(requested)
  };
}

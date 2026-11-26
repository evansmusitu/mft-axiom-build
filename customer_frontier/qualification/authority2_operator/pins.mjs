// Disposable qualification identity approved by the owner; never production.
export const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
export const SOURCE_ACCOUNT='93f395f5121954671f92fffa453d6b61';
export const SCRIPT='axiom-security-authority2-highwater';
export const BUCKET='musitu-axiom-b27-highwater-a2';
export const APPROVED_SOURCE='68799a41a367865649b833de649edcb26f77c0d3';
export const APPROVED_CONFIG_SHA='bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3';
export const SPKI_SHA='6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a';
export const SERVING_SHA='d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210';
export const INITIALIZER_SHA='ec884e4117e3ba392c59ae33b029722cb23bba03889a6dd23facd52a9a5aa3c4';
export const REPO='evansmusitu/mft-axiom-build';
export const CHECKPOINT_REPO='evansmusitu/mft-axiom-qualification-isolated-20260913';
export const CHECKPOINT_ID=1368351153;
export const PIN=Object.freeze({account_id:ACCOUNT,ledger_id:'axiom-b27-a2-qualification-20261116-6792c82b245cd450',namespace:'ax-a2-qualification-20261116-6792c82b245cd450',key_id:'a2-ed25519-6792c82b245cd450',public_key_jwk:{kty:'OKP',crv:'Ed25519',x:'9G3Dzw62h9a094zdQFLO5AfoI637Su8Y9mMT-k0ynrs'}});
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export class OperatorHold extends Error{constructor(code){super(code);this.code=code;}}
export function need(ok,code){if(!ok)throw new OperatorHold(code);}
export const HEX64=/^[a-f0-9]{64}$/;

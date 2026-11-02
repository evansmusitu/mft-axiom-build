export const ROLE_PERMISSIONS=Object.freeze({owner:['org.manage','domain.manage','workspace.manage','member.manage','policy.manage','audit.read','analysis.execute','analysis.read'],admin:['domain.manage','workspace.manage','member.manage','policy.manage','audit.read','analysis.execute','analysis.read'],analyst:['analysis.execute','analysis.read'],viewer:['analysis.read']});
export const NETWORK_POLICY='DENY_ALL_EXTERNAL_NETWORK';
export const CONTROL_PLANE_MODE='BROWSER_LOCAL_ADMIN_PREVIEW_ONLY_NO_PRODUCTION_MUTATION';
export const BILLING_POLICY='NO_PAYMENT_PROCESSING_OR_SETTLEMENT';
export const IDENTITY_POLICY='LOCAL_ENTERPRISE_PREVIEW_NOT_PRODUCTION_IDENTITY_PROVIDER';
export const HIDDEN_REASONING_POLICY='NO_HIDDEN_REASONING_OR_SECRET_STORAGE';
const SECRET_RX=/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]/i;
export const clean=(value,limit=240)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,limit);
export function required(value,label,limit=180){const out=clean(value,limit);if(!out)throw new TypeError(`${label} required`);return out;}
export function rejectSecretLike(value,label='value'){const raw=JSON.stringify(value);if(SECRET_RX.test(raw))throw new DOMException(`${label} contains secret-like material`,'SecurityError');}
export function role(value){const out=clean(value,32).toLowerCase();if(!Object.hasOwn(ROLE_PERMISSIONS,out))throw new TypeError('invalid enterprise role');return out;}
export function can(roleName,permission){return (ROLE_PERMISSIONS[role(roleName)]||[]).includes(permission);}
export function normalizePolicy(raw={}){const failure=Number(raw.failureRateSlo),agents=Number(raw.maxActiveAgents),compute=Number(raw.maxLocalComputeUnits);if(!Number.isFinite(failure)||failure<0||failure>1)throw new TypeError('failure-rate SLO must be from 0 to 1');if(!Number.isInteger(agents)||agents<1||agents>1000)throw new TypeError('max active agents must be from 1 to 1000');if(!Number.isInteger(compute)||compute<1||compute>1000000)throw new TypeError('max local compute units must be from 1 to 1000000');if(typeof raw.incidentEscalationRequired!=='boolean')throw new TypeError('incident escalation flag must be boolean');return {failure_rate_slo:failure,max_active_agents:agents,max_local_compute_units:compute,incident_escalation_required:raw.incidentEscalationRequired};}
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
export async function sha256(value){const bytes=new TextEncoder().encode(canonical(value)),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export const uid=prefix=>`${prefix}:${crypto.randomUUID()}`;

import { timingSafeEqual, createHash } from 'node:crypto';
import {TENANTS} from './core.js';
export class AuthenticationError extends Error { constructor(){super('Tenant demo token required or invalid');this.name='AuthenticationError';} }
export function assertStageConfig(env=process.env) {
  if(env.JARVIS_MODE!=='synthetic') throw new Error('Fail closed: JARVIS_MODE must equal synthetic');
  const keys=[env.JARVIS_REALTY_DEMO_KEY,env.JARVIS_HOME_DEMO_KEY];
  if(keys.some(x=>typeof x!=='string'||x.length<32 || /[<>]/.test(x)) || keys[0]===keys[1]) throw new Error('Fail closed: 2 distinct >=32 character preview tokens required');
  if(!env.DATABASE_URL?.startsWith('postgresql://') && !env.DATABASE_URL?.startsWith('postgres://')) throw new Error('Fail closed: PostgreSQL database URL not configured');
  return {'creatix-demo-realty':keys[0], 'creatix-demo-home':keys[1]};
}
export function authenticate(header, config) {
  if(typeof header!=='string' || !/^Bearer [^ ]{32,}$/.test(header)) throw new AuthenticationError();
  const supplied=header.slice(7);
  const digest=createHash('sha256').update(supplied).digest();
  let match=null;
  for(const [tenant,secret] of Object.entries(config)) {
    const expected=createHash('sha256').update(secret).digest();
    if(timingSafeEqual(digest,expected)) match=tenant;
  }
  if(!match || !TENANTS[match]) throw new AuthenticationError();
  return match;
}

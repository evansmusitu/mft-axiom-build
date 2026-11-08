/** Single source of truth for this *pre-production* bootstrap.
 * No environment variable, test flag, or caller parameter enables external actions.
 * A separately audited production release authority MUST replace this design.
 */
export const REAL_ACTIONS_DISABLED=Object.freeze([
  'META_SEND','PAYMENT_CAPTURE','MAIL_SEND','PUBLIC_SIGNUP'
]);
export function allowExternalAction(kind) {
  if(typeof kind!=='string'||!REAL_ACTIONS_DISABLED.includes(kind)) throw new Error('UNKNOWN_EXTERNAL_ACTION');
  throw new Error('ACTION_DISABLED');
}

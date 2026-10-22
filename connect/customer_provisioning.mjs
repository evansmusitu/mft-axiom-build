/**
 * Preparatory synthetic-only customer provisioning seam.
 * Not a public API; not imported by the production Worker.
 */
const disabled=()=>({ok:false,status:503,error:'PROVISIONING_DISABLED'});
export async function provisionOfflineTenant(_args={}) {return disabled();}
export async function issueOfflineCredential(_args={}) {return disabled();}
export async function revokeOfflineCredential(_args={}) {return disabled();}
export async function suspendOfflineTenant(_args={}) {return disabled();}

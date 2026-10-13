/** B22 S0 diagnostic traffic is *loopback only*. Host check is not an identity system. */
export function localOnly(url){
  try {const parsed=new URL(url);return parsed.protocol==='http:' && (parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1');}
  catch {return false;}
}

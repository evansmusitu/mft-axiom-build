// Safe local config diagnostic for MFA-authenticated owners only.
// Never inspect, fingerprint, or disclose the value of a secret binding.
const PRIVATE_BINDINGS=Object.freeze([
  'MODAL_ORIGIN','MODAL_PROXY_KEY','MODAL_PROXY_SECRET','EDGE_SHARED_SECRET',
  'AGENT_ID','AGENT_TENANT','AGENT_HMAC_KEY'
]);
export function backendBindingReadiness(env){
  const present=(name)=>typeof env?.[name]==='string'&&env[name].trim().length>0;
  const missing_bindings=PRIVATE_BINDINGS.filter(name=>!present(name));
  return {
    schema:'lifeline.owner_backend_bindings.v1',
    configured_bindings:PRIVATE_BINDINGS.length-missing_bindings.length,
    required_bindings:PRIVATE_BINDINGS.length,
    missing_bindings,
    // Presence is not proof of correctness, connectivity, native host, or paid usage.
    production_credentials_verified:false,
    backend_connected:false,
    native_windows_connected:false,
    trading_enabled:false,
  };
}

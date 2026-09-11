import {pathToFileURL} from 'node:url';

const workerPath=process.argv[2]||process.env.WORKER_PATH;
if(!workerPath) throw new Error('worker path required');
const worker=(await import(pathToFileURL(workerPath).href+`?security=${Date.now()}`)).default;
if(!worker||typeof worker.fetch!=='function') throw new Error('worker default.fetch required');

const requiredCsp=[
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "connect-src 'self'",
  "manifest-src 'self'",
  'upgrade-insecure-requests'
];
const routes=['/store','/store/apps/chemistry','/store/install','/store/developer','/store/releases','/store/status','/store/offline','/store/healthz'];

for(const route of routes){
  const response=await worker.fetch(new Request(`https://payments.mftintelligence.com${route}`),{STORE_RUNTIME_PUBLICATION_STATE:'production'},{});
  if(response.status!==200) throw new Error(`${route}: HTTP ${response.status}`);
  const csp=response.headers.get('content-security-policy')||'';
  for(const directive of requiredCsp){
    if(!csp.includes(directive)) throw new Error(`${route}: missing CSP directive ${directive}`);
  }
  if(/unsafe-inline|unsafe-eval/.test(csp)) throw new Error(`${route}: unsafe CSP token`);
  const expected={
    'referrer-policy':'no-referrer',
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'cross-origin-opener-policy':'same-origin',
    'x-permitted-cross-domain-policies':'none'
  };
  for(const [name,value] of Object.entries(expected)){
    if((response.headers.get(name)||'')!==value) throw new Error(`${route}: ${name} mismatch`);
  }
  const permissions=response.headers.get('permissions-policy')||'';
  for(const token of ['camera=()','microphone=()','geolocation=()','payment=()','usb=()','bluetooth=()']){
    if(!permissions.includes(token)) throw new Error(`${route}: permissions-policy missing ${token}`);
  }
}

console.log('MUSITU_STORE_PHASE2_SECURITY_HARDENING_RUNTIME_PASS');

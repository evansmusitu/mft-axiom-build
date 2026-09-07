from pathlib import Path
import hashlib,re

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'index.storefront-v3.mjs'

s=OUT.read_text()

def once(text,old,new,label):
    n=text.count(old)
    if n!=1:
        raise SystemExit(f'{label} marker mismatch: {n}')
    return text.replace(old,new,1)

def once_in_section(text,start,end,old,new,label):
    if text.count(start)!=1:
        raise SystemExit(f'{label} section-start mismatch: {text.count(start)}')
    i=text.index(start)+len(start)
    j=text.find(end,i)
    if j<0:
        raise SystemExit(f'{label} section-end mismatch: 0')
    section=text[i:j]
    n=section.count(old)
    if n!=1:
        raise SystemExit(f'{label} marker mismatch in section: {n}')
    section=section.replace(old,new,1)
    return text[:i]+section+text[j:]

def module_text(name):
    text=(ROOT/'storefront'/name).read_text()
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    text=text.replace('export async function ','async function ').replace('export const ','const ').replace('export function ','function ')
    return f'// storefront/{name}\n{text.strip()}\n'

render_start='// storefront/render.mjs\n'
render_end='// storefront/field-experience.mjs\n'
s=once_in_section(s,render_start,render_end,'<a href="/chemistry/releases">Release notes</a><a href="/chemistry/experience">Experience evidence</a><a href="/chemistry/security.txt">Security</a>','<a href="/chemistry/rescue">Chemistry Rescue</a><a href="/chemistry/install">Install</a><a href="/chemistry/releases">Release notes</a><a href="/chemistry/experience">Experience evidence</a><a href="/chemistry/security.txt">Security</a>','Rescue global footer')
s=once_in_section(s,render_start,render_end,"'/chemistry/experience'];","'/chemistry/experience','/chemistry/rescue','/chemistry/install','/chemistry/rescue/teachers','/chemistry/rescue/schools','/chemistry/rescue/ambassadors'];",'Rescue sitemap')

insert=(module_text('rescue-growth.mjs')+module_text('rescue-discovery.mjs')+module_text('rescue-render.mjs')+module_text('app-shell.mjs')+module_text('install.mjs')+module_text('offline-sw-v5.mjs')+module_text('rescue-kits.mjs'))
s=once(s,'// storefront/field-experience.mjs\n',insert+'// storefront/field-experience.mjs\n','Rescue module insertion')

s=once_in_section(s,'// storefront/rescue-discovery.mjs\n','// storefront/rescue-render.mjs\n','\\"start_url\\":\\"/chemistry/rescue?src=direct\\"','\\"id\\":\\"/chemistry/rescue?src=direct\\",\\"start_url\\":\\"/chemistry/app\\"','Installed app manifest launch target')
s=once_in_section(s,'// storefront/rescue-render.mjs\n','// storefront/app-shell.mjs\n','<script src="/chemistry/assets/rescue-install.js" defer></script></head>','<script src="/chemistry/assets/app-bridge.js?v=1"></script><script src="/chemistry/assets/rescue-install.js" defer></script></head>','Standalone Rescue to app bridge')
s=once_in_section(s,'// storefront/rescue-render.mjs\n','// storefront/app-shell.mjs\n','<a class="button" data-field-event="rescue_start" data-field-detail="${rescueEsc(src)}" href="/chemistry/download/${rescueEsc(RELEASE.apk)}">Start Free Rescue Check</a>','<a class="button" data-field-event="rescue_start" data-field-detail="${rescueEsc(src)}" href="/chemistry/install">Install / Start Free</a>','Rescue primary install handoff')

s=once(s,"  event('page_view');\n","  event('page_view');\n  const rescueRoot=q('[data-rescue-source]');\n  if(route()==='rescue'&&rescueRoot)event('rescue_visit',rescueRoot.dataset.rescueSource||'direct');\n",'Rescue visit attribution')
s=once(s,"    el.addEventListener(type,()=>event(name,detail),{passive:true});\n","    el.addEventListener(type,()=>{\n      event(name,detail);\n      if(name==='rescue_start'&&detail==='wa_student')event('rescue_peer_start',detail);\n    },{passive:true});\n",'Rescue peer-start attribution')

privacy_old='<p class="microcopy">If you disable measurement, the browser stores only the local preference needed to remember that choice. It is not a tracking identifier.</p>'
privacy_new='<p class="microcopy">If you disable measurement, the browser stores only the local preference needed to remember that choice. The installed web experience may also store a local yes/no onboarding-complete flag so first-launch guidance is not repeated. Neither value is a tracking identifier.</p>'
s=once(s,privacy_old,privacy_new,'Install local-state privacy disclosure')

s=once(s,'renderPaymentStatus,renderExperience,ingestTelemetryRequest,readFieldSnapshot,computeFieldSnapshot,planViewsFromCore','renderPaymentStatus,renderExperience,renderRescue,renderChemistryApp,renderInstall,renderInstallDiagnostics,renderTeacherKit,renderSchoolKit,renderAmbassadorKit,RESCUE_PRINT_CSS,normalizeGrowthSource,RESCUE_CANONICAL_URL,CHEMISTRY_APP_URL,APP_BRIDGE_JS,APP_SHELL_JS,APP_SHELL_CSS,INSTALL_CANONICAL_URL,INSTALL_DIAGNOSTICS_URL,INSTALL_HANDOFF_JS,INSTALL_DIAGNOSTICS_JS,INSTALL_CONCIERGE_CSS,INSTALL_SW_JS:INSTALL_SW_V5_JS,RESCUE_MANIFEST,RESCUE_INSTALL_JS,RESCUE_ICON_192_B64,RESCUE_ICON_512_B64,rescuePngBytes,ingestTelemetryRequest,readFieldSnapshot,computeFieldSnapshot,planViewsFromCore','STOREFRONT Rescue exports')

s=once(s,"if(req.method==='GET'&&p==='/chemistry/plans')return storefrontHtml(STOREFRONT.renderPlanDecision({plans:STOREFRONT.planViewsFromCore(),query:storefrontQuery(u)}));","if(req.method==='GET'&&p==='/chemistry/app')return storefrontHtml(STOREFRONT.renderChemistryApp({view:u.searchParams.get('view')||'home'}),200,{'cache-control':'no-store'});if(req.method==='GET'&&p==='/chemistry/rescue')return storefrontHtml(STOREFRONT.renderRescue({source:STOREFRONT.normalizeGrowthSource(u.searchParams.get('src')||'')}));if(req.method==='GET'&&p==='/chemistry/install')return storefrontHtml(STOREFRONT.renderInstall({userAgent:req.headers.get('user-agent')||''}),200,{'cache-control':'no-store'});if(req.method==='GET'&&p==='/chemistry/install/diagnostics')return storefrontHtml(STOREFRONT.renderInstallDiagnostics(),200,{'cache-control':'no-store'});if(req.method==='GET'&&p==='/chemistry/rescue/teachers')return storefrontHtml(STOREFRONT.renderTeacherKit());if(req.method==='GET'&&p==='/chemistry/rescue/schools')return storefrontHtml(STOREFRONT.renderSchoolKit());if(req.method==='GET'&&p==='/chemistry/rescue/ambassadors')return storefrontHtml(STOREFRONT.renderAmbassadorKit());if(req.method==='GET'&&p==='/chemistry/plans')return storefrontHtml(STOREFRONT.renderPlanDecision({plans:STOREFRONT.planViewsFromCore(),query:storefrontQuery(u)}));",'Rescue dispatch')

s=once(s,"if(req.method==='GET'&&p==='/chemistry/assets/field-experience.js')return storefrontAsset(STOREFRONT.FIELD_EXPERIENCE_JS,'application/javascript; charset=utf-8');","if(req.method==='GET'&&p==='/chemistry/manifest.webmanifest')return storefrontAsset(STOREFRONT.RESCUE_MANIFEST,'application/manifest+json; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/rescue-install.js')return storefrontAsset(STOREFRONT.RESCUE_INSTALL_JS,'application/javascript; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/app-bridge.js')return storefrontAsset(STOREFRONT.APP_BRIDGE_JS,'application/javascript; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/app-shell.js')return storefrontAsset(STOREFRONT.APP_SHELL_JS,'application/javascript; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/app-shell.css')return storefrontAsset(STOREFRONT.APP_SHELL_CSS,'text/css; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/install-handoff.js')return storefrontAsset(STOREFRONT.INSTALL_HANDOFF_JS,'application/javascript; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/install-diagnostics.js')return storefrontAsset(STOREFRONT.INSTALL_DIAGNOSTICS_JS,'application/javascript; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/install-concierge.css')return storefrontAsset(STOREFRONT.INSTALL_CONCIERGE_CSS,'text/css; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/sw.js')return new Response(STOREFRONT.INSTALL_SW_JS,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-cache, no-store, must-revalidate','service-worker-allowed':'/chemistry/','x-content-type-options':'nosniff'}});if(req.method==='GET'&&p==='/chemistry/assets/musitu-chemistry-192.png')return storefrontAsset(STOREFRONT.rescuePngBytes(STOREFRONT.RESCUE_ICON_192_B64),'image/png');if(req.method==='GET'&&p==='/chemistry/assets/musitu-chemistry-512.png')return storefrontAsset(STOREFRONT.rescuePngBytes(STOREFRONT.RESCUE_ICON_512_B64),'image/png');if(req.method==='GET'&&p==='/chemistry/assets/rescue-print.css')return storefrontAsset(STOREFRONT.RESCUE_PRINT_CSS,'text/css; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/field-experience.js')return storefrontAsset(STOREFRONT.FIELD_EXPERIENCE_JS,'application/javascript; charset=utf-8');",'Rescue discovery app-shell and install asset dispatch')

s=once(s,"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'","default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Browser manifest CSP')

OUT.write_text(s)
print(hashlib.sha256(OUT.read_bytes()).hexdigest())

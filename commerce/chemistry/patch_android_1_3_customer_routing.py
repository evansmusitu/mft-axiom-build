from pathlib import Path
import hashlib

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'index.storefront-v3.mjs'
OLD_SHA='055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d'
NEW_SHA='4ba442122d9c86a0c3cef660334fe337c6ea9ae6fe853c964b5e94961245babd'
OLD_APK='MUSITU_Chemistry_Mastery_1.2.0.apk'
NEW_APK='MUSITU_Chemistry_Mastery_1.3.0.apk'
NEW_URL='/chemistry/download/'+NEW_APK

s=OUT.read_text()

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise SystemExit(f'{label} marker mismatch: {n}')
    s=s.replace(old,new,1)

def exact_count(needle,n,label):
    got=s.count(needle)
    if got!=n:
        raise SystemExit(f'{label} count mismatch: expected {n}, got {got}')

# The generated worker must already be built from the current 1.3.0 release
# source. This patch is deliberately not allowed to hide stale release data.
for forbidden,label in [
    (OLD_SHA,'old stable sha'),
    (OLD_APK,'old stable filename'),
    ("version:'1.2.0'",'old current version literal'),
    ("bytes:5314934",'old current byte size'),
]:
    if forbidden in s:
        raise SystemExit(f'refusing to patch stale generated worker: {label}')
for required,label in [
    (NEW_SHA,'1.3 stable sha'),
    (NEW_APK,'1.3 stable filename'),
    ("version:'1.3.0'",'1.3 current version literal'),
    ("bytes:5892286",'1.3 current byte size'),
]:
    if required not in s:
        raise SystemExit(f'missing current release marker: {label}')

# Device-neutral storefront copy: Android is no longer described as a browser-
# only/PWA install. Start Free still goes through /chemistry/install, whose
# server dispatch becomes device-aware below.
once('${esc(PRODUCT.name)} · Installable web app','${esc(PRODUCT.name)} · Android app + web app','storefront eyebrow')
once('No card required. Install MUSITU from your browser; Premium entitlement is separate and only unlocks after verified payment.','No card required. Android uses the official signed MUSITU app; other supported devices can use the installable web app. Premium entitlement is separate and only unlocks after verified payment.','storefront install microcopy')
once('<strong>Installable web app</strong><span>one trusted install flow</span>','<strong>Android 1.3 + web app</strong><span>device-aware install flow</span>','storefront trust strip')

# The verification and release pages must describe the current Android stable
# artifact, not the legacy/PWA-first policy that preceded 1.3.0 promotion.
once('MUSITU installs from the trusted browser app surface. Premium access is a separate signed entitlement, and legacy package provenance remains available for verification without exposing payment or signing secrets.','On Android, MUSITU installs from the official signed stable APK. Other supported devices can use the installable web app. Premium access is a separate signed entitlement, and release provenance remains public without exposing payment or signing secrets.','verify intro')
once('<h2>Legacy Android package provenance</h2>','<h2>Official Android package</h2>','verify Android heading')
once('<li>Installable MUSITU Chemistry web app is the primary customer surface.</li>','<li>Android customers install the verified signed MUSITU Chemistry 1.3.0 app; other supported devices use the installable web app.</li>','release primary surface')
once('<li>Legacy Android package provenance remains available for support and verification only.</li>','<li>The retired Android 1.2.0 public download is unavailable; 1.3.0 is the current verified Android stable release.</li>','release Android retirement')
once('Installation troubleshooting: use the adaptive MUSITU install surface; Chrome, Samsung Internet and Safari expose their trusted install controls when available.','Installation troubleshooting: Android uses the official signed 1.3.0 APK through the MUSITU install route. Safari and supported desktop browsers use their trusted web-app install controls when available.','support installation guidance')

# Android browser users who somehow arrive directly on /chemistry/app must not
# remain on the browser preview. Standalone-installed PWA sessions are preserved;
# browser-mode Android is handed back to /chemistry/install, which resolves to
# the official 1.3.0 APK.
installed="  const installed=()=>{try{return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true||navigator.standalone===true}catch{return false}};"
once(installed,installed+"\n  const android=/Android/i.test(navigator.userAgent||'');\n  if(android&&!installed()){location.replace('/chemistry/install');return;}",'Android browser app handoff')

# Bump the app-shell browser cache generation so previously exposed browser-mode
# Android clients do not keep executing the old preview handoff. The service
# worker source separately moves to install-v9 and does not cache /install.
once("  const APP_CACHE='musitu-chemistry-app-shell-v4';","  const APP_CACHE='musitu-chemistry-app-shell-v5';",'app shell cache generation')
# Two occurrences each are expected: one in APP_STATIC and one in rendered app HTML.
exact_count('/chemistry/assets/app-shell.css?v=4',2,'app shell css v4')
exact_count('/chemistry/assets/app-shell.js?v=4',2,'app shell js v4')
s=s.replace('/chemistry/assets/app-shell.css?v=4','/chemistry/assets/app-shell.css?v=5')
s=s.replace('/chemistry/assets/app-shell.js?v=4','/chemistry/assets/app-shell.js?v=5')

# Server-authoritative Android install convergence. This is a temporary redirect
# so browsers/CDNs do not permanently pin a release URL. Non-Android clients keep
# the existing adaptive PWA install surface.
old_dispatch="if(req.method==='GET'&&p==='/chemistry/install')return storefrontHtml(STOREFRONT.renderInstall({userAgent:req.headers.get('user-agent')||''}),200,{'cache-control':'no-store'});"
new_dispatch="if(req.method==='GET'&&p==='/chemistry/install'){const installUa=req.headers.get('user-agent')||'';if(/Android/i.test(installUa))return new Response(null,{status:302,headers:{'location':'"+NEW_URL+"','cache-control':'no-store','x-musitu-release-version':'1.3.0','x-musitu-release-sha256':'"+NEW_SHA+"'}});return storefrontHtml(STOREFRONT.renderInstall({userAgent:installUa}),200,{'cache-control':'no-store'});}"
once(old_dispatch,new_dispatch,'Android install dispatch')

# Customer-facing HTML should revalidate quickly after this correction. Assets
# retain their existing immutable-ish cache policy; route HTML gets no stale 5m
# window during the migration.
once("function storefrontHtml(body,status=200,extra={}){return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300',...STOREFRONT_PUBLIC_HEADERS,...extra}})}","function storefrontHtml(body,status=200,extra={}){return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-cache, max-age=0, must-revalidate',...STOREFRONT_PUBLIC_HEADERS,...extra}})}",'customer HTML cache policy')

# Final fail-closed invariants for this release.
if OLD_SHA in s or OLD_APK in s or "version:'1.2.0'" in s:
    raise SystemExit('old Android current-release marker survived final patch')
for required in [NEW_SHA,NEW_APK,"version:'1.3.0'",'/chemistry/assets/app-shell.js?v=5',"musitu-chemistry-app-shell-v5",'x-musitu-release-version']:
    if required not in s:
        raise SystemExit('final Android 1.3 invariant missing: '+required)

OUT.write_text(s)
print(hashlib.sha256(OUT.read_bytes()).hexdigest())

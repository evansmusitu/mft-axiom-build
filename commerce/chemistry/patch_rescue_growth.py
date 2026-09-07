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

def module_text(name):
    text=(ROOT/'storefront'/name).read_text()
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    text=text.replace('export async function ','async function ').replace('export const ','const ').replace('export function ','function ')
    return f'// storefront/{name}\n{text.strip()}\n'

# Apply unique Phase 3 global-surface anchors before inserting Rescue renderer,
# which intentionally contains a similar footer of its own.
s=once(
    s,
    '<a href="/chemistry/releases">Release notes</a><a href="/chemistry/experience">Experience evidence</a><a href="/chemistry/security.txt">Security</a>',
    '<a href="/chemistry/rescue">Chemistry Rescue</a><a href="/chemistry/releases">Release notes</a><a href="/chemistry/experience">Experience evidence</a><a href="/chemistry/security.txt">Security</a>',
    'Rescue global footer'
)
s=once(
    s,
    "'/chemistry/experience'];",
    "'/chemistry/experience','/chemistry/rescue'];",
    'Rescue sitemap'
)

# Rescue source definitions must exist before field-experience initializes its
# source-detail allowlist. The renderer follows the existing global renderer.
insert=module_text('rescue-growth.mjs')+module_text('rescue-render.mjs')
s=once(s,'// storefront/field-experience.mjs\n',insert+'// storefront/field-experience.mjs\n','Rescue module insertion')

s=once(
    s,
    'renderPaymentStatus,renderExperience,ingestTelemetryRequest,readFieldSnapshot,computeFieldSnapshot,planViewsFromCore',
    'renderPaymentStatus,renderExperience,renderRescue,normalizeGrowthSource,RESCUE_CANONICAL_URL,ingestTelemetryRequest,readFieldSnapshot,computeFieldSnapshot,planViewsFromCore',
    'STOREFRONT Rescue exports'
)

s=once(
    s,
    "if(req.method==='GET'&&p==='/chemistry/plans')return storefrontHtml(STOREFRONT.renderPlanDecision({plans:STOREFRONT.planViewsFromCore(),query:storefrontQuery(u)}));",
    "if(req.method==='GET'&&p==='/chemistry/rescue')return storefrontHtml(STOREFRONT.renderRescue({source:STOREFRONT.normalizeGrowthSource(u.searchParams.get('src')||'')}));if(req.method==='GET'&&p==='/chemistry/plans')return storefrontHtml(STOREFRONT.renderPlanDecision({plans:STOREFRONT.planViewsFromCore(),query:storefrontQuery(u)}));",
    'Rescue dispatch'
)

OUT.write_text(s)
print(hashlib.sha256(OUT.read_bytes()).hexdigest())

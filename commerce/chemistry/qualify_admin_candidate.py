#!/usr/bin/env python3
import hashlib,importlib.util,json
from pathlib import Path

LIVE=Path('/tmp/mchem-admin/live.mjs')
CANDIDATE=Path('/tmp/mchem-admin/candidate.mjs')

def main():
    spec=importlib.util.spec_from_file_location('patcher','commerce/chemistry/patch_admin_command_center.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    original=LIVE.read_text();candidate=CANDIDATE.read_text();modules=m.combined_modules()
    if candidate.count(modules)!=1:raise SystemExit('combined modules not inserted exactly once')
    if candidate.replace(m.ROUTE_INSERT,'',1).replace(modules,'',1)!=original:raise SystemExit('candidate differs outside exact Admin insertion')
    required=['/chemistry/admin','adminRouterV2','adminCashSale','adminPaynowOrder','adminTransferDevice','adminRefund','adminCreateUser','adminOrder360','adminFinance','adminAuditVerify','chemistry_admin_audit','CHEMISTRY_ADMIN_OWNER_TOKEN','Customer 360','Cash Desk','Finance & Reconciliation','Team & Roles','Print receipt','Close & reconcile']
    for x in required:
        if x not in candidate:raise SystemExit('missing '+x)
    if 'DIRECT_PAYNOW_FALLBACK_ACTIVE=true' in candidate:raise SystemExit('direct Paynow fallback regression')
    preserved=["const DIRECT_PAYNOW_FALLBACK_ACTIVE=false;","currency:'USD'","/internal/paynow/sign-initiate-chemistry","/chemistry/webhooks/paynow","/chemistry/install","/chemistry/app"]
    for x in preserved:
        if x not in candidate:raise SystemExit('preserved contract missing '+x)
    core=Path('commerce/chemistry/admin_command_center_module.mjs').read_text();ui=Path('commerce/chemistry/admin_command_center_ui_v2.mjs').read_text()
    checks={
      'owner_wildcard':"owner:new Set(['*'])" in core,
      'cashier_cash_sales':"cashier:new Set(['dashboard','search','customers:read','customers:write','payments:read','cash','sales'" in core,
      'auditor_read_only':"auditor:new Set(['dashboard','search','customers:read','payments:read','audit:read','support:read','plans:read'])" in core,
      'revoke_owner_only':"action==='revoke'&&ctx.role!=='owner'" in core,
      'grant_owner_only':"ctx?.role!=='owner'" in core and 'adminGrantAccess' in core,
      'paynow_refund_not_faked':"provider_refund_required" in core and 'MUSITU recorded the refund request' in core,
      'cash_refund_reversal':"'cash','debit'" in core,
      'hash_chain':'adminAuditStatement' in core and 'adminAuditVerify' in ui,
      'server_quote_reused':'q=quote(plan,seatsInput)' in core,
      'server_signer_reused':'issueLicense(env' in core,
      'admin_cookie_secure':'HttpOnly; Secure; SameSite=Strict' in core,
      'admin_secret_required':'CHEMISTRY_ADMIN_OWNER_TOKEN' in core,
      'customer_360':'adminOrder360' in ui and 'Customer 360' in ui,
      'printable_receipt':'adminReceipt' in ui and 'Print receipt' in ui,
      'cash_reconciliation':'Close & reconcile' in ui and 'cash-sessions/close' in ui,
      'finance_summary':'adminFinance' in ui and 'Finance & Reconciliation' in ui,
      'staff_roles':'Team & Roles' in ui and 'admin-users/status' in ui,
      'security_headers':"frame-ancestors 'none'" in core and 'SameSite=Strict' in core,
    }
    bad=[k for k,v in checks.items() if not v]
    if bad:raise SystemExit('contract checks failed '+repr(bad))
    report={'schema':'musitu.chemistry.admin.candidate.v3','result':'PASS','baseline_sha256':hashlib.sha256(original.encode()).hexdigest(),'candidate_sha256':hashlib.sha256(candidate.encode()).hexdigest(),'candidate_bytes':len(candidate.encode()),'exact_reversible_delta':True,'operator_ui':'v2','checks':checks,'existing_commerce_preserved':True,'secure_usd_paynow_preserved':True,'production_mutation':False}
    out=Path('evidence-out');out.mkdir(exist_ok=True);(out/'candidate.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps(report,sort_keys=True));print('MUSITU_ADMIN_CANDIDATE_V3=PASS')
if __name__=='__main__':main()

#!/usr/bin/env python3
"""AXIOM Step1 owner authority: provider MFA posture, GET-only.

No owner account emails, names, IDs, roles, or session information are saved.
API-token 2FA flags are NOT authenticated interactive owner MFA/identity evidence.
Never modifies Cloudflare, secrets, D1, owner public pins or runtime policy.
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode

ACCOUNT='93f395f5121954671f92fffa453d6b61'
SCHEMA='musitu.axiom.step1.gate1-mfa-posture-readonly.v1'
OUTPUT='axiom_step1_gate1_mfa_posture_readonly_20261113.json'
MAX_BYTES=250_000
MAX_MEMBERS=500
MAX_PAGES=5

class NoGo(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None

def require(ok,code):
    if not ok:raise NoGo(code)

def valid_path(path):
    return path in ('/user','/accounts/'+ACCOUNT) or re.fullmatch(
        r'/accounts/'+ACCOUNT+r'/members\?page=[1-5]&per_page=100',path) is not None

def get_provider(token,path):
    require(valid_path(path),'UNREVIEWED_PROVIDER_PATH')
    require(isinstance(token,str) and token and not any(x in token for x in '\r\n'),'TOKEN_MISSING')
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,
                               headers={'Authorization':'Bearer '+token,'Accept':'application/json'},method='GET')
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=18) as res:
            require(res.status==200,'NON_200_RESPONSE')
            raw=res.read(MAX_BYTES+1)
            require(len(raw)<=MAX_BYTES,'OVERSIZED_PROVIDER_RESPONSE')
            doc=json.loads(raw)
            require(isinstance(doc,dict) and doc.get('success') is True,'INVALID_PROVIDER_ENVELOPE')
            return doc
    except urllib.error.HTTPError as ex:raise NoGo('HTTP_'+str(ex.code)) from None
    except (urllib.error.URLError,UnicodeError,ValueError,TimeoutError,OSError):raise NoGo('PROVIDER_UNAVAILABLE') from None

def receipt(now=None):
    if now is None:now=datetime.now(timezone.utc)
    require(now.tzinfo is not None,'NAIVE_CLOCK')
    return {
        'schema':SCHEMA,'captured_at_utc':now.astimezone(timezone.utc).isoformat(),
        'account':ACCOUNT,'operation':'GET_ONLY_PROVIDER_POSTURE_NO_PII_SAVED',
        'account_http':'UNREAD','account_identity_matched':False,
        'account_2fa_requirement_enabled':False,
        'member_list_http':'UNREAD','member_list_complete':False,
        'accepted_member_count':None,'accepted_members_with_2fa_count':None,
        'accepted_member_2fa_all_enabled':False,
        'member_super_admin_count':None,'members_require_2fa_independently_enforced':False,
        'token_user_http':'UNREAD','token_user_2fa_reported':None,
        'token_user_identity_is_verified_owner':False,
        'owner_physical_mfa_challenge_completed':False,
        'owner_identity_and_mfa_independently_qualified':False,
        'owner_signing_public_spki_independently_activated':False,
        'sole_owner_policy_runtime_activated':False,
        'runtime_pr216_two_human_verification_unchanged':True,
        'owner_signed_proposal_authorizes_provider_operations':False,
        'gate1_closed':False,'step1_closed':False,'step2_authorized':False,
        'b27_synthetic_cas':'FAIL','pr83_fullstack':'FAIL',
        'release_status':'NOT_RELEASE','status':'OWNER_MFA_READONLY_POSTURE_ONLY_NO_GO',
    }

def audit(get=get_provider,token=None,now=None):
    if token is None:token=os.getenv('CLOUDFLARE_API_TOKEN','')
    r=receipt(now)
    try:
        account=get(token,'/accounts/'+ACCOUNT)
        data=account.get('result') if isinstance(account,dict) else None
        require(isinstance(data,dict) and account.get('success') is True,'BAD_ACCOUNT_RESPONSE')
        r['account_http']=200
        r['account_identity_matched']=(data.get('id')==ACCOUNT)
        settings=data.get('settings') or {}
        if isinstance(settings,dict):r['account_2fa_requirement_enabled']=(settings.get('enforce_twofactor') is True)
    except NoGo as e:
        r['account_http']=str(e)
    except (KeyError,TypeError,ValueError):r['account_http']='BAD_ACCOUNT_RESPONSE'
    try:
        total=None;entries=0;accepted=0;mfa_on=0;superadmin=0;seen_member_ids=set()
        for page in range(1,MAX_PAGES+1):
            path='/accounts/'+ACCOUNT+'/members?'+urlencode({'page':page,'per_page':100})
            res=get(token,path)
            require(isinstance(res,dict) and res.get('success') is True,'BAD_MEMBER_ENVELOPE')
            items=res.get('result');info=res.get('result_info')
            require(isinstance(items,list) and isinstance(info,dict),'BAD_MEMBER_PAGE')
            require(all(type(info.get(k)) is int for k in ('page','per_page','count','total_count')),'BAD_MEMBER_COUNTS')
            require(info['page']==page and info['per_page']==100 and info['count']==len(items),'MEMBER_PAGE_DRIFT')
            require(info['total_count']<=MAX_MEMBERS,'TOO_MANY_MEMBERS')
            if total is None:total=info['total_count']
            require(total==info['total_count'],'MEMBER_COUNT_DRIFT')
            expect=min(100,max(0,total-(page-1)*100))
            require(len(items)==expect,'INCOMPLETE_MEMBER_PAGE')
            for item in items:
                require(isinstance(item,dict),'INVALID_MEMBER_ENTRY')
                member_id=item.get('id')
                require(isinstance(member_id,str) and member_id,'MEMBER_MISSING_ID')
                require(member_id not in seen_member_ids,'DUPLICATE_MEMBER_ID')
                seen_member_ids.add(member_id)
                user=item.get('user') or {}
                require(isinstance(user,dict),'INVALID_MEMBER_USER')
                status=item.get('status')
                require(status in ('accepted','pending'),'UNRECOGNIZED_MEMBER_STATUS')
                if status=='accepted':
                    accepted+=1
                    mfa_on+=int(user.get('two_factor_authentication_enabled') is True)
                    roles=item.get('roles') or []
                    if isinstance(roles,list) and any((isinstance(x,dict) and str(x.get('name','')).strip().lower()=='super administrator') for x in roles):
                        superadmin+=1
                entries+=1
            if entries>=total:break
        require(entries==total,'MEMBER_LIST_TRUNCATED')
        r['member_list_http']=200
        r['member_list_complete']=True
        r['accepted_member_count']=accepted
        r['accepted_members_with_2fa_count']=mfa_on
        r['accepted_member_2fa_all_enabled']=accepted>0 and accepted==mfa_on
        r['member_super_admin_count']=superadmin
        # This is a read-only posture check, not independent enforcement proof.
    except NoGo as e:
        r['member_list_http']=str(e)
    except (KeyError,TypeError,ValueError):r['member_list_http']='BAD_MEMBER_RESPONSE'
    try:
        user=get(token,'/user')
        data=user.get('result') if isinstance(user,dict) else None
        require(isinstance(data,dict) and user.get('success') is True,'BAD_TOKEN_USER')
        r['token_user_http']=200
        flag=data.get('two_factor_authentication_enabled')
        if type(flag) is bool:r['token_user_2fa_reported']=flag
    except NoGo as e:r['token_user_http']=str(e)
    except (KeyError,TypeError,ValueError):r['token_user_http']='BAD_TOKEN_USER'
    require(r['gate1_closed'] is False and r['owner_identity_and_mfa_independently_qualified'] is False and
            r['release_status']=='NOT_RELEASE','MFA_EVIDENCE_MUST_NOT_CLOSE_GATE')
    return r

def main():
    r=audit()
    raw=(json.dumps(r,indent=2,sort_keys=True)+'\n').encode('utf-8')
    Path(OUTPUT).write_bytes(raw)
    Path(OUTPUT+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+OUTPUT+'\n',encoding='utf-8')
    print('AXIOM_STEP1_GATE1_CLOUDFLARE_MFA_POSTURE_GET_ONLY_NOT_RELEASE')
    for k in ('account_http','account_identity_matched','account_2fa_requirement_enabled','member_list_http',
              'member_list_complete','accepted_member_count','accepted_members_with_2fa_count',
              'accepted_member_2fa_all_enabled','member_super_admin_count','token_user_http','token_user_2fa_reported'):
        print(k+'='+str(r[k]))

if __name__=='__main__':main()

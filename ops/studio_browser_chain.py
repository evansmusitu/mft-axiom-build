"""Read-only chain of evidence for Studio staff Access, Android UA, Modal CPU and R2.

Provider-correlated telemetry is not physical handset attestation. Do not persist
identities, job UUIDs, request paths, tokens, raw logs or source scenes.
"""
import json
import os
import pathlib
import re
import tempfile
from datetime import datetime, timezone, timedelta
from studio_r2_live_audit import remote_get, summarize_state, check_asset, FILES, STATE
from studio_usage_forensics import request_json, BASE, ACCOUNT, HOST

OUT=pathlib.Path('studio-production-android-chain-evidence-20261018.json')
START='2026-10-18T06:33:00Z'
END='2026-10-18T06:53:00Z'


def correlate_mobile_chain(job_id, created_at, groups, access, cpu, assets):
    actions={action:0 for action in ('submit', 'approve', 'dispatch', 'sync')}
    downloads={name:0 for name in ('scene.blend','scene.glb','preview.png')}
    if not isinstance(job_id,str) or not re.fullmatch(r'[a-f0-9-]{36}',job_id):
        return {'mobile_access_cpu_r2_provider_correlated':False,'physical_android_attested':False}
    for row in groups if isinstance(groups,list) else []:
        if not isinstance(row,dict) or not isinstance(row.get('dimensions'),dict):continue
        dim=row['dimensions'];n=row.get('count')
        if type(n) is not int or not 1<=n<=100000 or str(dim.get('clientDeviceType','')).lower()!='mobile':continue
        if not isinstance(dim.get('edgeResponseStatus'),int) or not 200<=dim['edgeResponseStatus']<300:continue
        path=dim.get('clientRequestPath')
        if dim.get('clientRequestHTTPMethodName') == 'GET':
            for name in downloads:
                if path == f'/api/jobs/{job_id}/assets/{name}':downloads[name] += n
        if dim.get('clientRequestHTTPMethodName') != 'POST':continue
        if path=='/api/jobs':actions['submit']+=n
        for action in ('approve','dispatch','sync'):
            if path==f'/api/jobs/{job_id}/{action}':actions[action]+=n
    try:
        created=datetime.fromisoformat(created_at.replace('Z','+00:00'))
    except (TypeError,ValueError,AttributeError):
        created=datetime(1970,1,1,tzinfo=timezone.utc)
    human_logins=0
    for event in access if isinstance(access,list) else []:
        if not isinstance(event,dict) or event.get('app_domain')!=HOST or event.get('allowed') is not True or event.get('action') not in ('login',None):continue
        if not isinstance(event.get('user_email'),str) or '@' not in event['user_email']:continue
        try:
            when=datetime.fromisoformat(event.get('created_at','').replace('Z','+00:00'))
            if created-timedelta(minutes=45)<=when<=created:human_logins+=1
        except (ValueError,TypeError):pass
    full=bool(cpu and assets and human_logins and all(actions.values()))
    return {'android_ua_mobile_successful_post_sampled_counts':actions,
            'staff_access_allowed_human_identity_login_preceded_job':bool(human_logins),
            'cpu_completed_in_production_state':bool(cpu),
            'three_r2_assets_sha256_verified':bool(assets),
            'all_three_assets_downloaded_from_android_ua':all(downloads.values()),
            'android_asset_get_sampled_counts':downloads,
            'same_job_uuid_matched_in_mobile_approve_dispatch_sync':all(actions[x]>0 for x in ('approve','dispatch','sync')),
            'mobile_access_cpu_r2_provider_correlated':full,
            'physical_android_attested':False,
            'same_access_session_cryptographically_linked_to_job':False,
            'http_analytics_sampling_caveat':True}


def main():
    receipt={'schema':'musitu.studio.android-ua-access-modal-r2-provider-correlation.v1',
             'checked_at_utc':datetime.now(timezone.utc).isoformat(),
             'read_only':True,'providers_mutated':False,
             'physical_android_attested':False,
             'mobile_access_cpu_r2_provider_correlated':False,
             'window_utc':{'start':START,'end':END},'status':'NOT_STARTED'}
    token=os.getenv('CLOUDFLARE_API_TOKEN') or os.getenv('CF_API_TOKEN')
    if not token:
        receipt['status']='MISSING_PROVIDER_READ_TOKEN'
    else:
        with tempfile.TemporaryDirectory(prefix='studio-browser-verify-') as root:
            p=pathlib.Path(root);state=p/'control-state.json'
            if not remote_get(STATE,state):
                receipt['status']='LIVE_R2_CONTROL_STATE_UNREADABLE'
            else:
                try:
                    summary,manifest=summarize_state(state.read_bytes())
                    raw=json.loads(state.read_bytes())
                    completed=[j for j in raw['jobs'] if j.get('state')=='COMPLETED']
                    job=completed[-1] if completed else None
                    if not job or not manifest or job.get('render_device')!='CPU' or not START <= job.get('created_at','') <= END:
                        receipt['status']='NO_MATCHING_WINDOW_CPU_COMPLETED_JOB'
                    else:
                        files_good=[]
                        for name in FILES:
                            local=p/name
                            downloaded=remote_get(manifest[name]['key'],local)
                            files_good.append(downloaded and local.stat().st_size <= 5000000 and check_asset(name,local.read_bytes(),manifest[name]))
                        receipt['live_r2_artifact_integrity']=bool(all(files_good))
                        q='?since=2026-10-18T06%3A00%3A00Z&until=2026-10-18T06%3A45%3A00Z&limit=100&direction=desc'
                        status,access_body=request_json('GET',f'{BASE}/accounts/{ACCOUNT}/access/logs/access_requests'+q,token)
                        receipt['access_log_http_status']=status
                        access=access_body.get('result') if status==200 and isinstance(access_body,dict) and access_body.get('success') else []
                        zs,zones=request_json('GET',BASE+'/zones?name=mftintelligence.com&status=active',token)
                        names=zones.get('result') if zs==200 and isinstance(zones,dict) and zones.get('success') else []
                        match=[z for z in (names or []) if isinstance(z,dict) and z.get('name')=='mftintelligence.com' and (z.get('account') or {}).get('id')==ACCOUNT]
                        if len(match)!=1:
                            receipt['status']='CLOUDFLARE_ZONE_NOT_VERIFIED'
                        else:
                            query='''query StudioAndroid($zoneTag: string,$filter: HttpRequestsAdaptiveGroupsFilter_InputObject){viewer {zones(filter:{zoneTag:$zoneTag}){httpRequestsAdaptiveGroups(filter:$filter,limit:100,orderBy:[count_DESC]){count dimensions {clientRequestPath clientRequestHTTPMethodName clientDeviceType edgeResponseStatus}}}}}'''
                            filt={'clientRequestHTTPHost':HOST,'clientRequestPath_like':'/api/%',
                                  'datetime_geq':START,'datetime_leq':END,'requestSource':'eyeball',
                                  'userAgent_like':'%Android%'}
                            http,body=request_json('POST',BASE+'/graphql',token,{'query':query,'variables':{'zoneTag':match[0]['id'],'filter':filt}})
                            receipt['analytics_http_status']=http
                            groups=[]
                            if http==200 and isinstance(body,dict) and not body.get('errors'):
                                zlist=(((body.get('data') or {}).get('viewer') or {}).get('zones') or [])
                                if len(zlist)==1 and isinstance(zlist[0].get('httpRequestsAdaptiveGroups'),list):groups=zlist[0]['httpRequestsAdaptiveGroups']
                            receipt['analytics_query_usable']=isinstance(groups,list) and bool(groups)
                            result=correlate_mobile_chain(job['id'],job['created_at'],groups,access,True,all(files_good))
                            receipt.update(result)
                            receipt['status']='PROVIDER_CORRELATION_FINISHED'
                except (ValueError,OSError,TypeError,KeyError):
                    receipt['status']='STATE_OR_PROVIDER_DATA_INVALID'
    OUT.write_text(json.dumps(receipt,indent=2,sort_keys=True)+'\n')
    print('STUDIO_BROWSER_CHAIN='+json.dumps(receipt,sort_keys=True))


if __name__=='__main__':main()

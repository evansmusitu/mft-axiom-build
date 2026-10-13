"""B20 S0 native OpenHands action→observation provenance checks.

Checks exactly the ID relationships observed in genuine B19 native SDK events.
Does NOT prove independent event origin or production authentication. Apply only
after verifying the signed B19 portable envelope and pinned source commit.
"""
import re

ID=re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$')
TOOLS={'file_editor','finish'}
FIELDS={'kind','id','tool_call_id','tool_name','action_id'}

class CausalDenied(Exception):pass


def verify_linkage(events):
    if type(events) is not list or not 1<=len(events)<=10000:
        raise CausalDenied('INVALID_EVENT_SET')
    agents={}
    ids=set()
    toolcalls=set()
    for row in events:
        if type(row) is not dict or set(row)!={'worker','ordinal','event'}:
            raise CausalDenied('INVALID_EVENT_WRAPPER')
        worker=row['worker'];ordn=row['ordinal'];event=row['event']
        if type(worker) is not str or not ID.fullmatch(worker) or type(ordn) is not int or ordn<0:
            raise CausalDenied('INVALID_IDENTITY_OR_ORDINAL')
        if type(event) is not dict or set(event)!=FIELDS or event['kind'] not in ('ActionEvent','ObservationEvent'):
            raise CausalDenied('INVALID_NATIVE_EVENT')
        if any(type(event[k]) is not str or not event[k] or len(event[k])>100 for k in ('id','tool_call_id','tool_name')) or event['tool_name'] not in TOOLS:
            raise CausalDenied('MISSING_NATIVE_CAUSAL_ID')
        if event['id'] in ids:
            raise CausalDenied('DUPLICATED_EVENT_ID')
        ids.add(event['id'])
        st=agents.setdefault(worker,dict(next_ord=0,pending=None,finished=False,matched_pairs=0,file_edits=0,finish_actions=0))
        if st['next_ord']!=ordn:
            raise CausalDenied('PER_WORKER_ORDINAL_SEQUENCE_INVALID')
        st['next_ord']+=1
        if event['kind']=='ActionEvent':
            if st['pending'] or st['finished'] or event['action_id'] is not None or event['tool_call_id'] in toolcalls:
                raise CausalDenied('UNAUTHORIZED_ACTION_OR_DUPLICATE_CALL')
            toolcalls.add(event['tool_call_id'])
            if event['tool_name']=='finish' and st['file_edits']<1:
                raise CausalDenied('PREMATURE_FINISH')
            st['pending']={'id':event['id'],'tool_call_id':event['tool_call_id'],'name':event['tool_name']}
            if event['tool_name']=='file_editor':st['file_edits']+=1
            else:st['finish_actions']+=1
        else:
            expected=st['pending']
            if not expected or event['action_id']!=expected['id'] or event['tool_call_id']!=expected['tool_call_id'] or event['tool_name']!=expected['name']:
                raise CausalDenied('OBSERVATION_NOT_LINKED_TO_ACTION')
            st['pending']=None
            st['matched_pairs']+=1
            if event['tool_name']=='finish':st['finished']=True
    if not agents or any(x['pending'] or not x['finished'] or x['finish_actions']!=1 or x['matched_pairs']<2 for x in agents.values()):
        raise CausalDenied('INCOMPLETE_NATIVE_WORK_CHAIN')
    return {'workers':{who:{'matched_pairs':st['matched_pairs'],'file_edits':st['file_edits'],'finish_actions':st['finish_actions']} for who,st in sorted(agents.items())},
        'total_pairs':sum(x['matched_pairs'] for x in agents.values()),
        'finish_count':sum(x['finish_actions'] for x in agents.values())}

#!/usr/bin/env python3
import argparse, json, re, hashlib
from pathlib import Path
from collections import defaultdict
import torch
from torch import nn
from transformers import AutoTokenizer, AutoModel
from sklearn.metrics import f1_score

LABEL_MAP={'Contradiction':0,'Entailment':1,'NotMentioned':2}

def words(s): return set(re.findall(r'[a-z0-9]+',s.lower()))
def overlap(a,b):
    A=words(a); B=words(b); return len(A&B)/(len(A|B) or 1)
def partition(d):
    return 'cal' if int(hashlib.sha256(str(d['id']).encode()).hexdigest()[:8],16)%10==0 else 'build'
def span_texts(d): return [d['text'][a:b].strip() for a,b in d['spans']]
def context(spans,i,radius=2): return ' '.join(spans[max(0,i-radius):min(len(spans),i+radius+1)])[:5000]

class Joint(nn.Module):
    def __init__(self,encoder):
        super().__init__()
        h=encoder.config.hidden_size
        self.encoder=encoder
        self.drop=nn.Dropout(.1)
        self.class_head=nn.Linear(h,3)
        self.ev_head=nn.Linear(h,2)
    def forward(self,**kw):
        o=self.encoder(**kw,return_dict=True)
        h=self.drop(o.last_hidden_state[:,0,:])
        return self.class_head(h),self.ev_head(h)

def metric(rows):
    y=[r['gold'] for r in rows]; p=[r['pred'] for r in rows]
    nm=[i for i,v in enumerate(y) if v==2]; pos=[i for i,v in enumerate(y) if v!=2]
    evhit=sum(rows[i]['best_span_index'] in rows[i]['gold_spans'] for i in pos)/(len(pos) or 1)
    return {
      'accuracy':sum(a==b for a,b in zip(y,p))/len(y),
      'macro_f1':float(f1_score(y,p,labels=[0,1,2],average='macro',zero_division=0)),
      'false_grounding_notmentioned':sum(p[i]!=2 for i in nm)/(len(nm) or 1),
      'positive_semantic_accuracy':sum(p[i]==y[i] for i in pos)/(len(pos) or 1),
      'selected_evidence_exact_span_recall':evhit,
      'n':len(y)
    }

@torch.inference_mode()
def evaluate(model,tok,path,k,threshold,which=None):
    obj=json.load(open(path)); labs=obj['labels']; out=[]; model.eval()
    for d in obj['documents']:
        if which and partition(d)!=which: continue
        spans=span_texts(d); anns=d['annotation_sets'][0]['annotations']
        for hid in sorted(labs):
            h=labs[hid]['hypothesis']; gold=LABEL_MAP[anns[hid]['choice']]
            ranked=sorted(((overlap(s,h),i) for i,s in enumerate(spans)),reverse=True)[:k]
            segs=[context(spans,i) for _,i in ranked]
            classp=[]; evp=[]
            for z in range(0,len(segs),64):
                batch=segs[z:z+64]
                e=tok(batch,[h]*len(batch),padding=True,truncation=True,max_length=256,return_tensors='pt')
                lc,le=model(**e)
                classp.extend(torch.softmax(lc,-1).tolist())
                evp.extend(torch.softmax(le,-1)[:,1].tolist())
            bestc=0.0; bestlabel=2; besti=None
            for jj,(cp,ep) in enumerate(zip(classp,evp)):
                for lab in (0,1):
                    score=ep*cp[lab]
                    if score>bestc:
                        bestc=score; bestlabel=lab; besti=jj
            pred=bestlabel if bestc>=threshold else 2
            out.append({'doc':str(d['id']),'hid':hid,'gold':gold,'pred':pred,'score':bestc,
                        'best_span_index':ranked[besti][1] if besti is not None else None,
                        'gold_spans':anns[hid].get('spans') or []})
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--encoder',required=True)
    ap.add_argument('--checkpoint',required=True)
    ap.add_argument('--train-json',required=True)
    ap.add_argument('--dev-json',required=True)
    ap.add_argument('--out',required=True)
    args=ap.parse_args()
    torch.set_num_threads(2)
    enc_path=Path(args.encoder); tok=AutoTokenizer.from_pretrained(enc_path,local_files_only=True)
    enc=AutoModel.from_pretrained(enc_path,local_files_only=True)
    model=Joint(enc)
    ck=torch.load(args.checkpoint,map_location='cpu',weights_only=False)
    model.load_state_dict(ck['state_dict'],strict=True)
    candidates=[]
    thresholds=[.10,.15,.20,.25,.30,.35,.40,.45,.50,.55,.60,.65,.70,.75,.80,.85,.90]
    for k in (24,32):
        best=None
        for th in thresholds:
            rows=evaluate(model,tok,args.train_json,k,th,'cal'); m=metric(rows)
            key=(m['false_grounding_notmentioned']<=.02,m['macro_f1'],m['accuracy'],m['selected_evidence_exact_span_recall'],-m['false_grounding_notmentioned'])
            if best is None or key>best[0]: best=(key,th,m)
        _,th,calm=best
        candidates.append({'k':k,'threshold':th,'calibration':calm})
    # K and threshold are selected exclusively from held-out training documents.
    def selkey(x):
        m=x['calibration']; return (m['false_grounding_notmentioned']<=.02,m['macro_f1'],m['accuracy'],m['selected_evidence_exact_span_recall'],-x['k'])
    chosen=max(candidates,key=selkey)
    devrows=evaluate(model,tok,args.dev_json,chosen['k'],chosen['threshold'],None); dm=metric(devrows)
    by={}
    for hid in sorted({r['hid'] for r in devrows}): by[hid]=metric([r for r in devrows if r['hid']==hid])
    rep={'schema':'musitu.revenueguard.contractnli.joint_span_nli.wide_eval.v1','status':'DEV_RESEARCH_ONLY',
         'candidate_settings':candidates,'chosen_k':chosen['k'],'chosen_threshold':chosen['threshold'],
         'selection_rule':'K and threshold chosen on hash-held train calibration partition only; dev never used for selection',
         'dev':dm,'dev_by_hypothesis':by,
         'gate':{'accuracy_min':.90,'macro_f1_min':.88,'false_grounding_max':.02,'evidence_recall_min':.85,
                 'pass':dm['accuracy']>=.90 and dm['macro_f1']>=.88 and dm['false_grounding_notmentioned']<=.02 and dm['selected_evidence_exact_span_recall']>=.85}}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))

if __name__=='__main__': main()

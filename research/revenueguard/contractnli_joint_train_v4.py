#!/usr/bin/env python3
import argparse,json,re,hashlib,random,time,math
from pathlib import Path
from collections import Counter
import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset,DataLoader
from transformers import AutoTokenizer,AutoModel
from sklearn.metrics import f1_score

SEED=481928
LABEL_MAP={'Contradiction':0,'Entailment':1,'NotMentioned':2}

def words(s):return set(re.findall(r'[a-z0-9]+',s.lower()))
def overlap(a,b):
    A=words(a);B=words(b);return len(A&B)/(len(A|B) or 1)
def partition(d):return 'cal' if int(hashlib.sha256(str(d['id']).encode()).hexdigest()[:8],16)%10==0 else 'build'
def span_texts(d):return [d['text'][a:b].strip() for a,b in d['spans']]
def target_context(spans,i,radius=2):
    left=' '.join(spans[max(0,i-radius):i]);right=' '.join(spans[i+1:min(len(spans),i+radius+1)])
    return ('TARGET SPAN:\n'+spans[i]+'\nSURROUNDING CONTEXT:\n'+left+' '+right)[:5000]

def build_samples(obj):
    labels=obj['labels'];build=[]
    for d in obj['documents']:
        if partition(d)!='build':continue
        spans=span_texts(d);anns=d['annotation_sets'][0]['annotations']
        for hid in sorted(labels):
            h=labels[hid]['hypothesis'];a=anns[hid];gold=LABEL_MAP[a['choice']];ev=set(a.get('spans') or [])
            if gold!=2:
                for i in sorted(ev)[:4]:
                    if i<len(spans):build.append((target_context(spans,i),h,gold,1))
            candidates=sorted(((overlap(s,h),i) for i,s in enumerate(spans) if i not in ev),reverse=True)
            take=4 if gold==2 else 3
            for _,i in candidates[:take]:build.append((target_context(spans,i),h,2,0))
    return build

class DS(Dataset):
    def __init__(self,rows):self.rows=rows
    def __len__(self):return len(self.rows)
    def __getitem__(self,i):return self.rows[i]

def metrics(rows):
    y=[r['gold'] for r in rows];p=[r['pred'] for r in rows];nm=[i for i,v in enumerate(y) if v==2];pos=[i for i,v in enumerate(y) if v!=2]
    evhit=sum(rows[i]['best_span_index'] in rows[i]['gold_spans'] for i in pos)/(len(pos) or 1)
    return {'accuracy':sum(a==b for a,b in zip(y,p))/len(y),'macro_f1':float(f1_score(y,p,labels=[0,1,2],average='macro',zero_division=0)),'false_grounding_notmentioned':sum(p[i]!=2 for i in nm)/(len(nm) or 1),'positive_semantic_accuracy':sum(p[i]==y[i] for i in pos)/(len(pos) or 1),'selected_evidence_exact_span_recall':evhit,'n':len(y)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--encoder',required=True);ap.add_argument('--train-json',required=True);ap.add_argument('--dev-json',required=True);ap.add_argument('--out-dir',required=True);args=ap.parse_args()
    random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(2)
    src=Path(args.encoder);tok=AutoTokenizer.from_pretrained(src,local_files_only=True);enc=AutoModel.from_pretrained(src,local_files_only=True);H=enc.config.hidden_size
    class Joint(nn.Module):
        def __init__(self,encoder):
            super().__init__();self.encoder=encoder;self.drop=nn.Dropout(.1);self.class_head=nn.Linear(H,3);self.ev_head=nn.Linear(H,2)
        def forward(self,**kw):
            o=self.encoder(**kw,return_dict=True);h=self.drop(o.last_hidden_state[:,0,:]);return self.class_head(h),self.ev_head(h)
    model=Joint(enc)
    for p in model.encoder.parameters():p.requires_grad=False
    core=getattr(model.encoder,'encoder',None)
    if core is None and hasattr(model.encoder,'bert'):core=model.encoder.bert.encoder
    layers=getattr(core,'layer',None) if core is not None else None
    if layers is None:raise RuntimeError(type(model.encoder))
    for layer in layers[-2:]:
        for p in layer.parameters():p.requires_grad=True
    params=[p for p in model.parameters() if p.requires_grad]
    train_obj=json.load(open(args.train_json));build=build_samples(train_obj);random.shuffle(build)
    class_counts=Counter(x[2] for x in build);ev_counts=Counter(x[3] for x in build);n=len(build)
    # Square-root inverse-frequency weights, derived only from build data; normalize mean weight to 1.
    cw=np.array([math.sqrt(n/(3*class_counts[i])) for i in range(3)],dtype=np.float32);cw=cw/cw.mean()
    ew=np.array([math.sqrt(n/(2*ev_counts[i])) for i in range(2)],dtype=np.float32);ew=ew/ew.mean()
    class_ce=nn.CrossEntropyLoss(weight=torch.tensor(cw));ev_ce=nn.CrossEntropyLoss(weight=torch.tensor(ew))
    def collate(batch):
        e=tok([x[0] for x in batch],[x[1] for x in batch],padding=True,truncation=True,max_length=256,return_tensors='pt')
        return e,torch.tensor([x[2] for x in batch]),torch.tensor([x[3] for x in batch])
    dl=DataLoader(DS(build),batch_size=48,shuffle=True,collate_fn=collate,num_workers=0)
    opt=torch.optim.AdamW(params,lr=2e-5,weight_decay=.01);model.train();losses=[];t0=time.time()
    print('samples',n,'class_counts',dict(class_counts),'evidence_counts',dict(ev_counts),'class_weights',cw.tolist(),'evidence_weights',ew.tolist(),flush=True)
    for epoch in range(3):
        tot=0.;steps=0
        for step,(e,y,yev) in enumerate(dl):
            opt.zero_grad(set_to_none=True);lc,le=model(**e);loss=class_ce(lc,y)+.8*ev_ce(le,yev);loss.backward();torch.nn.utils.clip_grad_norm_(params,1.0);opt.step();tot+=float(loss.detach());steps+=1
            if step and step%150==0:print('epoch',epoch+1,'step',step,'loss',round(tot/steps,4),'elapsed',round(time.time()-t0,1),flush=True)
        losses.append(tot/steps);print('epoch_done',epoch+1,'loss',round(losses[-1],5),flush=True)
    @torch.inference_mode()
    def score_docs(path,k,which=None):
        obj=json.load(open(path));labs=obj['labels'];rows=[];model.eval()
        for d in obj['documents']:
            if which and partition(d)!=which:continue
            spans=span_texts(d);anns=d['annotation_sets'][0]['annotations']
            for hid in sorted(labs):
                h=labs[hid]['hypothesis'];gold=LABEL_MAP[anns[hid]['choice']]
                ranked=sorted(((overlap(s,h),i) for i,s in enumerate(spans)),reverse=True)[:k]
                segs=[target_context(spans,i) for _,i in ranked];classp=[];evp=[]
                for z in range(0,len(segs),64):
                    batch=segs[z:z+64];e=tok(batch,[h]*len(batch),padding=True,truncation=True,max_length=256,return_tensors='pt');lc,le=model(**e);classp.extend(torch.softmax(lc,-1).tolist());evp.extend(torch.softmax(le,-1)[:,1].tolist())
                bestc=0.;bestlabel=2;besti=None
                for jj,(cp,ep) in enumerate(zip(classp,evp)):
                    for lab in (0,1):
                        s=ep*cp[lab]
                        if s>bestc:bestc=s;bestlabel=lab;besti=jj
                rows.append({'doc':str(d['id']),'hid':hid,'gold':gold,'score':bestc,'candidate_label':bestlabel,'best_span_index':ranked[besti][1] if besti is not None else None,'gold_spans':anns[hid].get('spans') or []})
        return rows
    def apply(rows,th):return [{**r,'pred':r['candidate_label'] if r['score']>=th else 2} for r in rows]
    thresholds=[.10,.15,.20,.25,.30,.35,.40,.45,.50,.55,.60,.65,.70,.75,.80,.85,.90]
    settings=[]
    for k in (24,32):
        raw=score_docs(args.train_json,k,'cal');best=None
        for th in thresholds:
            m=metrics(apply(raw,th));key=(m['false_grounding_notmentioned']<=.02,m['macro_f1'],m['accuracy'],m['selected_evidence_exact_span_recall'],-m['false_grounding_notmentioned'])
            if best is None or key>best[0]:best=(key,th,m)
        _,th,cm=best;settings.append({'k':k,'threshold':th,'calibration':cm})
    def choose(x):
        m=x['calibration'];return (m['false_grounding_notmentioned']<=.02,m['macro_f1'],m['accuracy'],m['selected_evidence_exact_span_recall'],-x['k'])
    chosen=max(settings,key=choose);devraw=score_docs(args.dev_json,chosen['k']);devrows=apply(devraw,chosen['threshold']);dm=metrics(devrows)
    by={hid:metrics([r for r in devrows if r['hid']==hid]) for hid in sorted({r['hid'] for r in devrows})}
    out=Path(args.out_dir);out.mkdir(parents=True,exist_ok=True);torch.save({'state_dict':model.state_dict(),'candidate_settings':settings,'chosen':chosen,'seed':SEED,'class_weights':cw.tolist(),'evidence_weights':ew.tolist()},out/'joint_span_nli_v4.pt')
    bb=(out/'joint_span_nli_v4.pt').read_bytes();rep={'schema':'musitu.revenueguard.contractnli.joint_span_nli.v4','status':'DEV_RESEARCH_ONLY','treatment':'V3 architecture plus build-only square-root inverse-frequency class/evidence weighting','seed':SEED,'class_counts':dict(class_counts),'evidence_counts':dict(ev_counts),'class_weights':cw.tolist(),'evidence_weights':ew.tolist(),'training_examples':n,'epoch_loss':losses,'candidate_settings':settings,'chosen_k':chosen['k'],'chosen_threshold':chosen['threshold'],'selection_rule':'weights from build only; K and threshold from hash-held train calibration only; dev scored once','dev':dm,'dev_by_hypothesis':by,'model_sha256':hashlib.sha256(bb).hexdigest(),'gate':{'accuracy_min':.90,'macro_f1_min':.88,'false_grounding_max':.02,'evidence_recall_min':.85,'pass':dm['accuracy']>=.90 and dm['macro_f1']>=.88 and dm['false_grounding_notmentioned']<=.02 and dm['selected_evidence_exact_span_recall']>=.85}}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path('CONTRACTNLI_JOINT_SPAN_NLI_V4_DEV_EVAL.json').write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__':main()

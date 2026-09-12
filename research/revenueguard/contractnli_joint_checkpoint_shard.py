#!/usr/bin/env python3
import argparse,hashlib,json,re,random
from pathlib import Path
import numpy as np
import torch
from torch import nn
from transformers import AutoTokenizer,AutoModel

SEED=481928
LABEL_MAP={'Contradiction':0,'Entailment':1,'NotMentioned':2}
KS=(24,32)

def words(s):return set(re.findall(r'[a-z0-9]+',s.lower()))
def overlap(a,b):
    A=words(a);B=words(b);return len(A&B)/(len(A|B) or 1)
def partition(d):return 'cal' if int(hashlib.sha256(str(d['id']).encode()).hexdigest()[:8],16)%10==0 else 'build'
def shard_for(corpus,doc_id,n):return int(hashlib.sha256(f'musitu-contractnli-eval-shard-v1|{corpus}|{doc_id}'.encode()).hexdigest()[:8],16)%n
def normalize_doc(s):return re.sub(r'\s+',' ',s).strip().lower()
def doc_hash(d):return hashlib.sha256(normalize_doc(d['text']).encode()).hexdigest()
def span_texts(d):return [d['text'][a:b].strip() for a,b in d['spans']]
def target_context(spans,i,radius=2):
    left=' '.join(spans[max(0,i-radius):i]);right=' '.join(spans[i+1:min(len(spans),i+radius+1)])
    return ('TARGET SPAN:\n'+spans[i]+'\nSURROUNDING CONTEXT:\n'+left+' '+right)[:5000]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--encoder',required=True);ap.add_argument('--state',required=True);ap.add_argument('--train-json',required=True);ap.add_argument('--dev-json',required=True);ap.add_argument('--shard-index',type=int,required=True);ap.add_argument('--num-shards',type=int,required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    if not (0<=args.shard_index<args.num_shards):raise SystemExit('bad shard')
    random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(2)
    src=Path(args.encoder);tok=AutoTokenizer.from_pretrained(src,local_files_only=True);enc=AutoModel.from_pretrained(src,local_files_only=True);H=enc.config.hidden_size
    class Joint(nn.Module):
        def __init__(self,encoder):
            super().__init__();self.encoder=encoder;self.drop=nn.Dropout(.1);self.class_head=nn.Linear(H,3);self.ev_head=nn.Linear(H,2)
        def forward(self,**kw):
            o=self.encoder(**kw,return_dict=True);h=self.drop(o.last_hidden_state[:,0,:]);return self.class_head(h),self.ev_head(h)
    model=Joint(enc)
    st=torch.load(args.state,map_location='cpu',weights_only=False)
    missing,unexpected=model.load_state_dict(st['trainable_state'],strict=False)
    if unexpected:raise SystemExit(f'unexpected state keys {unexpected}')
    required={'class_head.weight','class_head.bias','ev_head.weight','ev_head.bias'}
    if not required.issubset(set(st['trainable_state'])):raise SystemExit('missing trained heads')
    model.eval()
    train_obj=json.load(open(args.train_json))
    build_hashes={doc_hash(d) for d in train_obj['documents'] if partition(d)=='build'}
    excluded_cal_docs=sorted(str(d['id']) for d in train_obj['documents'] if partition(d)=='cal' and doc_hash(d) in build_hashes)
    rows=[]
    @torch.inference_mode()
    def score_one(spans,h):
        ranked=sorted(((overlap(s,h),i) for i,s in enumerate(spans)),reverse=True)[:32]
        if not ranked:return {str(k):{'score':0.0,'candidate_label':2,'best_span_index':None} for k in KS}
        segs=[target_context(spans,i) for _,i in ranked];classp=[];evp=[]
        for z in range(0,len(segs),64):
            batch=segs[z:z+64];e=tok(batch,[h]*len(batch),padding=True,truncation=True,max_length=256,return_tensors='pt');lc,le=model(**e);classp.extend(torch.softmax(lc,-1).tolist());evp.extend(torch.softmax(le,-1)[:,1].tolist())
        out={}
        for k in KS:
            bestc=0.;bestlabel=2;besti=None
            for jj,(cp,ep) in enumerate(zip(classp[:k],evp[:k])):
                for lab in (0,1):
                    s=ep*cp[lab]
                    if s>bestc:bestc=s;bestlabel=lab;besti=jj
            out[str(k)]={'score':bestc,'candidate_label':bestlabel,'best_span_index':ranked[besti][1] if besti is not None else None}
        return out
    for corpus,obj in [('train',train_obj),('dev',json.load(open(args.dev_json)))]:
        labs=obj['labels']
        for d in obj['documents']:
            if corpus=='train':
                if partition(d)!='cal' or doc_hash(d) in build_hashes:continue
            if shard_for(corpus,str(d['id']),args.num_shards)!=args.shard_index:continue
            spans=span_texts(d);anns=d['annotation_sets'][0]['annotations']
            for hid in sorted(labs):
                a=anns[hid];rows.append({'corpus':corpus,'doc':str(d['id']),'hid':hid,'gold':LABEL_MAP[a['choice']],'gold_spans':a.get('spans') or [],'scores':score_one(spans,labs[hid]['hypothesis'])})
    rep={'schema':'musitu.revenueguard.contractnli.checkpoint_raw_shard.v2','status':'DEV_RESEARCH_ONLY','mode':st['mode'],'global_training_steps':st['global_steps'],'next_chunk':st['next_chunk'],'shard_index':args.shard_index,'num_shards':args.num_shards,'calibration_exclusion_rule':'Exclude any hash-held calibration document whose normalized full text SHA-256 appears in the training build partition.','excluded_calibration_doc_ids':excluded_cal_docs,'row_count':len(rows),'rows':rows}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.out).write_text(json.dumps(rep,separators=(',',':'))+'\n');print(json.dumps({k:v for k,v in rep.items() if k!='rows'},indent=2,sort_keys=True))
if __name__=='__main__':main()

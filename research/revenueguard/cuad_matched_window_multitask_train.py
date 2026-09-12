#!/usr/bin/env python3
import argparse, hashlib, json, math, random, re, time
from collections import Counter
from pathlib import Path
import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForQuestionAnswering

SEED=842771
MAX_LEN=384
STRIDE=128
BATCH=24
CUAD_COMMIT='67faa0e6023b04fcaae6cc09497ab00e5d63a2a2'

def heldout(title):
    return int(hashlib.sha256(title.encode()).hexdigest()[:8],16)%10==0

def words(s): return set(re.findall(r'[a-z0-9]+',s.lower()))
def overlap(a,b):
    A=words(a);B=words(b);return len(A&B)/(len(A|B) or 1)
def assign_chunk(title,qid,fi,num_chunks):
    return int(hashlib.sha256(f'{SEED}|{title}|{qid}|{fi}'.encode()).hexdigest()[:8],16)%num_chunks
def order_key(title,qid,fi): return hashlib.sha256(f'order|{SEED}|{title}|{qid}|{fi}'.encode()).hexdigest()

def window_rows(raw,tok,chunk,num_chunks):
    rows=[]; stats=Counter()
    for contract in raw:
        title=contract.get('title','')
        for para in contract['paragraphs']:
            ctx=para['context']
            for qa in para['qas']:
                qid=str(qa['id']); q=qa['question']; answers=qa.get('answers',[]) or []
                if heldout(title): stats['heldout_questions']+=1; continue
                stats['build_questions']+=1
                enc=tok(q,ctx,truncation='only_second',max_length=MAX_LEN,stride=STRIDE,return_overflowing_tokens=True,return_offsets_mapping=True,padding=False)
                candidates=[]
                for fi in range(len(enc['input_ids'])):
                    seq=enc.sequence_ids(fi); offs=enc['offset_mapping'][fi]
                    spans=[(int(a),int(b)) for j,(a,b) in enumerate(offs) if seq[j]==1 and b>a]
                    if not spans: continue
                    lo=min(a for a,b in spans); hi=max(b for a,b in spans); text=ctx[lo:hi]
                    contained=[a for a in answers if int(a['answer_start'])>=lo and int(a['answer_start'])+len(a['text'])<=hi]
                    if contained:
                        a=min(contained,key=lambda x:(int(x['answer_start']),len(x['text']))); s=int(a['answer_start'])-lo
                        candidates.append((fi,True,text,s,s+len(a['text']),overlap(q,text)))
                    else: candidates.append((fi,False,text,None,None,overlap(q,text)))
                pos=[x for x in candidates if x[1]]; neg=sorted((x for x in candidates if not x[1]),key=lambda x:(x[5],-x[0]),reverse=True)
                chosen=(pos+neg[:2]) if answers else neg[:3]
                stats['answerable_questions']+=int(bool(answers)); stats['impossible_questions']+=int(not answers)
                stats['selected_positive']+=sum(x[1] for x in chosen); stats['selected_negative']+=sum(not x[1] for x in chosen); stats['selected_total']+=len(chosen)
                for fi,is_pos,text,s,e,_ in chosen:
                    if assign_chunk(title,qid,fi,num_chunks)==chunk:
                        rows.append((order_key(title,qid,fi),q,text,s,e,is_pos,title,qid,fi))
    rows.sort(key=lambda x:x[0]); return rows,stats

class DS(Dataset):
    def __init__(self,rows): self.rows=rows
    def __len__(self): return len(self.rows)
    def __getitem__(self,i): return self.rows[i]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--model-in',required=True);ap.add_argument('--train-json',required=True);ap.add_argument('--chunk-index',type=int,required=True);ap.add_argument('--num-chunks',type=int,required=True);ap.add_argument('--state-in');ap.add_argument('--model-out',required=True);ap.add_argument('--state-out',required=True);ap.add_argument('--report',required=True);args=ap.parse_args()
    if not 0<=args.chunk_index<args.num_chunks: raise SystemExit('bad chunk')
    torch.manual_seed(SEED);random.seed(SEED);torch.set_num_threads(2)
    src=Path(args.model_in);tok=AutoTokenizer.from_pretrained(src,local_files_only=True,use_fast=True);qa=AutoModelForQuestionAnswering.from_pretrained(src,local_files_only=True)
    H=qa.config.hidden_size;answer_head=nn.Linear(H,2)
    for p in qa.parameters():p.requires_grad=False
    backbone=getattr(qa,'bert',None)
    if backbone is None:raise RuntimeError(type(qa))
    for layer in backbone.encoder.layer[-2:]:
        for p in layer.parameters():p.requires_grad=True
    for p in qa.qa_outputs.parameters():p.requires_grad=True
    params=[p for p in qa.parameters() if p.requires_grad]+list(answer_head.parameters());opt=torch.optim.AdamW(params,lr=2e-5,weight_decay=.01)
    train=Path(args.train_json);train_sha=hashlib.sha256(train.read_bytes()).hexdigest();global_steps=0;loss_sum=0.;loss_n=0
    if args.state_in:
        st=torch.load(args.state_in,map_location='cpu',weights_only=False)
        if st['next_chunk']!=args.chunk_index or st['num_chunks']!=args.num_chunks or st['train_sha256']!=train_sha:raise SystemExit('state continuity mismatch')
        answer_head.load_state_dict(st['answer_head']);opt.load_state_dict(st['optimizer']);global_steps=int(st['global_steps']);loss_sum=float(st['loss_sum']);loss_n=int(st['loss_n']);torch.set_rng_state(st['torch_rng_state'])
    raw=json.load(open(train))['data'];rows,stats=window_rows(raw,tok,args.chunk_index,args.num_chunks)
    pos=max(1,stats['selected_positive']);neg=max(1,stats['selected_negative']);total=pos+neg
    aw=torch.tensor([math.sqrt(total/(2*neg)),math.sqrt(total/(2*pos))],dtype=torch.float32);aw=aw/aw.mean();answer_ce=nn.CrossEntropyLoss(weight=aw,reduction='none');span_ce=nn.CrossEntropyLoss(reduction='none')
    def collate(batch):
        enc=tok([x[1] for x in batch],[x[2] for x in batch],padding=True,truncation='only_second',max_length=MAX_LEN,return_offsets_mapping=True,return_tensors='pt');offs=enc.pop('offset_mapping');starts=[];ends=[];labels=[]
        for bi,x in enumerate(batch):
            cls=(enc['input_ids'][bi]==tok.cls_token_id).nonzero(as_tuple=False)[0].item();is_pos=bool(x[5]);labels.append(int(is_pos))
            if not is_pos:starts.append(cls);ends.append(cls);continue
            s,e=x[3],x[4];seq=enc.sequence_ids(bi);st=en=None
            for j,(a,b) in enumerate(offs[bi].tolist()):
                if seq[j]!=1:continue
                if st is None and a<=s<b:st=j
                if a<e<=b:en=j;break
            if st is None or en is None:raise RuntimeError(f'positive span lost {x[7]} window {x[8]}')
            starts.append(st);ends.append(en)
        return enc,torch.tensor(starts),torch.tensor(ends),torch.tensor(labels)
    dl=DataLoader(DS(rows),batch_size=BATCH,shuffle=False,collate_fn=collate,num_workers=0);qa.train();answer_head.train();chunk_sum=0.;chunk_n=0;t0=time.time()
    for step,(enc,ys,ye,ya) in enumerate(dl):
        opt.zero_grad(set_to_none=True);out=qa(**enc,output_hidden_states=True,return_dict=True);al=answer_head(out.hidden_states[-1][:,0,:]);ls=(span_ce(out.start_logits,ys)+span_ce(out.end_logits,ye))/2;span_w=torch.where(ya.bool(),torch.ones_like(ls),torch.full_like(ls,.35));la=answer_ce(al,ya);loss=(ls*span_w).mean()+.7*la.mean();loss.backward();torch.nn.utils.clip_grad_norm_(params,1.0);opt.step();v=float(loss.detach());chunk_sum+=v;chunk_n+=1;loss_sum+=v;loss_n+=1;global_steps+=1
        if step and step%40==0:print('chunk',args.chunk_index,'step',step,'loss',round(chunk_sum/chunk_n,4),'elapsed',round(time.time()-t0,1),flush=True)
    outdir=Path(args.model_out);outdir.mkdir(parents=True,exist_ok=True);qa.save_pretrained(outdir,safe_serialization=True);tok.save_pretrained(outdir);torch.save(answer_head.state_dict(),outdir/'answer_head.pt')
    state={'schema':'musitu.revenueguard.cuad.matched_window_state.v1','next_chunk':args.chunk_index+1,'num_chunks':args.num_chunks,'global_steps':global_steps,'loss_sum':loss_sum,'loss_n':loss_n,'answer_head':answer_head.state_dict(),'optimizer':opt.state_dict(),'torch_rng_state':torch.get_rng_state(),'seed':SEED,'train_sha256':train_sha};Path(args.state_out).parent.mkdir(parents=True,exist_ok=True);torch.save(state,args.state_out)
    rep={'schema':'musitu.revenueguard.cuad.matched_window_train.v1','status':'DEV_RESEARCH_ONLY','chunk_index':args.chunk_index,'num_chunks':args.num_chunks,'chunk_samples':len(rows),'chunk_steps':chunk_n,'global_steps':global_steps,'chunk_loss':chunk_sum/(chunk_n or 1),'running_loss':loss_sum/(loss_n or 1),'max_length':MAX_LEN,'stride':STRIDE,'batch_size':BATCH,'answerability_weights':aw.tolist(),'full_selected_counts':dict(stats),'train_sha256':train_sha,'cuad_commit':CUAD_COMMIT,'source_model_policy':'continue exact failed epoch1 model; heldout title-hash contracts excluded; official test unopened','curriculum':'evaluator-style sliding windows; all answer windows; up to 2 same-question hard negatives for answerable; up to 3 for impossible; explicit answerability plus span loss','elapsed_seconds':time.time()-t0};rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.report).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__':main()

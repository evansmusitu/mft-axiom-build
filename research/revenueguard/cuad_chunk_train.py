#!/usr/bin/env python3
import argparse, hashlib, json, random, re, time
from pathlib import Path
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForQuestionAnswering
from huggingface_hub import HfApi, snapshot_download

BASE='deepset/minilm-uncased-squad2'
BASE_REV_EXPECTED='934656cdda79824eabf503ed56e15c01ddbdbe3f'
CUAD_COMMIT='67faa0e6023b04fcaae6cc09497ab00e5d63a2a2'
SEED=733109
BATCH_SIZE=32
TOTAL_CHUNKS=8


def is_dev(title):
    return int(hashlib.sha256(title.encode()).hexdigest()[:8],16)%10==0

def words(s): return set(re.findall(r'[a-z0-9]+',s.lower()))
def overlap(a,b):
    A=words(a);B=words(b);return len(A&B)/(len(A|B) or 1)
def pos_context(ctx,start,text):
    end=start+len(text);lo=max(0,start-700);hi=min(len(ctx),end+1100)
    return ctx[lo:hi],start-lo,end-lo
def hard_negative(ctx,q,answers):
    blocked=[(a['answer_start'],a['answer_start']+len(a['text'])) for a in answers]
    best=None
    for lo in range(0,max(1,len(ctx)),900):
        hi=min(len(ctx),lo+1800)
        if any(max(lo,a)<min(hi,b) for a,b in blocked):
            if hi==len(ctx): break
            continue
        s=overlap(q,ctx[lo:hi])
        if best is None or s>best[0]: best=(s,ctx[lo:hi])
        if hi==len(ctx): break
    return best[1] if best else ctx[:1800]

def make_build(train_path):
    raw=json.load(open(train_path))['data']; build=[]; heldout=0
    for c in raw:
        title=c.get('title','')
        for para in c['paragraphs']:
            ctx=para['context']
            for qa in para['qas']:
                if is_dev(title): heldout+=1; continue
                q=qa['question']; ans=qa.get('answers',[])
                for a in ans[:2]:
                    sub,s,e=pos_context(ctx,a['answer_start'],a['text']);build.append((q,sub,s,e,False))
                build.append((q,hard_negative(ctx,q,ans),None,None,True))
    rng=random.Random(SEED);rng.shuffle(build)
    return build,heldout

class QD(Dataset):
    def __init__(self,rows): self.rows=rows
    def __len__(self): return len(self.rows)
    def __getitem__(self,i): return self.rows[i]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--train-json',required=True)
    ap.add_argument('--chunk-index',type=int,required=True)
    ap.add_argument('--input-dir')
    ap.add_argument('--output-dir',required=True)
    ap.add_argument('--state-in')
    ap.add_argument('--state-out',required=True)
    ap.add_argument('--report',required=True)
    args=ap.parse_args()
    if not (0<=args.chunk_index<TOTAL_CHUNKS): raise ValueError(args.chunk_index)
    torch.manual_seed(SEED);torch.set_num_threads(2)
    train_path=Path(args.train_json); train_sha=hashlib.sha256(train_path.read_bytes()).hexdigest()
    build,heldout=make_build(train_path)
    if args.input_dir:
        src=Path(args.input_dir);tok=AutoTokenizer.from_pretrained(src,local_files_only=True,use_fast=True);model=AutoModelForQuestionAnswering.from_pretrained(src,local_files_only=True)
        base_rev=BASE_REV_EXPECTED
    else:
        rev=HfApi().model_info(BASE).sha
        if rev!=BASE_REV_EXPECTED: raise RuntimeError(f'base revision drift: {rev}')
        src=Path(snapshot_download(BASE,revision=rev,allow_patterns=['config.json','model.safetensors','pytorch_model.bin','tokenizer_config.json','special_tokens_map.json','vocab.txt']))
        tok=AutoTokenizer.from_pretrained(src,local_files_only=True,use_fast=True);model=AutoModelForQuestionAnswering.from_pretrained(src,local_files_only=True);base_rev=rev
    for p in model.parameters(): p.requires_grad=False
    for layer in model.bert.encoder.layer[-2:]:
        for p in layer.parameters(): p.requires_grad=True
    for p in model.qa_outputs.parameters(): p.requires_grad=True
    params=[p for p in model.parameters() if p.requires_grad]
    opt=torch.optim.AdamW(params,lr=3e-5,weight_decay=.01)
    global_steps=0; prior_loss_sum=0.0; prior_loss_n=0
    if args.state_in:
        state=torch.load(args.state_in,map_location='cpu',weights_only=False)
        opt.load_state_dict(state['optimizer'])
        global_steps=int(state['global_steps']);prior_loss_sum=float(state['loss_sum']);prior_loss_n=int(state['loss_n'])
        if state['next_chunk']!=args.chunk_index: raise RuntimeError((state['next_chunk'],args.chunk_index))
        if state['train_sha256']!=train_sha: raise RuntimeError('train dataset hash mismatch')
    def collate(batch):
        encs=tok([x[0] for x in batch],[x[1] for x in batch],padding=True,truncation='only_second',max_length=384,return_offsets_mapping=True,return_tensors='pt')
        offs=encs.pop('offset_mapping');starts=[];ends=[]
        for bi,x in enumerate(batch):
            cls=(encs['input_ids'][bi]==tok.cls_token_id).nonzero(as_tuple=False)[0].item()
            if x[4]: starts.append(cls);ends.append(cls);continue
            s,e=x[2],x[3];seq=encs.sequence_ids(bi);st=en=None
            for j,(a,b) in enumerate(offs[bi].tolist()):
                if seq[j]!=1: continue
                if st is None and a<=s<b: st=j
                if a<e<=b: en=j;break
            if st is None or en is None: st=en=cls
            starts.append(st);ends.append(en)
        encs['start_positions']=torch.tensor(starts);encs['end_positions']=torch.tensor(ends);return encs
    # Deterministic contiguous sample slices over one fixed shuffled epoch.
    n=len(build); a=n*args.chunk_index//TOTAL_CHUNKS; b=n*(args.chunk_index+1)//TOTAL_CHUNKS
    rows=build[a:b]
    dl=DataLoader(QD(rows),batch_size=BATCH_SIZE,shuffle=False,collate_fn=collate,num_workers=0)
    model.train();loss_sum=prior_loss_sum;loss_n=prior_loss_n;chunk_sum=0.;chunk_n=0;t0=time.time()
    for step,batch in enumerate(dl):
        opt.zero_grad(set_to_none=True);o=model(**batch);o.loss.backward();torch.nn.utils.clip_grad_norm_(params,1.0);opt.step()
        v=float(o.loss.detach());loss_sum+=v;loss_n+=1;chunk_sum+=v;chunk_n+=1;global_steps+=1
        if step and step%50==0: print('chunk',args.chunk_index,'step',step,'chunk_loss',round(chunk_sum/chunk_n,4),'elapsed',round(time.time()-t0,1),flush=True)
    out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True);model.save_pretrained(out,safe_serialization=True);tok.save_pretrained(out)
    state={'optimizer':opt.state_dict(),'global_steps':global_steps,'loss_sum':loss_sum,'loss_n':loss_n,'next_chunk':args.chunk_index+1,'train_sha256':train_sha,'seed':SEED,'total_chunks':TOTAL_CHUNKS}
    torch.save(state,args.state_out)
    files=[]
    for p in sorted(out.iterdir()):
        if p.is_file():
            bb=p.read_bytes();files.append({'path':p.name,'bytes':len(bb),'sha256':hashlib.sha256(bb).hexdigest()})
    sbb=Path(args.state_out).read_bytes()
    rep={'schema':'musitu.revenueguard.cuad.chunk_train.v1','status':'DEV_RESEARCH_ONLY','chunk_index':args.chunk_index,'total_chunks':TOTAL_CHUNKS,'sample_start':a,'sample_end':b,'chunk_samples':len(rows),'full_epoch_samples':n,'heldout_questions_unseen':heldout,'batch_size':BATCH_SIZE,'chunk_steps':chunk_n,'global_steps':global_steps,'chunk_loss':chunk_sum/(chunk_n or 1),'epoch_running_loss':loss_sum/(loss_n or 1),'elapsed_seconds':time.time()-t0,'base_repo':BASE,'base_revision':base_rev,'cuad_commit':CUAD_COMMIT,'cuad_train_sha256':train_sha,'model_files':files,'optimizer_state_sha256':hashlib.sha256(sbb).hexdigest()}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.report).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__': main()

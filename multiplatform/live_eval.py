from __future__ import annotations
import argparse,datetime,json,os,sys
from pathlib import Path

from multiplatform.evaluation_runner import build
from multiplatform.providers.axiom import AxiomFrontierAdapter
from multiplatform.providers.anthropic import AnthropicAdapter
from multiplatform.providers.openai import OpenAIAdapter
from multiplatform.providers.meta import MetaModelAdapter
from multiplatform.providers.google import GoogleGeminiAdapter
from multiplatform.providers.xai import XAIAdapter

def load_cases(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]

def scalar_present(text,value):
    if isinstance(value,dict):
        return all(scalar_present(text,v) for v in value.values())
    if isinstance(value,list):
        return all(scalar_present(text,v) for v in value)
    if isinstance(value,bool):
        token="true" if value else "false"
        return token in text.lower()
    if isinstance(value,float):
        forms={str(value),f"{value:.6g}",f"{value:.4f}".rstrip("0").rstrip(".")}
        return any(x in text for x in forms)
    return str(value) in text

def extract_output(provider,data):
    if not isinstance(data,dict): return str(data)
    if provider=="openai":
        if isinstance(data.get("output_text"),str): return data["output_text"]
        for item in data.get("output",[]):
            for block in item.get("content",[]) if isinstance(item,dict) else []:
                if isinstance(block,dict) and isinstance(block.get("text"),str): return block["text"]
    if provider=="anthropic":
        parts=[]
        for block in data.get("content",[]) if isinstance(data.get("content"),list) else []:
            if isinstance(block,dict) and isinstance(block.get("text"),str): parts.append(block["text"])
        return "\n".join(parts)
    if provider=="meta":
        try:return data["choices"][0]["message"]["content"]
        except Exception: pass
    return json.dumps(data,ensure_ascii=False,sort_keys=True)

def run_provider(name,cases,composite):
    adapter={"openai":OpenAIAdapter(),"anthropic":AnthropicAdapter(),"meta":MetaModelAdapter(),"google":GoogleGeminiAdapter(),"xai":XAIAdapter()}[name]
    model=adapter.model
    rows=[]
    mcp_url=os.getenv("AXIOM_FRONTIER_MCP_URL")
    for case in cases:
        invocation_type="baseline"
        try:
            from multiplatform.providers.contracts import Invocation,Provider
            inv=Invocation(case["case_id"],Provider(name),None,{},metadata={"prompt":case["prompt"]})
            if composite and mcp_url and hasattr(adapter, "invoke_with_frontier_mcp"):
                result=adapter.invoke_with_frontier_mcp(inv,mcp_url); invocation_type="axiom+mcp"
            else:
                result=adapter.invoke(inv)
            text=extract_output(name,result.output)
            passed=None
            if case.get("mode")=="known_answer" and result.status=="ok":
                passed=scalar_present(text,case["expected"])
            rows.append({"case_id":case["case_id"],"mode":case["mode"],"passed":passed,"status":result.status,"latency_ms":result.latency_ms,"usage":result.usage,"invocation_type":invocation_type,"output":text})
        except Exception as exc:
            rows.append({"case_id":case["case_id"],"mode":case["mode"],"passed":False,"status":"error","error":type(exc).__name__+":"+str(exc),"invocation_type":invocation_type,"output":""})
    return rows,model

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--cases",default="multiplatform/cases/cases.jsonl"); ap.add_argument("--out-dir",default="evidence"); ap.add_argument("--max-cases",type=int,default=30); ap.add_argument("--composite",action="store_true")
    args=ap.parse_args(); cases=load_cases(args.cases)[:args.max_cases]
    Path(args.out_dir).mkdir(parents=True,exist_ok=True)
    if os.getenv("AXIOM_FRONTIER_MCP_URL"):
        tools=AxiomFrontierAdapter().discover_tools()
        (Path(args.out_dir)/"axiom-discovery.json").write_text(json.dumps({"tool_count":len(tools),"tool_names_sha256":__import__("hashlib").sha256("\n".join(sorted(t.name for t in tools)).encode()).hexdigest()},sort_keys=True,indent=2))
    outputs=[]
    for name in ("openai","anthropic","google","xai","meta"):
        required={"openai":"OPENAI_API_KEY","anthropic":"ANTHROPIC_API_KEY","google":"GOOGLE_GEMINI_API_KEY","xai":"XAI_API_KEY","meta":"META_MODEL_API_KEY"}[name]
        if not os.getenv(required):
            outputs.append({"provider":name,"status":"SKIPPED","reason":"MISSING_PROVIDER_SECRET:"+required}); continue
        rows,model=run_provider(name,cases,args.composite)
        manifest=build(name,model or "REQUIRED",rows,args.cases,constraints={"composite":args.composite,"scored_cases":"known_answer_only"})
        path=Path(args.out_dir)/(name+".json"); path.write_text(json.dumps(manifest,indent=2,sort_keys=True),encoding="utf-8")
        outputs.append({"provider":name,"status":"COMPLETE","model":model,"manifest":str(path),"caseset_sha256":manifest["caseset_sha256"]})
    (Path(args.out_dir)/"run-index.json").write_text(json.dumps({"schema":"musitu.axiom.live-eval-index.v1","date_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"caseset_sha256":build("index","none",[],args.cases)["caseset_sha256"],"providers":outputs},indent=2,sort_keys=True))
    print(json.dumps(outputs,indent=2,sort_keys=True))

if __name__=="__main__": main()

"""Private Modal analytics skeleton; no Windows MT5/MetaEditor terminal."""
import modal

app=modal.App("lifeline-mt5-analytics-isolated")
image=modal.Image.debian_slim(python_version="3.12").pip_install("fastapi>=0.115,<1")

@app.function(image=image,min_containers=0,max_containers=1,timeout=120,
              secrets=[modal.Secret.from_name("lifeline-mt5-stage-secrets")])
@modal.asgi_app(requires_proxy_auth=True)
def private_api():
    import os, secrets
    from fastapi import FastAPI, Header, HTTPException
    api=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    @api.post("/mcp")
    def mcp(body:dict,x_lifeline_edge_secret:str=Header(default=""),x_lifeline_subject:str=Header(default="")):
        expected=os.environ.get("EDGE_SHARED_SECRET","")
        if len(expected)<32 or not secrets.compare_digest(expected,x_lifeline_edge_secret) or not x_lifeline_subject:
            raise HTTPException(401,"edge required")
        if body.get("jsonrpc")!="2.0": raise HTTPException(400,"invalid rpc")
        method=body.get("method")
        ident=body.get("id")
        if method=="initialize":
            result={"protocolVersion":"2025-03-26","serverInfo":{"name":"lifeline-mt5-stage","version":"0.2.0"},"capabilities":{"tools":{}}}
        elif method=="ping": result={}
        elif method=="tools/list":
            result={"tools":[{"name":"lifeline_status","description":"Safe status only; native MT5 not connected","inputSchema":{"type":"object","properties":{}},
                              "annotations":{"readOnlyHint":True,"destructiveHint":False,"openWorldHint":False}}]}
        elif method=="tools/call" and body.get("params",{}).get("name")=="lifeline_status":
            result={"content":[{"type":"text","text":"Private staging skeleton online, native MT5 not connected, trading disabled."}]}
        else: return {"jsonrpc":"2.0","id":ident,"error":{"code":-32601,"message":"not available"}}
        return {"jsonrpc":"2.0","id":ident,"result":result}
    return api

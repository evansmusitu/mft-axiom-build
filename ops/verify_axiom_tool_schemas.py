"""Validate advertised MCP schemas and examples through the public gateway."""
import json
import subprocess
from pathlib import Path
from jsonschema import Draft202012Validator
ROOT=Path(__file__).resolve().parents[1]
SCRIPT="""
import {readFileSync} from 'node:fs';
import gate from './mcp/musitu_axiom_plugin_gate_v4.mjs';
const original=JSON.parse(readFileSync('./mcp/tests/fixtures/public-registry-before-2.0.5.json'));
const env={AXIOM_DB:{},MCP_CORE:{fetch:async()=>Response.json(original)}};
const req=new Request('https://mcp.mftintelligence.com/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
console.log(await (await gate.fetch(req,env)).text());
"""
def main():
    r=subprocess.run(['node','--input-type=module','-e',SCRIPT],cwd=ROOT,check=True,capture_output=True,text=True)
    tools=json.loads(r.stdout)['result']['tools'];examples=json.loads((ROOT/'mcp/tests/fixtures/operation-examples.json').read_text())
    assert len(tools)==108
    count=0
    for t in tools:
        s=t['inputSchema'];Draft202012Validator.check_schema(s)
        op=t.get('_meta',{}).get('musitu/operation')
        if op:
            Draft202012Validator(s).validate({'args':examples[op]});count+=1
        if t['name']=='musitu_axiom_execute':
            for op,example in examples.items():Draft202012Validator(s).validate({'operation':op,'args':example})
            count+=1
    assert count==105
    print('108 advertised schemas conform to JSON Schema; all 105 computation tools validate their examples, including all 74 generic operation branches.')
if __name__=='__main__':main()

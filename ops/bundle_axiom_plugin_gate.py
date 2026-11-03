"""Replace the generated contract block without modifying live gateway behavior."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BEGIN='// BEGIN GENERATED OPERATION CONTRACTS\n'
END='// END GENERATED OPERATION CONTRACTS\n'
def main():
    gate=ROOT/'mcp/musitu_axiom_plugin_gate_v4.mjs'
    s=gate.read_text()
    contracts=json.loads((ROOT/'mcp/operation_contracts.json').read_text())
    mapping=json.loads((ROOT/'mcp/operation_tool_map.json').read_text())
    assert len(mapping)==104 and set(mapping.values())==set(contracts)
    runtime=(ROOT/'mcp/plugin_contract_runtime.mjs').read_text()
    runtime='\n'.join(line for line in runtime.splitlines() if not line.startswith(('import ','const TOOL_OPERATIONS=')))
    runtime=runtime.replace('export function ','function ')
    generated=BEGIN+'const OPERATION_CONTRACTS='+json.dumps(contracts,separators=(',',':'))+';\nconst TOOL_OPERATIONS='+json.dumps(mapping,separators=(',',':'))+';\n'+runtime+'\n'+END
    if BEGIN in s:
        before,rest=s.split(BEGIN,1);_,after=rest.split(END,1);s=before+generated+after
    else:s=generated+s
    gate.write_text(s)
    print('Bundled 74 contracts into the single-module public gateway.')
if __name__=='__main__':main()

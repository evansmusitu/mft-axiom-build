from pathlib import Path

BASE = Path(__file__).with_name("axiom_billing_commercial_enable_v1.py")
source = BASE.read_text(encoding="utf-8")
start = source.index("def patch_fetch_route(text, route_expr):")
end = source.index("\n\nAUTH_HELPER", start)
replacement = r'''def patch_fetch_route(text, route_expr):
    # Current Phase-8 authority exports `fetch: handleRequest` and implements
    # `handleRequest(request, env)`. Keep support for the older direct
    # async-fetch shape, but require exactly one recognized dispatch target.
    candidates=[]
    direct=re.compile(r'async\s+fetch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)?\s*\)\s*\{')
    for m in direct.finditer(text):candidates.append((m,m.group(1),m.group(2),'direct_fetch'))
    handler=re.compile(r'(?:async\s+)?function\s+handleRequest\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*\{')
    for m in handler.finditer(text):candidates.append((m,m.group(1),m.group(2),'handleRequest'))
    if len(candidates)!=1:raise RuntimeError(f'dispatch target count {len(candidates)}')
    m,request_var,env_var,shape=candidates[0]
    if shape=='handleRequest' and not re.search(r'export\s+default\s*\{[^}]*\bfetch\s*:\s*handleRequest\b',text,re.S):
        raise RuntimeError('handleRequest is not exported as fetch')
    injected=f'\n  {route_expr.format(request=request_var,env=env_var)}\n'
    return text[:m.end()]+injected+text[m.end():]
'''
patched = source[:start] + replacement + source[end:]
compile(patched, str(BASE), "exec")
namespace = {"__name__": "__main__", "__file__": str(BASE)}
exec(compile(patched, str(BASE), "exec"), namespace, namespace)

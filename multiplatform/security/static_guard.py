from __future__ import annotations
import pathlib,sys
PROD_HOSTS=("mcp.mftintelligence.com","auth.mftintelligence.com","payments.mftintelligence.com")
BAD_SECRET_NAMES=("OPENAI_APPS_CHALLENGE","CLOUDFLARE_GLOBAL_API_KEY","CLOUDFLARE_API_KEY","AUTH_SECRET")
for path in pathlib.Path("multiplatform/providers").rglob("*"):
    if not path.is_file() or path.suffix==".pyc" or "__pycache__" in path.parts: continue
    text=path.read_text(errors="ignore")
    if path.name not in {"axiom.py","boundaries.py"} and any(host in text for host in PROD_HOSTS):
        print(f"FAIL: provider adapter contains MUSITU production host: {path}"); sys.exit(2)
    if any(name in text for name in BAD_SECRET_NAMES):
        print(f"FAIL: forbidden production secret identifier: {path}"); sys.exit(3)
print("MUSITU_AXIOM_MULTIPLATFORM_STATIC_SECURITY_PASS")

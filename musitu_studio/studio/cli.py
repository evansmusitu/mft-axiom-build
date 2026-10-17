"""Local-only dashboard command. Keep port behind approved TLS/VPN in production."""
import argparse
import os
from pathlib import Path
import sys


def main(argv=None):
    p=argparse.ArgumentParser(description='MUSITU Studio v0.1 local dashboard')
    p.add_argument('--host',default='127.0.0.1')
    p.add_argument('--port',type=int,default=8755)
    p.add_argument('--data',default=os.getenv('MUSITU_STUDIO_DATA','./studio-data'))
    p.add_argument('--secure-cookies',action='store_true')
    args=p.parse_args(argv)
    token=os.getenv('MUSITU_STUDIO_ADMIN_TOKEN','')
    if len(token)<24:p.error('Set MUSITU_STUDIO_ADMIN_TOKEN to a long random secret')
    if args.host not in ('127.0.0.1','::1','localhost') and not args.secure_cookies:
        p.error('Non-loopback binding requires --secure-cookies and an approved TLS reverse proxy')
    from .web import create_app
    import uvicorn
    uvicorn.run(create_app(root=Path(args.data),admin_token=token,secure_cookie=args.secure_cookies),
                host=args.host,port=args.port,proxy_headers=False,access_log=False)

if __name__=='__main__':sys.exit(main())

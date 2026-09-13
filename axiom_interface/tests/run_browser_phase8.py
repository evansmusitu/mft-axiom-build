from __future__ import annotations
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import os,shutil,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
from phase8_browser_setup import create_project_and_session
from phase8_browser_actions import exercise_action_controls
from phase8_browser_security import exercise_security_and_finalize
ROOT=Path(__file__).resolve().parents[1];ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE8_ARTIFACT_DIR','/tmp/axiom-interface-phase8'));ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
 def log_message(self,*_args):pass
def main():
 handler=lambda *a,**kw:QuietHandler(*a,directory=str(ROOT),**kw);server=ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None);context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce');page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
   project_id,session_id=create_project_and_session(page,origin);exercise_action_controls(page,session_id);exercise_security_and_finalize(page,session_id,project_id,requests,origin,ARTIFACT_DIR);browser.close()
 finally:server.shutdown();server.server_close()
 print('MUSITU_AXIOM_INTERFACE_PHASE8_COMPUTER_BROWSER_PASS')
if __name__=='__main__':main()

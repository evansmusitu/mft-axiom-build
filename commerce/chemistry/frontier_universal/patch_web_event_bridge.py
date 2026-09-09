from pathlib import Path
import hashlib, json, sys

ORIGINALS = {
    "app.js": "f2e8828674bc166ea03acc30302a37633221ae85b091c2801dfe7c2919c57c61",
    "commercial.js": "cc6532b8c669ec373a934d9c5a4b5f6f60d87507bfb9d11de143181b7bccb58c",
    "frontier.js": "ad889c5b30c81a530a405b84c52fd5b0d2b14ae30118bd743f923e8c347bf926",
    "sw.js": "a542a5aa5d29d4614fd5289ba6a089262fd9194d9ece093789f55b4975c174ef",
}
EXPECTED = {
    "app.js": {"bytes": 44760, "sha256": "c7f1dab4443b23dcfb23a8b9c3c1bb2256a3d6c4b11f37f97f32efdb42dce340"},
    "commercial.js": {"bytes": 13907, "sha256": "e4e4e6447884acc4520516824d0f9ac2415a4d911eff2707387792c2232575a8"},
    "frontier.js": {"bytes": 35496, "sha256": "0b6999fc09ec2dd21beda23bb0f9ecf2ce9d57bdeb20aecf6a7cecb36093ba84"},
    "sw.js": {"bytes": 1895, "sha256": "108ae636ef13f2b1fe2db61b62107a3a6d835452462d710d55a6f920898279eb"},
}

BRIDGE = r'''

/* MUSITU web compatibility bridge: preserves the original command contract
   without inline event-handler execution, so the strict script-src 'self'
   policy remains intact across Firefox/WebKit/Chromium engines. */
(()=>{
  'use strict';
  const ALLOWED=new Set([
    'go','openChapter','selectRoute','searchNow','toggleNext','toggleBookmark','setConfidence','scheduleReview','logError','checkpoint',
    'reviewResult','setDiagAnswer','showDiag','setDiagScore','toggleDiagCode','finishDiag','startExam','premiumGate','setExamAnswer',
    'finishExam','setExamScore','commitExam','discardExam','exportData','importData','resetData','support','activateLicense','copyDeviceId',
    'removeLicense','restorePurchase','shareLicenceBackup','buyPlan','MUSITUFrontier.requestInstall'
  ]);
  function splitArgs(src){
    const out=[]; let cur='',quote=null,escape=false;
    for(const ch of src){
      if(escape){cur+=ch;escape=false;continue;}
      if(ch==='\\'){cur+=ch;escape=true;continue;}
      if(quote){cur+=ch;if(ch===quote)quote=null;continue;}
      if(ch==="'"||ch==='"'){quote=ch;cur+=ch;continue;}
      if(ch===','){out.push(cur.trim());cur='';continue;}
      cur+=ch;
    }
    if(quote||escape)throw new Error('Malformed MUSITU action arguments');
    if(cur.trim()||src.trim())out.push(cur.trim());
    return out;
  }
  function parseString(tok){
    const q=tok[0]; if((q!=="'"&&q!=='"')||tok[tok.length-1]!==q)throw new Error('Invalid MUSITU string argument');
    let s='',esc=false;
    for(let i=1;i<tok.length-1;i++){
      const c=tok[i];
      if(esc){if(c==='n')s+='\n';else if(c==='r')s+='\r';else if(c==='t')s+='\t';else s+=c;esc=false;continue;}
      if(c==='\\'){esc=true;continue;} s+=c;
    }
    if(esc)throw new Error('Invalid MUSITU escape'); return s;
  }
  function parseArg(tok,el){
    if(tok==='this')return el;
    if(tok==='this.value')return el.value;
    if(tok==='true')return true;if(tok==='false')return false;if(tok==='null')return null;
    if(/^[-+]?\d+(?:\.\d+)?$/.test(tok))return Number(tok);
    if((tok.startsWith("'")&&tok.endsWith("'"))||(tok.startsWith('"')&&tok.endsWith('"')))return parseString(tok);
    throw new Error('Rejected MUSITU action argument');
  }
  function resolve(name){
    if(!ALLOWED.has(name))throw new Error('Rejected MUSITU action '+name);
    if(name==='MUSITUFrontier.requestInstall')return [window.MUSITUFrontier,window.MUSITUFrontier&&window.MUSITUFrontier.requestInstall];
    return [window,window[name]];
  }
  function run(spec,el){
    const m=/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\((.*)\)$/.exec(String(spec||'').trim());
    if(!m)throw new Error('Rejected MUSITU action syntax');
    const [ctx,fn]=resolve(m[1]);if(typeof fn!=='function')throw new Error('Unavailable MUSITU action '+m[1]);
    const args=m[2].trim()?splitArgs(m[2]).map(x=>parseArg(x,el)):[];
    return fn.apply(ctx,args);
  }
  document.addEventListener('click',e=>{
    const el=e.target&&e.target.closest?e.target.closest('[data-musitu-click]'):null;if(!el)return;
    try{run(el.getAttribute('data-musitu-click'),el);}catch(err){console.error('MUSITU action bridge blocked:',err);}
  });
  document.addEventListener('input',e=>{
    const el=e.target&&e.target.closest?e.target.closest('[data-musitu-input]'):null;if(!el)return;
    try{run(el.getAttribute('data-musitu-input'),el);}catch(err){console.error('MUSITU input bridge blocked:',err);}
  });
  window.MUSITUActionBridge=Object.freeze({version:'1.0.0',strictCsp:true,allowed:[...ALLOWED]});
})();
'''

def patch(root):
    root = Path(root)
    for name, want in ORIGINALS.items():
        p = root / name
        data = p.read_bytes()
        got = hashlib.sha256(data).hexdigest()
        if got != want:
            raise SystemExit(f"original drift {name}: {got}")
        text = data.decode("utf-8")
        if name in ("app.js", "commercial.js", "frontier.js"):
            text = text.replace('onclick="', 'data-musitu-click="').replace('oninput="', 'data-musitu-input="')
            if 'onclick="' in text or 'oninput="' in text:
                raise SystemExit(f"event attribute survived {name}")
            if name == "app.js":
                text = text.rstrip() + BRIDGE + "\n"
        elif name == "sw.js":
            old = "musitu-chemistry-universal-frontier-v1"
            new = "musitu-chemistry-universal-frontier-v2"
            if text.count(old) != 1:
                raise SystemExit("service-worker cache-version source drift")
            text = text.replace(old, new)
        p.write_text(text, encoding="utf-8", newline="")
    observed = {
        name: {"sha256": hashlib.sha256((root / name).read_bytes()).hexdigest(), "bytes": (root / name).stat().st_size}
        for name in ORIGINALS
    }
    if observed != EXPECTED:
        raise SystemExit("deterministic compatibility overlay drift: " + json.dumps(observed, sort_keys=True))
    return observed

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_web_event_bridge.py <carrier-root>")
    print(json.dumps(patch(sys.argv[1]), indent=2, sort_keys=True))

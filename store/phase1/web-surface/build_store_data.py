from pathlib import Path
import json

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
FILES={
  'catalog_raw': ROOT/'catalog.json',
  'catalog_sig_raw': ROOT/'catalog.sig',
  'channels_raw': ROOT/'release/channels.json',
  'rollback_raw': ROOT/'release/rollback-control.json',
  'sbom_raw': ROOT/'apps/chemistry/sbom.json',
  'dependencies_raw': ROOT/'apps/chemistry/dependencies.json',
  'bootstrap_raw': ROOT/'bootstrap/release.json',
}
# Optional committed adapter metadata is added when present in the workspace.
optional={
  'ios_source_raw': ROOT/'ios/source.json',
  'web_adapter_raw': ROOT/'web/adapter.json',
  'fdroid_index_raw': ROOT/'android/repo/index-v1.json',
}
FILES.update({k:v for k,v in optional.items() if v.exists()})

def js_string(s:str)->str:
    return json.dumps(s, ensure_ascii=False, separators=(',',':'))

lines=['// Generated only from committed Phase-1 public metadata. Do not edit by hand.']
for name,path in FILES.items():
    raw=path.read_text(encoding='utf-8')
    lines.append(f'export const {name.upper()}={js_string(raw)};')
    if name.endswith('_raw') and name not in ('catalog_sig_raw',):
        const=name[:-4].upper()
        lines.append(f'export const {const}=JSON.parse({name.upper()});')
(HERE/'generated-data.mjs').write_text('\n'.join(lines)+'\n',encoding='utf-8')

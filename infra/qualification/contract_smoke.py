import json
from pathlib import Path
from jsonschema import Draft202012Validator

root=Path(__file__).resolve().parents[2]
envelope=json.loads((root/"contracts/canonical-envelope.schema.json").read_text())
mining=json.loads((root/"contracts/mining-record.schema.json").read_text())
Draft202012Validator(envelope).validate({"contract":"musitu.connect.canonical.v1","domain":"mining","run_id":"r1","source":"Mining Adapter","records":[]})
Draft202012Validator(mining).validate({"hazard":"Ground collapse","exposure":0.54,"severity":10,"likelihood":0.62,"cost":18000,"benefit":0.34})
print("CONTRACT_SCHEMA_VALIDATION=PASS")

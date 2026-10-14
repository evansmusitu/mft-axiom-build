"""Generate an S0-only record from actual local CI transcript and trusted CI env."""
import os
from pathlib import Path
import sys
from security_state import create_record,deterministic_json

def main():
    if len(sys.argv)!=3:raise SystemExit('USAGE: compose_attested_record.py TEST_LOG OUTPUT_JSON')
    raw=Path(sys.argv[1]).read_bytes()
    record=create_record(repo=os.environ.get('GITHUB_REPOSITORY'),
        branch=os.environ.get('GITHUB_REF_NAME'),
        commit=os.environ.get('GITHUB_SHA'),
        b27_parent=os.environ.get('AXIOM_B27_PINNED_PARENT'),
        workflow_run_id=os.environ.get('GITHUB_RUN_ID'),
        transcript=raw)
    path=Path(sys.argv[2]);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(deterministic_json(record))
    print('AXIOM_B27_EXTERNAL_LOG_PROVENANCE_SUBJECT_GENERATED_NOT_AUTHORITY',flush=True)

if __name__=='__main__':main()
